import z from "zod"
import { isStudioCustomSizeValid } from "./studio-image-size"
import { defaultStudioStyleModel, studioModelUnavailableMessage } from "./studio/model-availability"

const point = z.object({ x: z.number().finite(), y: z.number().finite() })
export const BoardSettings = z.object({
  styleModel: z
    .string()
    .min(1)
    .default(() => defaultStudioStyleModel()),
  aspectRatio: z.enum(["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9", "21:9"]).default("1:1"),
  count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  isCustom: z.boolean().default(false),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  videoMode: z.enum(["text", "first_last_frame"]).default("text"),
  videoInputMode: z.enum(["first-last-frame", "multi-reference"]).optional(),
  duration: z
    .string()
    .regex(/^(?:[4-9]|1[0-5])$/)
    .default("5"),
  quality: z.enum(["480", "720", "1080", "4k"]).default("720"),
})
export const BoardReference = z.object({
  sourceID: z.string(),
  generationID: z.string(),
  mediaID: z.string(),
  title: z.string(),
  image: z.string().min(1),
  role: z.enum(["reference", "firstFrame", "lastFrame"]).default("reference"),
})
export const BoardSnapshot = z.object({
  prompt: z.string(),
  settings: BoardSettings,
  references: z.array(BoardReference),
})
export const BoardTaskLink = z.object({
  generationID: z.string(),
  submissionID: z.string(),
  visible: z.boolean(),
  snapshot: BoardSnapshot,
})
export const BoardSubmission = z.object({
  cardID: z.string().min(1),
  submissionID: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  snapshot: BoardSnapshot,
  replacedGenerationID: z.string().optional(),
})
export type BoardSubmission = z.infer<typeof BoardSubmission>
export const BoardMediaRef = z.object({ generationID: z.string(), mediaID: z.string() })
export const BoardAsset = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().min(1),
  role: z.enum(["reference", "firstFrame", "lastFrame"]),
})
export const BoardCard = z.object({
  id: z.string().min(1),
  kind: z.enum(["image", "video"]),
  title: z.string().max(200),
  position: point,
  draft: z.object({
    prompt: z.string().max(20000),
    settings: BoardSettings,
    assets: z.array(BoardAsset).max(10).default([]),
  }),
  taskLinks: z.array(BoardTaskLink).max(2000),
  cover: BoardMediaRef.optional(),
  preview: BoardMediaRef.optional(),
  currentGenerationID: z.string().optional(),
})
export const BoardEdge = z.object({
  id: z.string(),
  sourceID: z.string(),
  targetID: z.string(),
  role: z.enum(["reference", "firstFrame", "lastFrame"]).default("reference"),
})
export const BoardDocument = z.object({
  schemaVersion: z.literal(1),
  viewport: z.object({ ...point.shape, zoom: z.number().min(0.35).max(1.8) }),
  cards: z.array(BoardCard).max(500),
  draftEdges: z.array(BoardEdge).max(2000),
  removedCardIDs: z.array(z.string()).max(10000).default([]),
})
export type BoardDocument = z.infer<typeof BoardDocument>
export type BoardCard = z.infer<typeof BoardCard>
export type BoardEdge = z.infer<typeof BoardEdge>
export type BoardReference = z.infer<typeof BoardReference>
export type BoardSnapshot = z.infer<typeof BoardSnapshot>
export type BoardTaskLink = z.infer<typeof BoardTaskLink>
export type BoardSettings = z.infer<typeof BoardSettings>

export function emptyBoard(): BoardDocument {
  return { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, cards: [], draftEdges: [], removedCardIDs: [] }
}

export function recoverBoardDraft(remote: BoardDocument, local: BoardDocument): BoardDocument {
  const cards = remote.cards
    .map((card) => {
      const draft = local.cards.find((item) => item.id === card.id && item.kind === card.kind)
      return draft ? { ...card, draft: draft.draft, position: draft.position, title: draft.title } : card
    })
    .concat(
      local.cards.filter(
        (card) =>
          !remote.cards.some((item) => item.id === card.id) &&
          !remote.removedCardIDs.includes(card.id) &&
          !card.taskLinks.length,
      ),
    )
  const document: BoardDocument = { ...remote, cards, viewport: local.viewport, draftEdges: [] }
  const candidates = [
    ...local.draftEdges,
    ...remote.draftEdges.filter((edge) => !local.cards.some((card) => card.id === edge.targetID)),
  ]
  candidates.forEach((edge) => {
    if (!boardEdgeError(document, edge.sourceID, edge.targetID, edge.role)) document.draftEdges.push(edge)
  })
  return document
}

export function newBoardCard(id: string, kind: BoardCard["kind"], position = { x: 0, y: 0 }): BoardCard {
  return {
    id,
    kind,
    title: kind === "image" ? "图片" : "视频",
    position,
    draft: { prompt: "", settings: BoardSettings.parse({}), assets: [] },
    taskLinks: [],
  }
}

