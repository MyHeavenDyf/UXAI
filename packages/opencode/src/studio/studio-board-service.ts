import path from "node:path"
import {
  BoardDocument,
  BoardReference,
  BoardSubmission,
  boardEdgeError,
  boardFrameSourceCount,
  boardDraftReferences,
  boardGenerationError,
  boardImageOperationName,
  emptyBoard,
} from "@opencode-ai/core/studio-board"
import { and, eq, inArray, Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { Instance } from "@/project/instance"
import { StudioBoardTable, StudioBoardSubmissionTable, StudioBoardOperationTable } from "./studio-board.sql"
import { StudioGenerationTable } from "./studio-generation.sql"

export class BoardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}

export function boardSession(sessionID: string) {
  const session = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, SessionID.make(sessionID)))
      .get(),
  )
  if (
    !session ||
    session.directory !== Instance.directory ||
    session.agent !== "octo_studio" ||
    session.studio_mode !== "board"
  )
    throw new BoardError("画布会话不存在或不属于当前目录", 404)
  return session
}

export function getBoard(sessionID: string) {
  const session = boardSession(sessionID)
  const row = Database.use((db) =>
    db.select().from(StudioBoardTable).where(eq(StudioBoardTable.session_id, session.id)).get(),
  )
  const document = row ? BoardDocument.parse(row.document) : emptyBoard()
  const pendingReboots = boardPendingReboots(sessionID).flatMap((operation) => {
    const card = document.cards.find((card) =>
      card.taskLinks.some((link) => link.generationID === operation.generation_id),
    )
    return card ? [{ cardID: card.id, generationID: operation.generation_id, operationID: operation.id }] : []
  })
  return { sessionID, revision: row?.revision ?? 0, document, pendingReboots }
}

export function boardPendingReboots(sessionID: string) {
  boardSession(sessionID)
  return Database.use((db) =>
    db
      .select()
      .from(StudioBoardOperationTable)
      .where(
        and(
          eq(StudioBoardOperationTable.session_id, SessionID.make(sessionID)),
          eq(StudioBoardOperationTable.status, "pending"),
        ),
      )
      .all(),
  )
}

function generation(sessionID: string, id: string) {
  const row = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.id, id),
          eq(StudioGenerationTable.session_id, SessionID.make(sessionID)),
          eq(StudioGenerationTable.directory, Instance.directory),
        ),
      )
      .get(),
  )
  if (!row) throw new BoardError("画布引用的生成任务不存在")
  return row
}

function media(sessionID: string, ref: { generationID: string; mediaID: string }) {
  const row = generation(sessionID, ref.generationID)
  const images = row.result?.images
  const image = Array.isArray(images)
    ? (images.find(
        (item: unknown) => typeof item === "object" && item !== null && "id" in item && item.id === ref.mediaID,
      ) as { id: string; kind?: string; url: string; remoteUrl?: string } | undefined)
    : undefined
  if (row.status !== "succeeded" || !image) throw new BoardError("引用媒体不可用，请选择有效结果")
  return image
}

