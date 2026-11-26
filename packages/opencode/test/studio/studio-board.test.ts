import { expect, test } from "bun:test"
import { BoardSnapshot, BOARD_UPSCALE_PROMPT, BOARD_CUTOUT_PROMPT, boardEdgeError, boardDraftReferences, emptyBoard, newBoardCard, type BoardSubmission } from "@opencode-ai/core/studio-board"
import { Database, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Session } from "@/session/session"
import { createGeneration, cancelGeneration, rebootGeneration, refreshGeneration } from "@/studio/studio-service"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioBoardOperationTable } from "@/studio/studio-board.sql"
import { boardRebootBaseline, boardRebootFailedAgain } from "@/studio/studio-board-reboot"
import {
  getBoard,
  saveBoard,
  validateBoardSubmission,
  attachBoardGeneration,
  previousBoardSubmission,
  boardRebootOperation,
  finishBoardReboot,
} from "@/studio/studio-board-service"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

function session(mode?: "board" | "conversation") {
  const id = SessionID.descending()
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id,
        project_id: Instance.project.id,
        slug: id,
        directory: Instance.directory,
        title: "Studio board test",
        version: "test",
        agent: "octo_studio",
        studio_mode: mode,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run(),
  )
  return id
}
function task(sessionID: SessionID, id: string, status: "succeeded" | "failed" = "failed") {
  Database.use((db) =>
    db
      .insert(StudioGenerationTable)
      .values({
        id,
        session_id: sessionID,
        directory: Instance.directory,
        assistant_message_id: MessageID.ascending(),
        tool_part_id: PartID.ascending(),
        provider: "internel",
        capability: "image.generate",
        status,
        request: { input: { prompt: "原始输入" } },
        result: status === "succeeded" ? { images: [{ id: "image-1", url: "https://example.test/image.png" }] } : null,
        next_poll_at: Number.MAX_SAFE_INTEGER,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run(),
  )
}

test("failed reboot reconciliation requires evidence of a new execution", () => {
  const query = (raw: unknown) => ({
    provider: "internel" as const,
    model: "seedream",
    status: "failed" as const,
    rawStatus: 3,
    progress: 0,
    images: [],
    raw,
  })
  const old = { execution_id: "old", status: 3, timestamp: { start: Date.now() - 60000 } }
  const baseline = boardRebootBaseline(query({ result: { results_v2: [old] } }))
  const failed = (execution: typeof old) => query({ result: { results_v2: [execution] } })
  expect(boardRebootFailedAgain(failed(old), baseline)).toBe(false)
  expect(boardRebootFailedAgain(query({}), baseline)).toBe(false)
  expect(boardRebootFailedAgain(failed({ ...old, execution_id: "new" }), null)).toBe(false)
  expect(boardRebootFailedAgain(failed({ ...old, execution_id: "new" }), baseline)).toBe(true)
  expect(boardRebootFailedAgain(failed({ ...old, timestamp: { start: old.timestamp.start + 1 } }), baseline)).toBe(
    false,
  )
  expect(boardRebootFailedAgain(failed({ ...old, timestamp: { start: baseline.capturedAt + 1000 } }), baseline)).toBe(
    true,
  )
  expect(boardRebootFailedAgain(failed({ ...old, status: 1, execution_id: "new" }), baseline)).toBe(false)
  const missing = boardRebootBaseline(query({}))
  expect(boardRebootFailedAgain(failed(old), missing)).toBe(false)
  expect(boardRebootFailedAgain(failed({ ...old, timestamp: { start: missing.capturedAt + 1000 } }), missing)).toBe(
    true,
  )
  expect(
    boardRebootFailedAgain(failed({ ...old, timestamp: { start: Math.ceil(missing.capturedAt / 1000) + 1 } }), missing),
  ).toBe(true)
})

test("board revision, immutable card types, ownership and duplicate IDs", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const draft = { ...emptyBoard(), cards: [newBoardCard("card-a", "image")] }
      expect(saveBoard(id, 0, draft).revision).toBe(1)
      expect(() => saveBoard(id, 0, draft)).toThrow("其他窗口")
      expect(() => saveBoard(id, 1, { ...draft, cards: [{ ...draft.cards[0], kind: "video" }] })).toThrow("卡片类型")
      expect(getBoard(id).document.cards[0].kind).toBe("image")
      expect(() => getBoard(session("conversation"))).toThrow("画布会话不存在")
      expect(() => saveBoard(id, 1, { ...draft, cards: [...draft.cards, draft.cards[0]] })).toThrow("重复标识")
    },
  })
})

test.each([0.1, 2, 8])("board zoom %s saves and reloads", async (zoom) => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const document = { ...emptyBoard(), viewport: { x: 320, y: -160, zoom } }
      expect(saveBoard(id, 0, document).document).toEqual(document)
      expect(getBoard(id).document).toEqual(document)
    },
  })
})

test.each([
  { model: "qwen", width: undefined, height: undefined, valid: false },
  { model: "qwen", width: 1280, height: undefined, valid: false },
  { model: "qwen", width: 2200, height: 2200, valid: false },
  { model: "qwen", width: 1280, height: 1280, valid: true },
  { model: "seedream-5-pro", width: 1280, height: 720, valid: true },
  { model: "seedream-5-pro", width: 3000, height: 3000, valid: false },
  { model: "seedream-5-pro", width: 120, height: 30000, valid: false },
])("board custom size submission validates $model $width x $height", async (size) => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const card = newBoardCard("size-card", "image")
      card.draft.prompt = "尺寸校验"
      card.draft.settings = {
        ...card.draft.settings,
        styleModel: size.model,
        isCustom: true,
        width: size.width,
        height: size.height,
      }
      // Draft storage remains readable for legacy data; validation happens at submission.
      saveBoard(id, 0, { ...emptyBoard(), cards: [card] })
      const submission: BoardSubmission = {
        cardID: card.id,
        submissionID: crypto.randomUUID(),
        revision: 1,
        snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
      }
      if (size.valid) {
        expect(validateBoardSubmission(id, submission).input.snapshot.settings.width).toBe(size.width)
        return
      }
      expect(() => validateBoardSubmission(id, submission)).toThrow("自定义尺寸")
    },
  })
})

