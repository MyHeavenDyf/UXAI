import {
  BoardDocument,
  boardEdgeError,
  boardDraftReferences,
  boardReferenceActive,
  type BoardCard,
  type BoardReference,
  type BoardSettings,
} from "@opencode-ai/core/studio-board"
import type { StudioGenerationResult, StudioImage } from "../types"
import { isStyleModelAvailable, styleModelRequiresSeedreamPermission } from "../data"
import { isStudioCustomSizeValid, studioGenerationModelUnavailableMessage } from "../studio-shared"
export { boardEdgeError, emptyBoard, newBoardCard } from "@opencode-ai/core/studio-board"
export type {
  BoardCard,
  BoardDocument,
  BoardEdge,
  BoardReference,
  BoardSettings,
  BoardSnapshot,
} from "@opencode-ai/core/studio-board"
export type BoardResults = Record<string, StudioGenerationResult>

export function boardCardSize(width?: number, height?: number) {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return { width: 304, height: 330 }
  const scale = 300 / Math.max(width, height)
  return { width: width * scale + 4, height: height * scale + 30 }
}

export function boardDocumentSnapshot(document: unknown) {
  return BoardDocument.parse(document)
}

export function boardDocumentJSON(document: BoardDocument) {
  return JSON.stringify(boardDocumentSnapshot(document))
}

export function normalizeBoardSettings(settings: BoardSettings) {
  if (!settings.isCustom || isStudioCustomSizeValid(settings.styleModel, settings.width, settings.height))
    return settings
  return { ...settings, isCustom: false, width: undefined, height: undefined }
}

export function normalizeBoardDraft(document: BoardDocument): BoardDocument {
  return {
    ...document,
    cards: document.cards.map((card) =>
      card.kind === "image"
        ? { ...card, draft: { ...card.draft, settings: normalizeBoardSettings(card.draft.settings) } }
        : card,
    ),
  }
}

export function boardCanGenerate(card: BoardCard, permission: { status: string; seedream: boolean; video: boolean }) {
  if (permission.status !== "ready") return false
  if (card.kind === "video") return permission.video
  if (!isStyleModelAvailable(card.draft.settings.styleModel)) return false
  return !styleModelRequiresSeedreamPermission(card.draft.settings.styleModel) || permission.seedream
}

export function boardBusy(result?: StudioGenerationResult) {
  return !!result && ["creating", "queued", "running", "abnormal"].includes(result.status)
}
export function boardFailed(result?: StudioGenerationResult) {
  return result?.status === "failed" || result?.status === "create_failed"
}
export function boardRebootable(result?: StudioGenerationResult) {
  return result?.status === "failed" && result.provider === "internel" && !!result.taskId && !studioGenerationModelUnavailableMessage(result)
}
export function boardMedia(card: BoardCard, results: BoardResults) {
  return card.taskLinks
    .filter((link) => link.visible)
    .flatMap((link) => {
      const result = results[link.generationID]
      if (result?.status !== "succeeded") return []
      return result.images
        .filter((media) => (media.kind ?? "image") === card.kind)
        .map((media) => ({
          generationID: link.generationID,
          mediaID: media.id,
          media,
        }))
    })
}
export function boardCover(card: BoardCard, results: BoardResults): StudioImage | undefined {
  return boardMedia(card, results).find(
    (item) => item.generationID === card.cover?.generationID && item.mediaID === card.cover.mediaID,
  )?.media
}
export function boardReferences(document: BoardDocument, targetID: string, results: BoardResults): BoardReference[] {
  return boardDraftReferences(document, targetID, (source) => {
    const image = source && boardCover(source, results)
    return image?.remoteUrl ?? image?.url
  })
}
export function boardConnectionError(
  document: BoardDocument,
  results: BoardResults,
  sourceID: string,
  targetID: string,
  role = "reference",
) {
  const error = boardEdgeError(document, sourceID, targetID, role)
  if (error) return error
  const source = document.cards.find((card) => card.id === sourceID)!
  const target = document.cards.find((card) => card.id === targetID)!
  if (!boardReferenceActive(target.kind, target.draft.settings, role)) return "引用类型与当前视频输入模式不匹配"
  if (!boardCover(source, results)) return "上游封面不可用"
  if (boardBusy(results[target.currentGenerationID ?? ""])) return "请等待目标任务结束后修改引用"
}

export function boardWheelZoom(zoom: number, deltaY: number, deltaMode: number, height: number) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1)
  return Math.max(0.35, Math.min(1.8, zoom * Math.exp(-Math.max(-60, Math.min(60, pixels)) * 0.0015)))
}