export function saveBoard(sessionID: string, revision: number, value: unknown) {
  const document = BoardDocument.parse(value)
  return Database.transaction((db) => {
    const previous = getBoard(sessionID)
    if (previous.revision !== revision) throw new BoardError("画板已被其他窗口更新，请重新加载后恢复修改", 409)
    if (
      new Set(document.cards.map((card) => card.id)).size !== document.cards.length ||
      new Set(document.draftEdges.map((edge) => edge.id)).size !== document.draftEdges.length
    )
      throw new BoardError("画板存在重复标识")
    previous.document.cards.forEach((old) => {
      const card = document.cards.find((item) => item.id === old.id)
      if (
        card &&
        (card.kind !== old.kind ||
          JSON.stringify(card.operation) !== JSON.stringify(old.operation) ||
          JSON.stringify(card.regeneration) !== JSON.stringify(old.regeneration) ||
          card.currentGenerationID !== old.currentGenerationID ||
          JSON.stringify(card.taskLinks) !== JSON.stringify(old.taskLinks))
      )
        throw new BoardError("卡片类型和任务历史不能由保存操作改写")
      if (
        !card &&
        old.taskLinks.some(
          (link) =>
            ["creating", "queued", "running", "abnormal"].includes(generation(sessionID, link.generationID).status) ||
            previous.pendingReboots.some((operation) => operation.generationID === link.generationID),
        )
      )
        throw new BoardError("请先确认活动任务结束再移除卡片")
    })
    document.cards.forEach((card) => {
      if (!previous.document.cards.some((old) => old.id === card.id) && card.taskLinks.length)
        throw new BoardError("新卡片不能导入历史任务")
      if (["firstFrame", "lastFrame"].some((role) => boardFrameSourceCount(document, card.id, role) > 1))
        throw new BoardError("同一帧槽位不能存在多个来源")
      const uploads = path.join(Instance.directory, ".octo", sessionID, "uploads")
      if (card.regeneration && !previous.document.cards.some((old) => old.id === card.id)) {
        const origin = previous.document.cards.find((item) => item.id === card.regeneration!.sourceID)
        const link = origin?.taskLinks.find((item) => item.visible && item.generationID === card.regeneration!.generationID)
        if (!link || origin?.kind !== card.kind || generation(sessionID, link.generationID).status !== "succeeded")
          throw new BoardError("再次生成来源任务不可用")
        if (JSON.stringify(card.regeneration.snapshot) !== JSON.stringify(link.snapshot) ||
          card.draft.prompt !== link.snapshot.prompt ||
          JSON.stringify(card.draft.settings) !== JSON.stringify(link.snapshot.settings) ||
          JSON.stringify(card.operation) !== JSON.stringify(link.snapshot.operation) ||
          JSON.stringify(card.draft.references ?? []) !== JSON.stringify(link.snapshot.references) || card.draft.assets.length)
          throw new BoardError("再次生成参数与原任务不一致")
      }
      if ((card.draft.references ?? []).some((reference) => !card.regeneration?.snapshot.references.some((original) =>
        JSON.stringify(original) === JSON.stringify({ ...reference,
          role: card.kind === "video" && original.role !== "reference" && reference.role !== "reference" ? original.role : reference.role,
        }))))
        throw new BoardError("固定参考图不属于原任务")
      if (card.operation) {
        const name = boardImageOperationName(card.operation.capability)
        if (card.kind !== "image") throw new BoardError(`${name}只能生成图片卡片`)
        if (!path.resolve(Instance.directory, card.operation.sourceImage).startsWith(uploads + path.sep))
          throw new BoardError(`${name}输入不属于当前会话`)
        if (card.operation.capability === "image.inpaint" &&
          !path.resolve(Instance.directory, card.operation.compositeImage).startsWith(uploads + path.sep))
          throw new BoardError("智能重绘合成图不属于当前会话")
        const source = media(sessionID, card.operation.source)
        if ((source.kind ?? "image") !== "image" || (source.remoteUrl ?? source.url) !== card.operation.source.image)
          throw new BoardError(`${name}来源图片不一致`)
        if (!card.regeneration && !previous.document.cards.some((old) => old.id === card.id)) {
          const origin = document.cards.find((item) => item.id === card.operation!.source.sourceID)
          if (!origin?.taskLinks.some((link) => link.visible && link.generationID === card.operation!.source.generationID))
            throw new BoardError(`${name}来源不属于上游卡片`)
          if (!document.draftEdges.some((edge) => edge.purpose === "derivation" && edge.sourceID === origin.id && edge.targetID === card.id))
            throw new BoardError(`${name}卡片缺少来源连线`)
        }
      }
      card.draft.assets.forEach((asset) => {
        const resolved = path.resolve(Instance.directory, asset.url)
        if (!resolved.startsWith(uploads + path.sep)) throw new BoardError("上传素材不属于当前会话")
        if (card.kind === "image" && asset.role !== "reference") throw new BoardError("图片卡片不能设置视频帧")
      })
      if (
        card.currentGenerationID &&
        !card.taskLinks.some((link) => link.visible && link.generationID === card.currentGenerationID)
      )
        throw new BoardError("当前任务关联无效")
      ;[card.cover, card.preview]
        .filter((ref) => ref !== undefined)
        .forEach((ref) => {
          if (!card.taskLinks.some((link) => link.visible && link.generationID === ref.generationID))
            throw new BoardError("媒体不属于当前卡片")
          if ((media(sessionID, ref).kind ?? "image") !== card.kind) throw new BoardError("媒体类型与卡片不匹配")
        })
    })
    document.draftEdges.forEach((edge, index) => {
      const error = boardEdgeError(
        { ...document, draftEdges: document.draftEdges.slice(0, index) },
        edge.sourceID,
        edge.targetID,
        edge.role,
        edge.purpose,
        edge.reference,
      )
      if (error) throw new BoardError(error)
      if (edge.reference) {
        const source = document.cards.find((card) => card.id === edge.sourceID)
        if (!source?.taskLinks.some((link) => link.visible && link.generationID === edge.reference!.generationID))
          throw new BoardError("固定引用不属于上游卡片")
        const image = media(sessionID, edge.reference)
        if ((image.kind ?? "image") !== "image" || (image.remoteUrl ?? image.url) !== edge.reference.image)
          throw new BoardError("固定引用图片不一致")
      }
    })
    const removed = [
      ...new Set([
        ...previous.document.removedCardIDs,
        ...document.removedCardIDs,
        ...previous.document.cards
          .filter((card) => !document.cards.some((item) => item.id === card.id))
          .map((card) => card.id),
      ]),
    ]
    if (document.cards.some((card) => removed.includes(card.id))) throw new BoardError("已移除卡片不能被旧草稿恢复")
    document.removedCardIDs = removed
    const result = { sessionID, revision: revision + 1, document }
    db.insert(StudioBoardTable)
      .values({
        session_id: SessionID.make(sessionID),
        directory: Instance.directory,
        revision: result.revision,
        document,
        updated_at: Date.now(),
      })
      .onConflictDoUpdate({
        target: StudioBoardTable.session_id,
        set: { revision: result.revision, document, updated_at: Date.now() },
      })
      .run()
    return result
  })
}