test("new submissions hide only the failed association and preserve original snapshots", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const card = newBoardCard("card-a", "image")
      card.draft.prompt = "红色汽车"
      saveBoard(id, 0, { ...emptyBoard(), cards: [card] })
      const first: BoardSubmission = {
        cardID: card.id,
        submissionID: crypto.randomUUID(),
        revision: 1,
        snapshot: { prompt: "红色汽车", settings: { ...card.draft.settings }, references: [] },
      }
      expect(validateBoardSubmission(id, first).card.id).toBe(card.id)
      task(id, "task-old")
      attachBoardGeneration(id, first, "task-old")
      const board = getBoard(id)
      board.document.cards[0].draft.prompt = "蓝色汽车"
      saveBoard(id, board.revision, board.document)
      const second: BoardSubmission = {
        ...first,
        submissionID: crypto.randomUUID(),
        revision: 3,
        replacedGenerationID: "task-old",
        snapshot: { ...first.snapshot, prompt: "蓝色汽车" },
      }
      expect(validateBoardSubmission(id, second).input.snapshot.prompt).toBe("蓝色汽车")
      task(id, "task-new")
      attachBoardGeneration(id, second, "task-new")
      expect(getBoard(id).document.cards).toHaveLength(1)
      const links = getBoard(id).document.cards[0].taskLinks
      expect(links.map((link) => [link.generationID, link.visible])).toEqual([
        ["task-old", false],
        ["task-new", true],
      ])
      expect(links[0].snapshot.prompt).toBe("红色汽车")
      expect(previousBoardSubmission(id, second)).toBe("task-new")
      expect(() =>
        previousBoardSubmission(id, { ...second, snapshot: { ...second.snapshot, prompt: "篡改" } }),
      ).toThrow("同一提交标识")
      expect(() =>
        saveBoard(id, 4, { ...getBoard(id).document, cards: [{ ...getBoard(id).document.cards[0], taskLinks: [] }] }),
      ).toThrow("任务历史")
    },
  })
})

test("retired board tasks reject new work without leaving reboot locks and still replay accepted operations", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const card = newBoardCard("retired", "image")
      card.draft.prompt = "旧画布任务"
      card.draft.settings.styleModel = "seedream-5-lite"
      saveBoard(id, 0, { ...emptyBoard(), cards: [card] })
      const board: BoardSubmission = {
        cardID: card.id,
        submissionID: crypto.randomUUID(),
        revision: 1,
        snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
      }
      const input = { sessionID: id, capability: "image.generate" as const, prompt: "外层参数", styleModel: "qwen", board }
      await expect(createGeneration(input)).rejects.toThrow("模型已下架或不可用")
      expect(Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.session_id, id)).all())).toHaveLength(0)
      task(id, "retired-board-task")
      Database.use((db) => db.update(StudioGenerationTable).set({
        provider_task_id: "retired-provider-task",
        request: { input: { ...input, prompt: card.draft.prompt, styleModel: "seedream-5-lite" } },
      }).where(eq(StudioGenerationTable.id, "retired-board-task")).run())
      attachBoardGeneration(id, board, "retired-board-task")
      const before = getBoard(id)
      expect((await createGeneration(input)).id).toBe("retired-board-task")
      await expect(rebootGeneration("retired-board-task", crypto.randomUUID())).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("模型已下架或不可用"),
      })
      expect(getBoard(id)).toEqual(before)
      expect(Database.use((db) => db.select().from(StudioBoardOperationTable).where(eq(StudioBoardOperationTable.session_id, id)).all())).toHaveLength(0)
      const operationID = crypto.randomUUID()
      boardRebootOperation(id, "retired-board-task", "retired-provider-task", operationID)
      finishBoardReboot(operationID)
      expect((await rebootGeneration("retired-board-task", operationID)).id).toBe("retired-board-task")
      expect(getBoard(id).pendingReboots).toHaveLength(0)
    },
  })
})

test("references validate original media membership before submission", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const source = newBoardCard("source", "image")
      source.draft.prompt = "来源图片"
      const target = newBoardCard("target", "image")
      target.draft.prompt = "新图片"
      saveBoard(id, 0, { ...emptyBoard(), cards: [source, target] })
      const submission: BoardSubmission = {
        cardID: source.id,
        submissionID: crypto.randomUUID(),
        revision: 1,
        snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
      }
      task(id, "success", "succeeded")
      attachBoardGeneration(id, submission, "success")
      const board = getBoard(id)
      board.document.cards[0].cover = { generationID: "success", mediaID: "image-1" }
      board.document.draftEdges.push({ id: "edge", sourceID: "source", targetID: "target", role: "reference" })
      saveBoard(id, board.revision, board.document)
      const next: BoardSubmission = {
        ...submission,
        cardID: target.id,
        submissionID: crypto.randomUUID(),
        revision: 3,
        snapshot: {
          prompt: target.draft.prompt,
          settings: target.draft.settings,
          references: [
            {
              sourceID: "source",
              title: source.title,
              generationID: "success",
              mediaID: "image-1",
              image: "https://example.test/image.png",
              role: "reference",
            },
          ],
        },
      }
      expect(validateBoardSubmission(id, next).input.snapshot.references[0].mediaID).toBe("image-1")
      expect(() => validateBoardSubmission(id, { ...next, snapshot: { ...next.snapshot, references: [] } })).toThrow(
        "参考图已变化",
      )
      const invalid = getBoard(id)
      invalid.document.cards[1].cover = { generationID: "success", mediaID: "image-1" }
      expect(() => saveBoard(id, invalid.revision, invalid.document)).toThrow("媒体不属于当前卡片")
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({ result: { images: [{ id: "image-1", url: "" }] } })
          .where(eq(StudioGenerationTable.id, "success"))
          .run(),
      )
      expect(() => validateBoardSubmission(id, { ...next, snapshot: { ...next.snapshot, references: [] } })).toThrow(
        "引用媒体不可用",
      )
    },
  })
})

test.each(["firstFrame", "lastFrame"] as const)(
  "%s rejects mixed upload and edge sources without changing the saved revision",
  async (role) => {
    await using dir = await tmpdir()
    await provideTestInstance({
      directory: dir.path,
      fn: async () => {
        const id = session("board")
        const source = newBoardCard("source", "image")
        source.draft.prompt = "来源图片"
        saveBoard(id, 0, { ...emptyBoard(), cards: [source, newBoardCard("target", "video")] })
        const generationID = crypto.randomUUID()
        task(id, generationID, "succeeded")
        attachBoardGeneration(
          id,
          {
            cardID: source.id,
            submissionID: crypto.randomUUID(),
            revision: 1,
            snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
          },
          generationID,
        )
        const board = getBoard(id)
        board.document.cards[0].cover = { generationID, mediaID: "image-1" }
        board.document.cards[1].draft.assets.push({
          id: "frame",
          name: "frame.png",
          url: `${dir.path}/.octo/${id}/uploads/frame.png`,
          role,
        })
        const uploaded = saveBoard(id, board.revision, board.document)
        expect(boardEdgeError(uploaded.document, "source", "target", role)).toBe("该帧已有引用，请先移除")
        uploaded.document.draftEdges.push({ id: "frame-edge", sourceID: "source", targetID: "target", role })
        expect(() => saveBoard(id, uploaded.revision, uploaded.document)).toThrow("同一帧槽位不能存在多个来源")
        expect(getBoard(id).revision).toBe(uploaded.revision)
        uploaded.document.draftEdges[0].role = role === "firstFrame" ? "lastFrame" : "firstFrame"
        const valid = saveBoard(id, uploaded.revision, uploaded.document)
        expect(valid.document.cards[1].draft.assets).toHaveLength(1)
        expect(valid.document.draftEdges).toHaveLength(1)
        valid.document.cards[1].draft.assets.push({
          id: "duplicate",
          name: "duplicate.png",
          url: `${dir.path}/.octo/${id}/uploads/duplicate.png`,
          role: valid.document.draftEdges[0].role,
        })
        expect(() => saveBoard(id, valid.revision, valid.document)).toThrow("同一帧槽位不能存在多个来源")
        expect(getBoard(id).revision).toBe(valid.revision)
      },
    })
  },
)