export function uniqueBoardReferences(references: BoardReference[]) {
  return references.filter(
    (ref, index) =>
      references.findIndex(
        (item) =>
          item.sourceID === ref.sourceID &&
          item.generationID === ref.generationID &&
          item.mediaID === ref.mediaID &&
          item.role === ref.role,
      ) === index,
  )
}

export function boardReferenceLimit(styleModel: string) {
  return styleModel.startsWith("seedream-") ? 4 : styleModel === "qwen" ? 3 : 1
}

export const BOARD_VIDEO_REFERENCE_LIMIT = 4

export function boardReferenceActive(kind: BoardCard["kind"], settings: BoardSettings, role: string) {
  if (kind !== "video" || !settings.videoInputMode) return true
  return settings.videoInputMode === "multi-reference" ? role === "reference" : role !== "reference"
}

export function boardGenerationError(kind: BoardCard["kind"], snapshot: BoardSnapshot) {
  const settings = snapshot.settings
  const unavailableModelMessage = kind === "image" && studioModelUnavailableMessage(settings.styleModel)
  if (unavailableModelMessage) return unavailableModelMessage
  if (
    kind === "image" &&
    settings.isCustom &&
    !isStudioCustomSizeValid(settings.styleModel, settings.width, settings.height)
  )
    return "自定义尺寸不完整或不符合模型要求"
  if (
    snapshot.references.length >
    (kind === "video" ? BOARD_VIDEO_REFERENCE_LIMIT : boardReferenceLimit(settings.styleModel))
  )
    return "参考图数量超过模型上限"
  if (snapshot.references.some((ref) => !boardReferenceActive(kind, settings, ref.role)))
    return "参考图与当前视频输入模式不匹配"
  if (
    kind === "video" &&
    ["firstFrame", "lastFrame"].some((role) => snapshot.references.filter((ref) => ref.role === role).length > 1)
  )
    return "每个首尾帧槽位仅支持一张图片"
  if (
    kind === "video" &&
    snapshot.references.some((ref) => ref.role === "lastFrame") &&
    !snapshot.references.some((ref) => ref.role === "firstFrame" || ref.role === "reference")
  )
    return "请先添加首帧图片"
  if (kind === "video" && settings.quality === "4k" && settings.count !== 1) return "4K 视频仅支持一次生成一份"
  if (!snapshot.prompt.trim()) return "请输入提示词"
}

export function boardDraftReferences(
  document: BoardDocument,
  targetID: string,
  coverURL: (source: BoardCard | undefined) => string | undefined,
): BoardReference[] {
  const target = document.cards.find((card) => card.id === targetID)
  if (!target) return []
  return uniqueBoardReferences([
    ...document.draftEdges
      .filter(
        (edge) => edge.targetID === targetID && boardReferenceActive(target.kind, target.draft.settings, edge.role),
      )
      .flatMap((edge) => {
        const source = document.cards.find((card) => card.id === edge.sourceID)
        const image = coverURL(source)
        return source?.cover && image
          ? [
              {
                sourceID: source.id,
                generationID: source.cover.generationID,
                mediaID: source.cover.mediaID,
                title: source.title,
                image,
                role: edge.role,
              },
            ]
          : []
      }),
    ...target.draft.assets
      .filter((asset) => boardReferenceActive(target.kind, target.draft.settings, asset.role))
      .map((asset) => ({
        sourceID: `upload:${asset.id}`,
        generationID: "",
        mediaID: asset.id,
        title: asset.name,
        image: asset.url,
        role: asset.role,
      })),
  ])
}

export function boardFrameSourceCount(document: BoardDocument, cardID: string, role: string) {
  return (
    document.draftEdges.filter((edge) => edge.targetID === cardID && edge.role === role).length +
    (document.cards.find((card) => card.id === cardID)?.draft.assets.filter((asset) => asset.role === role).length ?? 0)
  )
}

export function boardEdgeError(document: BoardDocument, sourceID: string, targetID: string, role = "reference") {
  if (sourceID === targetID) return "不能连接到自身"
  const source = document.cards.find((card) => card.id === sourceID)
  const target = document.cards.find((card) => card.id === targetID)
  if (source?.kind !== "image" || !source.cover) return "请选择有效的上游图片封面"
  if (!target) return "目标卡片不存在"
  if (target.kind === "image" && role !== "reference") return "图片卡片仅支持参考图"
  if (
    document.draftEdges.some((edge) => edge.sourceID === sourceID && edge.targetID === targetID && edge.role === role)
  )
    return "参考连接已存在"
  if (role !== "reference" && boardFrameSourceCount(document, targetID, role)) return "该帧已有引用，请先移除"
  const visited = new Set<string>()
  const reaches = (id: string): boolean => {
    if (id === sourceID) return true
    if (visited.has(id)) return false
    visited.add(id)
    return document.draftEdges.filter((edge) => edge.sourceID === id).some((edge) => reaches(edge.targetID))
  }
  if (reaches(targetID)) return "不能创建循环连接"
}