export function previousBoardSubmission(sessionID: string, input: BoardSubmission) {
  boardSession(sessionID)
  const row = Database.use((db) =>
    db.select().from(StudioBoardSubmissionTable).where(eq(StudioBoardSubmissionTable.id, input.submissionID)).get(),
  )
  if (!row) return
  if (row.session_id !== sessionID || row.card_id !== input.cardID) throw new BoardError("提交标识不属于当前卡片", 409)
  const link = getBoard(sessionID)
    .document.cards.find((card) => card.id === input.cardID)
    ?.taskLinks.find((item) => item.submissionID === input.submissionID)
  if (!link || JSON.stringify(link.snapshot) !== JSON.stringify(BoardSubmission.parse(input).snapshot))
    throw new BoardError("不能使用同一提交标识修改输入", 409)
  return row.generation_id
}

export function validateBoardSubmission(sessionID: string, value: unknown) {
  const input = BoardSubmission.parse(value)
  const board = getBoard(sessionID)
  if (board.revision !== input.revision) throw new BoardError("画板已更新，请重新保存后发送", 409)
  const card = board.document.cards.find((item) => item.id === input.cardID)
  if (!card) throw new BoardError("卡片不存在")
  const busy = Database.use((db) =>
    db
      .select({ id: StudioGenerationTable.id })
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.session_id, SessionID.make(sessionID)),
          inArray(StudioGenerationTable.status, ["creating", "queued", "running", "abnormal"]),
        ),
      )
      .get(),
  )
  if (busy) throw new BoardError("当前会话仍有活动任务，请等待或核对状态", 409)
  const pending = Database.use((db) =>
    db
      .select({ id: StudioBoardOperationTable.id })
      .from(StudioBoardOperationTable)
      .where(
        and(
          eq(StudioBoardOperationTable.session_id, SessionID.make(sessionID)),
          eq(StudioBoardOperationTable.status, "pending"),
        ),
      )
      .get(),
  )
  if (pending) throw new BoardError("已有重启操作等待核对", 409)
  const error = boardGenerationError(card.kind, input.snapshot)
  if (error) throw new BoardError(error)
  if (JSON.stringify(card.operation) !== JSON.stringify(input.snapshot.operation))
    throw new BoardError("变清晰参数与提交快照不一致")
  if (
    card.draft.prompt.trim() !== input.snapshot.prompt.trim() ||
    JSON.stringify(card.draft.settings) !== JSON.stringify(input.snapshot.settings)
  )
    throw new BoardError("提交内容与当前草稿不一致")
  const expected = boardDraftReferences(board.document, card.id, (source) => {
    if (!source?.cover) throw new BoardError("来源封面不存在")
    const image = media(sessionID, source.cover)
    const url = image.remoteUrl ?? image.url
    if (!url) throw new BoardError("引用媒体不可用，请选择有效结果")
    return url
  })
  if (JSON.stringify(BoardReference.array().parse(expected)) !== JSON.stringify(input.snapshot.references))
    throw new BoardError("参考图已变化，请重新确认后发送")
  if (
    input.replacedGenerationID &&
    (card.currentGenerationID !== input.replacedGenerationID ||
      !["failed", "create_failed"].includes(generation(sessionID, input.replacedGenerationID).status))
  )
    throw new BoardError("待替换任务不是当前失败任务")
  return { input, board, card }
}