test("video mode changes save inactive frame edges and validate only active references", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const source = newBoardCard("source", "image")
      source.draft.prompt = "来源图片"
      const target = newBoardCard("target", "video")
      target.draft.prompt = "视频"
      target.draft.settings.videoInputMode = "first-last-frame"
      saveBoard(id, 0, { ...emptyBoard(), cards: [source, target] })
      task(id, "source-task", "succeeded")
      attachBoardGeneration(
        id,
        {
          cardID: source.id,
          submissionID: crypto.randomUUID(),
          revision: 1,
          snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
        },
        "source-task",
      )
      const board = getBoard(id)
      board.document.cards[0].cover = { generationID: "source-task", mediaID: "image-1" }
      board.document.draftEdges.push({ id: "frame", sourceID: source.id, targetID: target.id, role: "firstFrame" })
      board.document.cards[1].draft.settings.videoInputMode = "multi-reference"
      const saved = saveBoard(id, board.revision, board.document)
      expect(saved.document.draftEdges).toHaveLength(1)
      const snapshot = { prompt: target.draft.prompt, settings: saved.document.cards[1].draft.settings, references: [] }
      expect(() =>
        validateBoardSubmission(id, {
          cardID: target.id,
          submissionID: crypto.randomUUID(),
          revision: saved.revision,
          snapshot,
        }),
      ).not.toThrow()
      saved.document.cards[1].draft.settings.videoInputMode = "first-last-frame"
      const restored = saveBoard(id, saved.revision, saved.document)
      expect(boardDraftReferences(restored.document, target.id, () => "https://example.test/image.png")).toMatchObject([
        { sourceID: source.id, role: "firstFrame" },
      ])
    },
  })
})

test("uploaded references are compared by canonical fields and altered uploads are rejected", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const card = newBoardCard("upload-card", "image")
      card.draft.prompt = "参考上传图片"
      card.draft.assets.push({
        id: "upload",
        name: "photo.png",
        url: `${dir.path}/.octo/${id}/uploads/photo.png`,
        role: "reference",
      })
      saveBoard(id, 0, { ...emptyBoard(), cards: [card] })
      const submission: BoardSubmission = {
        cardID: card.id,
        submissionID: crypto.randomUUID(),
        revision: 1,
        snapshot: {
          prompt: card.draft.prompt,
          settings: card.draft.settings,
          references: [
            {
              sourceID: "upload:upload",
              title: "photo.png",
              generationID: "",
              mediaID: "upload",
              image: card.draft.assets[0].url,
              role: "reference",
            },
          ],
        },
      }
      expect(validateBoardSubmission(id, submission).input.snapshot.references[0].mediaID).toBe("upload")
      expect(() =>
        validateBoardSubmission(id, {
          ...submission,
          snapshot: {
            ...submission.snapshot,
            references: [{ ...submission.snapshot.references[0], image: "https://example.test/other.png" }],
          },
        }),
      ).toThrow("参考图已变化")
    },
  })
})

test("unresolved reboots block submissions and other-card reboots until definitively resolved", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const cards = [newBoardCard("first", "image"), newBoardCard("second", "image")]
      cards.forEach((card) => {
        card.draft.prompt = "再次生成"
      })
      saveBoard(id, 0, { ...emptyBoard(), cards })
      cards.forEach((card) => {
        task(id, card.id)
        attachBoardGeneration(
          id,
          {
            cardID: card.id,
            submissionID: crypto.randomUUID(),
            revision: getBoard(id).revision,
            snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
          },
          card.id,
        )
      })
      const submission: BoardSubmission = {
        cardID: cards[1].id,
        submissionID: crypto.randomUUID(),
        revision: getBoard(id).revision,
        snapshot: { prompt: cards[1].draft.prompt, settings: cards[1].draft.settings, references: [] },
      }
      const operationID = crypto.randomUUID()
      expect(boardRebootOperation(id, "first", "provider-first", operationID)).toBe("new")
      expect(boardRebootOperation(id, "first", "provider-first", operationID)).toBe("pending")
      expect(() => validateBoardSubmission(id, submission)).toThrow("等待核对")
      expect(() => boardRebootOperation(id, "second", "provider-second", crypto.randomUUID())).toThrow("等待核对")
      finishBoardReboot(operationID, "明确拒绝")
      expect(() => boardRebootOperation(id, "first", "provider-first", operationID)).toThrow("明确拒绝")
      expect(validateBoardSubmission(id, submission).card.id).toBe("second")
      const next = crypto.randomUUID()
      expect(boardRebootOperation(id, "second", "provider-second", next)).toBe("new")
      finishBoardReboot(next)
      expect(boardRebootOperation(id, "second", "provider-second", next, false)).toBe("replay")
      expect(validateBoardSubmission(id, submission).card.id).toBe("second")
    },
  })
})

test("type filtering precedes pagination and old Studio sessions remain conversations", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const old = session()
      const conversation = session("conversation")
      const board = session("board")
      expect(
        [
          ...Session.listGlobal({
            directory: Instance.directory,
            agent: "octo_studio",
            studio_mode: "board",
            limit: 1,
          }),
        ].map((item) => item.id),
      ).toEqual([board])
      expect(
        [...Session.listGlobal({ directory: Instance.directory, studio_mode: "conversation", limit: 20 })]
          .map((item) => item.id)
          .sort(),
      ).toEqual([old, conversation].sort())
      Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, board)).run())
      expect(() => getBoard(board)).toThrow("画布会话不存在")
    },
  })
})

test.each(["stored", "legacy"])(
  "board generation and %s reboot baselines reconcile without duplicate provider calls",
  async (mode) => {
    const requests: {
      task_type?: string
      user?: { idx?: string }
      args?: {
        customer_prompt?: string
        prompt?: string
        mode?: string
        duration?: string
        resolution?: string
        count?: number
        image_list?: { image: string }[]
      }
    }[] = []
    const reboots: { user?: { idx?: string } }[] = []
    const upstreamState = {
      rebootUnknown: true,
      queryStatus: 1,
      queryUnavailable: false,
      executionID: "original-execution",
      executionStart: Date.now() - 60000,
    }
    using upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const route = new URL(request.url).pathname
        if (route === "/create") {
          requests.push((await request.json()) as (typeof requests)[number])
          return Response.json({ resp_code: 200, task_id: "provider-original" })
        }
        if (route === "/reboot") {
          reboots.push((await request.json()) as (typeof reboots)[number])
          if (upstreamState.rebootUnknown) return Response.json({ error: "response lost" }, { status: 503 })
          return Response.json({ resp_code: 200, task_id: "provider-rebooted" })
        }
        if (route === "/cancel") return Response.json({ resp_code: 200, result: true })
        if (route === "/history") return Response.json({ resp_code: 200, result: [] })
        if (upstreamState.queryUnavailable) return Response.json({ error: "unavailable" }, { status: 503 })
        return Response.json({
          resp_code: 200,
          result: {
            status: upstreamState.queryStatus,
            progress: 20,
            error_message: "新一轮执行失败",
            results_v2: [
              {
                execution_id: upstreamState.executionID,
                status: upstreamState.queryStatus,
                timestamp: { start: upstreamState.executionStart },
              },
            ],
            ...(upstreamState.queryStatus === 2
              ? {
                  results: [
                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                  ],
                }
              : {}),
          },
        })
      },
    })
    const values = {
      IMAGE_CREATE_TASK_URL: new URL("/create", upstream.url).href,
      IMAGE_QUERY_TASK_BASE_URL: new URL("/query/", upstream.url).href,
      IMAGE_GET_HISTORY_URL: new URL("/history", upstream.url).href,
      IMAGE_CANCEL_TASK_URL: new URL("/cancel", upstream.url).href,
      IMAGE_REBOOT_TASK_URL: new URL("/reboot", upstream.url).href,
      IMAGE_USER_IDX: "board-test",
    }
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
    using environment = {
      [Symbol.dispose]() {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) {
            delete process.env[key]
            return
          }
          process.env[key] = value
        })
      },
    }
    Object.entries(values).forEach(([key, value]) => {
      process.env[key] = value
    })
    await using dir = await tmpdir()
    await provideTestInstance({
      directory: dir.path,
      fn: async () => {
        const id = session("board")
        task(id, `previous-unrelated-${mode}`, "succeeded")
        const card = newBoardCard("card-direct", "image")
        card.draft.prompt = "用户输入的原文"
        saveBoard(id, 0, { ...emptyBoard(), cards: [card] })
        const board: BoardSubmission = {
          cardID: card.id,
          submissionID: crypto.randomUUID(),
          revision: 1,
          snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
        }
        const input = {
          sessionID: id,
          capability: "image.generate" as const,
          styleModel: "seedream-5-lite",
          prompt: card.draft.prompt,
          effectivePrompt: "不得继承的旧扩写",
          extra: { userIdx: "current-board-user", studioContext: "不得继承的对话上下文" },
          board,
        }
        const accepted = await createGeneration(input)
        expect((await createGeneration(input)).id).toBe(accepted.id)
        for (const attempt of Array.from({ length: 80 }, (_, index) => index)) {
          const row = Database.use((db) =>
            db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, accepted.id)).get(),
          )
          if (row?.provider_task_id) break
          if (attempt === 79) throw new Error("Provider creation did not finish")
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(requests).toHaveLength(1)
        expect(requests[0].user?.idx).toBe("current-board-user")
        expect(requests[0].args?.customer_prompt).toBe(card.draft.prompt)
        expect(requests[0].args?.prompt).toBe(card.draft.prompt)
        expect(requests[0].args?.mode).toBe("performance")
        const cancelled = await cancelGeneration(accepted.id)
        expect(cancelled.status).toBe("failed")
        upstreamState.queryUnavailable = true
        await expect(rebootGeneration(accepted.id, crypto.randomUUID())).rejects.toMatchObject({ status: 400 })
        expect(getBoard(id).pendingReboots).toHaveLength(0)
        expect(reboots).toHaveLength(0)
        upstreamState.queryUnavailable = false
        upstreamState.queryStatus = 4
        const operationID = crypto.randomUUID()
        const unresolved = rebootGeneration(accepted.id, operationID)
        await expect(unresolved).rejects.toThrow("尚未确认")
        await expect(unresolved).rejects.toMatchObject({ status: 409 })
        expect(getBoard(id).pendingReboots).toEqual([{ cardID: card.id, generationID: accepted.id, operationID }])
        const persisted = Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, accepted.id)).get())!
        Database.use((db) => db.update(StudioGenerationTable).set({
          request: { ...persisted.request, input: { ...input, styleModel: "seedream-5-lite" } },
        }).where(eq(StudioGenerationTable.id, accepted.id)).run())
        await expect(rebootGeneration(accepted.id, operationID)).rejects.toThrow("上游尚未确认")
        expect(reboots).toHaveLength(1)
        expect(getBoard(id).pendingReboots).toHaveLength(1)
        Database.use((db) => db.update(StudioGenerationTable).set({ request: persisted.request }).where(eq(StudioGenerationTable.id, accepted.id)).run())
        const before = getBoard(id)
        expect(() => saveBoard(id, before.revision, { ...before.document, cards: [] })).toThrow("活动任务")
        upstreamState.queryStatus = 4
        await expect(refreshGeneration(accepted.id)).rejects.toThrow("上游尚未确认")
        expect(getBoard(id).pendingReboots).toHaveLength(1)
        upstreamState.queryUnavailable = true
        await expect(refreshGeneration(accepted.id)).rejects.toMatchObject({ status: 409 })
        expect(getBoard(id).pendingReboots).toHaveLength(1)
        upstreamState.queryUnavailable = false
        const baseline = Database.use((db) =>
          db.select().from(StudioBoardOperationTable).where(eq(StudioBoardOperationTable.id, operationID)).get(),
        )
        expect(baseline?.execution_baseline?.executions[0].execution_id).toBe("original-execution")
        if (mode === "legacy")
          Database.use((db) =>
            db
              .update(StudioBoardOperationTable)
              .set({ execution_baseline: null })
              .where(eq(StudioBoardOperationTable.id, operationID))
              .run(),
          )
        upstreamState.executionID = "reboot-execution"
        upstreamState.executionStart = Date.now() + 1
        upstreamState.queryStatus = 3
        const failedAgain = await refreshGeneration(accepted.id)
        expect(failedAgain.status).toBe("failed")
        expect(failedAgain.error).toBe("新一轮执行失败")
        expect(Number(failedAgain.rawStatus)).toBe(3)
        expect(failedAgain.completedAt).toBeGreaterThanOrEqual(cancelled.completedAt!)
        expect(getBoard(id).pendingReboots).toHaveLength(0)
        expect(() =>
          validateBoardSubmission(id, {
            ...board,
            revision: getBoard(id).revision,
            submissionID: crypto.randomUUID(),
            replacedGenerationID: accepted.id,
          }),
        ).not.toThrow()
        expect((await rebootGeneration(accepted.id, operationID)).error).toBe("新一轮执行失败")
        expect(reboots).toHaveLength(1)
        const runningID = crypto.randomUUID()
        await expect(rebootGeneration(accepted.id, runningID)).rejects.toThrow("尚未确认")
        upstreamState.queryStatus = 1
        const rebooted = await rebootGeneration(accepted.id, runningID)
        expect(rebooted.id).toBe(accepted.id)
        expect(rebooted.status).toBe("running")
        expect(getBoard(id).pendingReboots).toHaveLength(0)
        expect((await rebootGeneration(accepted.id, runningID)).id).toBe(accepted.id)
        expect(reboots).toHaveLength(2)
        expect(reboots[0].user?.idx).toBe("current-board-user")
        expect(getBoard(id).document.cards).toHaveLength(1)
        expect(getBoard(id).document.cards[0].taskLinks).toHaveLength(1)
        await cancelGeneration(accepted.id)
        const refreshID = crypto.randomUUID()
        await expect(rebootGeneration(accepted.id, refreshID)).rejects.toThrow("尚未确认")
        upstreamState.queryStatus = 6
        expect((await refreshGeneration(accepted.id)).status).toBe("queued")
        expect(getBoard(id).pendingReboots).toHaveLength(0)
        expect(reboots).toHaveLength(3)
        await cancelGeneration(accepted.id)
        upstreamState.rebootUnknown = false
        upstreamState.queryStatus = 1
        const confirmedID = crypto.randomUUID()
        expect((await rebootGeneration(accepted.id, confirmedID)).taskId).toBe("provider-rebooted")
        await rebootGeneration(accepted.id, confirmedID)
        expect(reboots).toHaveLength(4)
        await cancelGeneration(accepted.id)
        const stored = getBoard(id)
        const video = newBoardCard("video", "video")
        video.draft.prompt = "镜头缓慢向湖面推进"
        video.draft.settings.duration = "8"
        video.draft.settings.quality = "1080"
        stored.document.cards.push(video)
        const saved = saveBoard(id, stored.revision, stored.document)
        const next = await createGeneration({
          sessionID: id,
          capability: "video.generate",
          prompt: video.draft.prompt,
          board: {
            cardID: video.id,
            submissionID: crypto.randomUUID(),
            revision: saved.revision,
            snapshot: { prompt: video.draft.prompt, settings: video.draft.settings, references: [] },
          },
        })
        for (const attempt of Array.from({ length: 80 }, (_, index) => index)) {
          const row = Database.use((db) =>
            db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, next.id)).get(),
          )
          if (row?.provider_task_id) break
          if (attempt === 79) throw new Error("Video creation did not finish")
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(requests[1].args).toMatchObject({
          prompt: video.draft.prompt,
          duration: "8",
          resolution: "1080p",
          count: 1,
        })
        await cancelGeneration(next.id)
        const multiBoard = getBoard(id)
        const multi = multiBoard.document.cards.find((card) => card.id === video.id)!
        multi.draft.settings.videoInputMode = "multi-reference"
        multi.draft.settings.videoMode = "first_last_frame"
        multi.draft.settings.styleModel = "portrait"
        multi.draft.assets = ["reference", "reference", "firstFrame"].map((role, index) => ({
          id: `multi-${index}`,
          name: `multi-${index}.png`,
          url: `${dir.path}/.octo/${id}/uploads/multi-${index}.png`,
          role: role as "reference" | "firstFrame",
        }))
        await Promise.all(
          multi.draft.assets.map((asset) =>
            Bun.write(
              asset.url,
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                "base64",
              ),
            ),
          ),
        )
        const multiSaved = saveBoard(id, multiBoard.revision, multiBoard.document)
        const multiTask = await createGeneration({
          sessionID: id,
          capability: "video.generate",
          prompt: multi.draft.prompt,
          board: {
            cardID: multi.id,
            submissionID: crypto.randomUUID(),
            revision: multiSaved.revision,
            snapshot: {
              prompt: multi.draft.prompt,
              settings: multi.draft.settings,
              references: boardDraftReferences(multiSaved.document, multi.id, () => undefined),
            },
          },
        })
        for (const attempt of Array.from({ length: 80 }, (_, index) => index)) {
          const row = Database.use((db) =>
            db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, multiTask.id)).get(),
          )
          if (row?.provider_task_id) break
          if (attempt === 79) throw new Error("Multi-reference video creation did not finish")
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(requests[2].task_type).toBe("multi-i2v_seedance")
        expect(requests[2].args?.image_list).toHaveLength(2)
        expect(getBoard(id).document.cards.find((card) => card.id === multi.id)?.draft.settings.videoInputMode).toBe(
          "multi-reference",
        )
        await cancelGeneration(multiTask.id)
        upstreamState.rebootUnknown = true
        const completedID = crypto.randomUUID()
        await expect(rebootGeneration(accepted.id, completedID)).rejects.toThrow("尚未确认")
        upstreamState.queryStatus = 2
        const completed = await refreshGeneration(accepted.id)
        expect(completed.status).toBe("succeeded")
        expect(completed.images).toHaveLength(1)
        expect(getBoard(id).pendingReboots).toHaveLength(0)
        expect((await rebootGeneration(accepted.id, completedID)).status).toBe("succeeded")
        expect(reboots).toHaveLength(5)
      },
    })
  },
)