export function attachBoardGeneration(sessionID: string, input: BoardSubmission, generationID: string) {
  const board = getBoard(sessionID)
  if (board.revision !== input.revision) throw new BoardError("画板版本冲突", 409)
  const document: BoardDocument = {
    ...board.document,
    cards: board.document.cards.map((card) =>
      card.id !== input.cardID
        ? card
        : {
            ...card,
            currentGenerationID: generationID,
            taskLinks: [
              ...card.taskLinks.map((link) =>
                link.generationID === input.replacedGenerationID ? { ...link, visible: false } : link,
              ),
              { generationID, submissionID: input.submissionID, visible: true, snapshot: input.snapshot },
            ],
          },
    ),
  }
  Database.use((db) => {
    db.update(StudioBoardTable)
      .set({ document, revision: board.revision + 1, updated_at: Date.now() })
      .where(eq(StudioBoardTable.session_id, SessionID.make(sessionID)))
      .run()
    db.insert(StudioBoardSubmissionTable)
      .values({
        id: input.submissionID,
        session_id: SessionID.make(sessionID),
        card_id: input.cardID,
        generation_id: generationID,
      })
      .run()
  })
}

export function boardRebootOperation(
  sessionID: string,
  generationID: string,
  providerTaskID: string,
  operationID: string,
  canStart = true,
  baseline?: typeof StudioBoardOperationTable.$inferInsert.execution_baseline,
) {
  boardSession(sessionID)
  return Database.transaction((db) => {
    const previous = db
      .select()
      .from(StudioBoardOperationTable)
      .where(eq(StudioBoardOperationTable.id, operationID))
      .get()
    if (previous) {
      if (previous.session_id !== sessionID || previous.generation_id !== generationID)
        throw new BoardError("重启操作不属于当前任务", 409)
      if (previous.status === "rejected") throw new BoardError(previous.error ?? "上次重启已被拒绝，请重新操作")
      if (previous.status === "completed" || previous.provider_task_id !== providerTaskID) return "replay" as const
      return "pending" as const
    }
    if (!canStart) throw new BoardError("当前任务不支持重新生成")
    const busy = db
      .select({ id: StudioGenerationTable.id })
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.session_id, SessionID.make(sessionID)),
          inArray(StudioGenerationTable.status, ["creating", "queued", "running", "abnormal"]),
        ),
      )
      .get()
    if (busy) throw new BoardError("当前会话仍有活动任务", 409)
    const pending = db
      .select()
      .from(StudioBoardOperationTable)
      .where(
        and(
          eq(StudioBoardOperationTable.session_id, SessionID.make(sessionID)),
          eq(StudioBoardOperationTable.status, "pending"),
        ),
      )
      .get()
    if (pending) throw new BoardError("已有重启操作等待核对", 409)
    const linked = getBoard(sessionID).document.cards.some((card) =>
      card.taskLinks.some((link) => link.visible && link.generationID === generationID),
    )
    if (!linked) throw new BoardError("该任务已不在画布可见关联中")
    db.insert(StudioBoardOperationTable)
      .values({
        id: operationID,
        session_id: SessionID.make(sessionID),
        generation_id: generationID,
        provider_task_id: providerTaskID,
        execution_baseline: baseline,
        status: "pending",
      })
      .run()
    return "new" as const
  })
}

export function finishBoardReboot(operationID: string, error?: string) {
  Database.use((db) =>
    db
      .update(StudioBoardOperationTable)
      .set({ status: error ? "rejected" : "completed", error: error ?? null })
      .where(eq(StudioBoardOperationTable.id, operationID))
      .run(),
  )
}

export * as StudioBoard from "./studio-board-service"