test("board image operations pin their source, validate snapshots and send native magnify, remove_bg, inpainting and outpainting requests", async () => {
  const requests: { task_type: string; args: { left?: number; right?: number; top?: number; bottom?: number; mode?: string; prompt?: string; generate_mode?: string; has_drawing?: boolean; image_base64?: string; num_image?: number; image_list?: { mode: string; image_base64: string }[] }; user: { idx: string } }[] = []
  using upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname
      if (route === "/create") {
        requests.push(await request.json() as (typeof requests)[number])
        return Response.json({ resp_code: 200, task_id: `upscale-${requests.length}` })
      }
      if (route === "/cancel") return Response.json({ resp_code: 200, result: true })
      if (route === "/history") return Response.json({ resp_code: 200, result: [] })
      return Response.json({ resp_code: 200, result: { status: 1, progress: 10 } })
    },
  })
  const values = {
    IMAGE_CREATE_TASK_URL: new URL("/create", upstream.url).href,
    IMAGE_QUERY_TASK_BASE_URL: new URL("/query/", upstream.url).href,
    IMAGE_GET_HISTORY_URL: new URL("/history", upstream.url).href,
    IMAGE_CANCEL_TASK_URL: new URL("/cancel", upstream.url).href,
    IMAGE_USER_IDX: "upscale-test",
  }
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  using environment = {
    [Symbol.dispose]() {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) { delete process.env[key]; return }
        process.env[key] = value
      })
    },
  }
  Object.entries(values).forEach(([key, value]) => { process.env[key] = value })
  await using dir = await tmpdir()
  await provideTestInstance({
    directory: dir.path,
    fn: async () => {
      const id = session("board")
      const source = newBoardCard("upscale-source", "image")
      source.draft.prompt = "来源图片"
      saveBoard(id, 0, { ...emptyBoard(), cards: [source] })
      task(id, "upscale-original", "succeeded")
      attachBoardGeneration(id, {
        cardID: source.id, submissionID: crypto.randomUUID(), revision: 1,
        snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
      }, "upscale-original")
      const initial = getBoard(id)
      initial.document.cards[0].cover = { generationID: "upscale-original", mediaID: "image-1" }
      saveBoard(id, initial.revision, initial.document)
      const bytes = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
      const sourceImage = `${dir.path}/.octo/${id}/uploads/upscale.png`
      await Bun.write(sourceImage, Buffer.from(bytes, "base64"))
      const compositeImage = `${dir.path}/.octo/${id}/uploads/composite.png`
      const compositeBytes = Buffer.concat([Buffer.from(bytes, "base64"), Buffer.from("painted")]).toString("base64")
      await Bun.write(compositeImage, Buffer.from(compositeBytes, "base64"))
      task(id, "upscale-changed-cover", "succeeded")
      const beforeCover = getBoard(id)
      attachBoardGeneration(id, {
        cardID: source.id, submissionID: crypto.randomUUID(), revision: beforeCover.revision,
        snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
      }, "upscale-changed-cover")
      const changedCover = getBoard(id)
      changedCover.document.cards[0].cover = { generationID: "upscale-changed-cover", mediaID: "image-1" }
      saveBoard(id, changedCover.revision, changedCover.document)
      for (const mode of ["restoration_8k", "restoration", "super_resolution", "cutout", "qwen_image_edit", "erase", "prompt-only", "outpaint"] as const) {
        const inpaint = mode === "qwen_image_edit" || mode === "erase" || mode === "prompt-only"
        const capability = mode === "outpaint" ? "image.outpaint" : inpaint ? "image.inpaint" : mode === "cutout" ? "image.cutout" : "image.upscale"
        const board = getBoard(id)
        const child = newBoardCard(`upscale-${mode}`, "image", { x: 500, y: 100 })
        child.draft.prompt = mode === "outpaint" ? "保留主体，扩展环境" : inpaint ? "修改指定区域" : mode === "cutout" ? "对当前图片进行抠图，移除背景并保留主体" : "将当前图片变清晰，提升分辨率和细节"
        child.draft.settings.styleModel = "seedream-5-lite"
        child.operation = {
          ...(mode === "outpaint" ? {
            capability: "image.outpaint" as const, sourceWidth: 600, sourceHeight: 300,
            left: 100, right: 200, top: 50, bottom: 150, realWidth: 900, realHeight: 500,
          } : mode === "qwen_image_edit" || mode === "erase" || mode === "prompt-only" ? {
            capability: "image.inpaint" as const, generateMode: mode === "erase" ? "erase" as const : "qwen_image_edit" as const,
            compositeImage, hasDrawing: mode !== "prompt-only", brushSize: 40,
          } : mode === "cutout" ? { capability: "image.cutout" as const } : { capability: "image.upscale" as const, mode }), sourceImage,
          source: { sourceID: source.id, generationID: "upscale-original", mediaID: "image-1", title: source.title, image: "https://example.test/image.png", role: "reference" },
        }
        board.document.cards.push(child)
        board.document.draftEdges.push({ id: `edge-${mode}`, sourceID: source.id, targetID: child.id, role: "reference", purpose: "derivation" })
        if (child.operation.capability === "image.inpaint") {
          const foreign = structuredClone(board.document)
          const operation = foreign.cards.at(-1)!.operation!
          if (operation.capability === "image.inpaint") operation.compositeImage = "/foreign/composite.png"
          expect(() => saveBoard(id, board.revision, foreign)).toThrow("合成图不属于当前会话")
        }
        const saved = saveBoard(id, board.revision, board.document)
        const submission: BoardSubmission = {
          cardID: child.id, submissionID: crypto.randomUUID(), revision: saved.revision,
          snapshot: { prompt: child.draft.prompt, settings: child.draft.settings, references: [], operation: child.operation },
        }
        expect(validateBoardSubmission(id, submission).card.operation?.source.generationID).toBe("upscale-original")
        expect(boardDraftReferences(saved.document, child.id, () => "changed-cover")).toEqual([])
        expect(() => validateBoardSubmission(id, {
          ...submission, snapshot: { ...submission.snapshot, operation: { ...child.operation!, sourceImage: "/foreign/source.png" } },
        })).toThrow("快照不一致")
        const changed = structuredClone(saved.document)
        changed.cards.find((card) => card.id === child.id)!.operation = {
          ...child.operation,
          sourceImage: sourceImage + ".changed",
        }
        expect(() => saveBoard(id, saved.revision, changed)).toThrow("任务历史")
        const input = {
          sessionID: id, capability, prompt: child.draft.prompt,
          sourceImage: "https://example.test/wrong-source.png", extra: { left: 999, right: -1, top: 0, bottom: 0, mode: "wrong-mode", generateMode: "wrong-mode", compositeImage: "/foreign/composite.png", hasDrawing: false, userIdx: "current-upscale-user" }, board: submission,
        } satisfies Parameters<typeof createGeneration>[0]
        const accepted = await createGeneration(input)
        expect((await createGeneration(input)).id).toBe(accepted.id)
        for (const attempt of Array.from({ length: 100 }, (_, index) => index)) {
          const row = Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, accepted.id)).get())
          if (row?.provider_task_id) break
          if (row?.status === "failed" || attempt === 99) throw new Error(`Upscale did not start: ${JSON.stringify(row?.result)}`)
          await Bun.sleep(25)
        }
        expect(requests.at(-1)).toEqual({
          task_type: mode === "outpaint" ? "outpainting" : inpaint ? "inpainting" : mode === "cutout" ? "remove_bg" : "magnify", user: { idx: "current-upscale-user" },
          args: mode === "outpaint"
            ? { prompt: child.draft.prompt, image_base64: `data:image/png;base64,${bytes}`, left: 100, right: 200, top: 50, bottom: 150, num_image: 1 }
            : inpaint
            ? { prompt: child.draft.prompt, has_drawing: mode !== "prompt-only", image_base64: compositeBytes,
                generate_mode: mode === "erase" ? "erase" : "qwen_image_edit", num_image: 1 }
            : mode === "cutout"
            ? { num_image: 1, image_list: [{ mode: "new", image_base64: `data:image/png;base64,${bytes}` }] }
            : { mode, image_base64: `data:image/png;base64,${bytes}` },
        })
        expect(getBoard(id).document.cards.find((card) => card.id === child.id)?.taskLinks[0].snapshot.operation).toEqual(child.operation)
        await cancelGeneration(accepted.id)
        Database.use((db) => db.update(StudioGenerationTable).set({ status: "succeeded",
          result: { images: [{ id: "operation-output", url: "https://example.test/processed.png" }] },
        }).where(eq(StudioGenerationTable.id, accepted.id)).run())
        const replayBoard = getBoard(id)
        const replay = newBoardCard(`${child.id}-regeneration`, "image", { x: 1000, y: 100 })
        replay.operation = child.operation
        replay.regeneration = { sourceID: child.id, generationID: accepted.id, snapshot: BoardSnapshot.parse(submission.snapshot) }
        replay.draft = { prompt: submission.snapshot.prompt, settings: { ...submission.snapshot.settings }, assets: [], references: [] }
        replayBoard.document.cards.push(replay)
        const replaySaved = saveBoard(id, replayBoard.revision, replayBoard.document)
        const expectedRequest = requests.at(-1)
        const rerun = await createGeneration({ sessionID: id, capability, prompt: replay.draft.prompt,
          extra: { userIdx: "current-upscale-user" },
          board: { cardID: replay.id, submissionID: crypto.randomUUID(), revision: replaySaved.revision, snapshot: submission.snapshot },
        })
        for (const attempt of Array.from({ length: 100 }, (_, index) => index)) {
          const row = Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, rerun.id)).get())
          if (row?.provider_task_id) break
          if (row?.status === "failed" || attempt === 99) throw new Error(`Regeneration did not start: ${JSON.stringify(row?.result)}`)
          await Bun.sleep(25)
        }
        expect(requests.at(-1)).toEqual(expectedRequest)
        expect(replaySaved.document.draftEdges.some((edge) => edge.targetID === replay.id)).toBe(false)
        await cancelGeneration(rerun.id)
      }
      expect(requests).toHaveLength(16)
    },
  })
})

test("video pinned frames validate media ownership and remain stable when their source cover changes", async () => {
  await using dir = await tmpdir()
  await provideTestInstance({ directory: dir.path, fn: async () => {
    const id = session("board")
    const source = newBoardCard("source", "image")
    source.draft.prompt = "来源图片"
    saveBoard(id, 0, { ...emptyBoard(), cards: [source] })
    task(id, "original-frame", "succeeded")
    attachBoardGeneration(id, { cardID: source.id, submissionID: crypto.randomUUID(), revision: 1,
      snapshot: { ...source.draft, references: [] } }, "original-frame")
    task(id, "changed-cover", "succeeded")
    attachBoardGeneration(id, { cardID: source.id, submissionID: crypto.randomUUID(), revision: getBoard(id).revision,
      snapshot: { ...source.draft, references: [] } }, "changed-cover")
    const board = getBoard(id)
    board.document.cards[0].cover = { generationID: "changed-cover", mediaID: "image-1" }
    const video = newBoardCard("video", "video")
    video.draft.prompt = "镜头推进"
    video.draft.settings.videoInputMode = "first-last-frame"
    video.draft.settings.videoMode = "first_last_frame"
    const reference = { sourceID: source.id, generationID: "original-frame", mediaID: "image-1", title: "原图",
      image: "https://example.test/image.png", role: "firstFrame" as const }
    board.document.cards.push(video)
    board.document.draftEdges.push({ id: "frame", sourceID: source.id, targetID: video.id, role: "firstFrame", reference })
    const forged = structuredClone(board.document)
    forged.draftEdges[0].reference!.image = "https://example.test/forged.png"
    expect(() => saveBoard(id, board.revision, forged)).toThrow("固定引用图片不一致")
    task(id, "unrelated-frame", "succeeded")
    forged.draftEdges[0].reference = { ...reference, generationID: "unrelated-frame" }
    expect(() => saveBoard(id, board.revision, forged)).toThrow("不属于上游卡片")
    const saved = saveBoard(id, board.revision, board.document)
    const submission = { cardID: video.id, submissionID: crypto.randomUUID(), revision: saved.revision,
      snapshot: { ...video.draft, references: [reference] } }
    expect(validateBoardSubmission(id, submission).input.snapshot.references).toEqual([reference])
    expect(() => validateBoardSubmission(id, { ...submission, snapshot: { ...submission.snapshot,
      references: [{ ...reference, generationID: "changed-cover" }] } })).toThrow("参考图已变化")
    const swapped = structuredClone(saved.document)
    swapped.draftEdges[0].role = "lastFrame"
    expect(() => saveBoard(id, saved.revision, swapped)).toThrow("不一致")
    const multi = structuredClone(saved.document)
    multi.cards[1].draft.settings.videoInputMode = "multi-reference"
    const multiSaved = saveBoard(id, saved.revision, multi)
    expect(validateBoardSubmission(id, { ...submission, revision: multiSaved.revision, snapshot: {
      ...video.draft, settings: multi.cards[1].draft.settings, references: [{ ...reference, role: "reference" }],
    } }).input.snapshot.references).toEqual([{ ...reference, role: "reference" }])
  } })
})


test.each(["image", "video", "upscale", "cutout", "inpaint", "outpaint"] as const)(
  "regeneration %s validates its source snapshot and preserves inputs without a new edge", async (kind) => {
    await using dir = await tmpdir()
    await provideTestInstance({ directory: dir.path, fn: async () => {
      const id = session("board")
      const input = newBoardCard("input", "image")
      saveBoard(id, 0, { ...emptyBoard(), cards: [input] })
      task(id, `regen-input-${kind}`, "succeeded")
      attachBoardGeneration(id, { cardID: input.id, revision: 1, submissionID: crypto.randomUUID(),
        snapshot: { prompt: "原图", settings: input.draft.settings, references: [] } }, `regen-input-${kind}`)
      const before = getBoard(id)
      before.document.cards[0].cover = { generationID: `regen-input-${kind}`, mediaID: "image-1" }
      const origin = newBoardCard("origin", kind === "video" ? "video" : "image")
      const reference = { sourceID: input.id, generationID: `regen-input-${kind}`, mediaID: "image-1", title: input.title,
        image: "https://example.test/image.png", role: kind === "video" ? "firstFrame" as const : "reference" as const }
      const upload = `${dir.path}/.octo/${id}/uploads/source.png`
      const snapshot = BoardSnapshot.parse({ prompt: "原任务提示词", settings: { styleModel: "seedream-5-pro", count: 2,
        ...(kind === "video" ? { videoMode: "first_last_frame", videoInputMode: "first-last-frame", duration: "8", quality: "1080" } : {}) },
        references: [reference, { sourceID: "upload:upload", generationID: "", mediaID: "upload", title: "上传参考图", image: upload,
          role: kind === "video" ? "lastFrame" : "reference" }],
      })
      if (kind !== "image" && kind !== "video") {
        snapshot.references = []
        snapshot.settings.count = 1
        snapshot.prompt = kind === "upscale" ? BOARD_UPSCALE_PROMPT : kind === "cutout" ? BOARD_CUTOUT_PROMPT : "原任务提示词"
        snapshot.operation = {
          ...(kind === "upscale" ? { capability: "image.upscale", mode: "super_resolution" } as const
            : kind === "cutout" ? { capability: "image.cutout" } as const
            : kind === "inpaint" ? { capability: "image.inpaint", compositeImage: upload, generateMode: "erase", hasDrawing: true, brushSize: 64 } as const
            : { capability: "image.outpaint", sourceWidth: 600, sourceHeight: 300, left: 100, right: 200, top: 50, bottom: 150,
              realWidth: 900, realHeight: 500 } as const), sourceImage: upload, source: { ...reference, role: "reference" },
        }
      }
      origin.operation = snapshot.operation
      origin.draft = { prompt: snapshot.prompt, settings: snapshot.settings, assets: snapshot.operation ? [] : [
        { id: "upload", name: "上传参考图", url: upload, role: kind === "video" ? "lastFrame" : "reference" },
      ] }
      before.document.cards.push(origin)
      before.document.draftEdges.push({ id: "original-edge", sourceID: input.id, targetID: origin.id, role: reference.role,
        ...(snapshot.operation ? { purpose: "derivation" } : {}),
      })
      const saved = saveBoard(id, before.revision, before.document)
      const original: BoardSubmission = { cardID: origin.id, revision: saved.revision, submissionID: crypto.randomUUID(), snapshot }
      validateBoardSubmission(id, original)
      task(id, `regen-original-${kind}`, "succeeded")
      attachBoardGeneration(id, original, `regen-original-${kind}`)
      const board = getBoard(id)
      board.document.cards.find((card) => card.id === origin.id)!.draft.prompt = "后来修改的草稿"
      saveBoard(id, board.revision, board.document)
      const current = getBoard(id)
      const replay = newBoardCard("regeneration", origin.kind)
      replay.operation = snapshot.operation
      replay.regeneration = { sourceID: origin.id, generationID: `regen-original-${kind}`, snapshot: BoardSnapshot.parse(snapshot) }
      replay.draft = { prompt: snapshot.prompt, settings: { ...snapshot.settings }, assets: [], references: snapshot.references.map((ref) => ({ ...ref })) }
      current.document.cards.push(replay)
      const forged = structuredClone(current.document)
      forged.cards.at(-1)!.regeneration!.snapshot.prompt = "伪造参数"
      expect(() => saveBoard(id, current.revision, forged)).toThrow("再次生成参数与原任务不一致")
      const foreign = structuredClone(current.document)
      foreign.cards.at(-1)!.regeneration!.generationID = `regen-input-${kind}`
      expect(() => saveBoard(id, current.revision, foreign)).toThrow("再次生成来源任务不可用")
      const savedReplay = saveBoard(id, current.revision, current.document)
      const submission: BoardSubmission = { cardID: replay.id, submissionID: crypto.randomUUID(), revision: savedReplay.revision, snapshot }
      expect(validateBoardSubmission(id, submission).input.snapshot).toEqual(snapshot)
      expect(savedReplay.document.draftEdges.filter((edge) => edge.targetID === replay.id)).toHaveLength(0)
      const changed = structuredClone(savedReplay.document)
      changed.cards.at(-1)!.regeneration!.snapshot.prompt = "改写已保存来源"
      expect(() => saveBoard(id, savedReplay.revision, changed)).toThrow("任务历史")
      if (!snapshot.operation) {
        const tampered = structuredClone(savedReplay.document)
        tampered.cards.at(-1)!.draft.references![0].image = "https://example.test/forged.png"
        expect(() => saveBoard(id, savedReplay.revision, tampered)).toThrow("固定参考图不属于原任务")
        const unverified = structuredClone(savedReplay.document)
        const fake = newBoardCard("unverified", origin.kind)
        fake.draft.references = snapshot.references
        unverified.cards.push(fake)
        expect(() => saveBoard(id, savedReplay.revision, unverified)).toThrow("固定参考图不属于原任务")
      }
      // Frozen inputs and validation survive removing the original graph cards.
      const detached = { ...savedReplay.document, cards: [savedReplay.document.cards.at(-1)!], draftEdges: [] }
      const detachedSaved = saveBoard(id, savedReplay.revision, detached)
      expect(validateBoardSubmission(id, { ...submission, revision: detachedSaved.revision }).input.snapshot).toEqual(snapshot)
      if (kind !== "video") return
      detachedSaved.document.cards[0].draft.references = snapshot.references.map((ref) => ({ ...ref,
        role: ref.role === "firstFrame" ? "lastFrame" : "firstFrame",
      }))
      const swapped = saveBoard(id, detachedSaved.revision, detachedSaved.document)
      const swappedRefs = boardDraftReferences(swapped.document, replay.id, () => undefined)
      expect(swappedRefs.map((ref) => ref.role)).toEqual(["lastFrame", "firstFrame"])
      expect(validateBoardSubmission(id, { ...submission, revision: swapped.revision, snapshot: { ...snapshot, references: swappedRefs } }).input.snapshot.references).toEqual(swappedRefs)
      swapped.document.cards[0].draft.settings.videoInputMode = "multi-reference"
      const multi = saveBoard(id, swapped.revision, swapped.document)
      const multiRefs = boardDraftReferences(multi.document, replay.id, () => undefined)
      expect(multiRefs.map((ref) => ref.role)).toEqual(["reference", "reference"])
      expect(validateBoardSubmission(id, { ...submission, revision: multi.revision, snapshot: { ...snapshot,
        settings: multi.document.cards[0].draft.settings, references: multiRefs } }).input.snapshot.references).toEqual(multiRefs)
    } })
  },
)
