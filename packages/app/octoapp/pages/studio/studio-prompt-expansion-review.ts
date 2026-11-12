import { createEffect, createMemo } from "solid-js"
import type { StudioTurnData } from "./turns"
import type { RecommendationImageSettings } from "./studio-recommendation-settings"
import { referenceImageLimit } from "./data"
import { isStudioCustomSizeValid } from "./studio-shared"

export type ExpansionReview = {
  draft?: string
  status: "pending" | "confirmed" | "ignored" | "dismissed"
}

export type ExpansionReviews = Record<string, Record<string, ExpansionReview>>

export function createExpansionReview(input: {
  key: () => string
  ready: () => boolean
  turns: () => StudioTurnData[]
  resultID?: () => string | undefined
  entries: () => ExpansionReviews
  save: (key: string, id: string, value: ExpansionReview) => void
}) {
  const visit = createMemo(() => ({ key: input.key() }))
  const turns = createMemo(input.turns)
  let revision = 0
  const id = (turn: StudioTurnData) => turn.recommendation?.assistantMessageID
  const completed = (turn: StudioTurnData) =>
    turn.recommendation?.kind === "result" && turn.recommendation.status === "completed" && Boolean(id(turn))
  const saved = (turn: StudioTurnData) => input.entries()[input.key()]?.[id(turn) ?? ""]
  const editable = (turn: StudioTurnData) =>
    input.ready() && completed(turn) && turns().at(-1)?.id === turn.id && saved(turn)?.status === "pending"

  createEffect(() => {
    if (!input.ready()) return
    const key = input.key()
    const last = turns().at(-1)
    turns().filter(completed).forEach((turn) => {
      const messageID = id(turn)
      if (!messageID) return
      const value = input.entries()[key]?.[messageID]
      if (!value) {
        input.save(key, messageID, {
          draft: turn.assistantText,
          status: turn.id === last?.id ? "pending" : "dismissed",
        })
        return
      }
      if (value.draft === undefined) {
        input.save(key, messageID, { ...value, draft: turn.assistantText })
        return
      }
      if (value.status === "pending" && turn.id !== last?.id)
        input.save(key, messageID, { ...value, status: "dismissed" })
    })
  })

  return {
    editable,
    text: (turn: StudioTurnData) => saved(turn)?.draft ?? turn.assistantText,
    update: (turn: StudioTurnData, draft: string) => {
      const messageID = id(turn)
      if (!messageID || !editable(turn)) return
      input.save(input.key(), messageID, { draft, status: "pending" })
    },
    choose: (turn: StudioTurnData, status: "confirmed" | "ignored") => {
      const messageID = id(turn)
      const value = saved(turn)
      if (!messageID || !value || !editable(turn)) return false
      revision++
      input.save(input.key(), messageID, { ...value, status })
      return true
    },
    dismiss: () => {
      revision++
      const key = input.key()
      const resultID = input.resultID?.()
      if (resultID && !input.entries()[key]?.[resultID])
        input.save(key, resultID, { status: "dismissed" })
      // Seed results even before the full snapshot arrives, so an action cannot
      // reopen an expansion when its history finishes loading afterwards.
      turns().filter(completed).forEach((turn) => {
        const messageID = id(turn)
        if (!messageID || input.entries()[key]?.[messageID]) return
        input.save(key, messageID, { draft: turn.assistantText, status: "dismissed" })
      })
      Object.entries(input.entries()[key] ?? {}).forEach(([messageID, value]) => {
        if (value.status === "pending") input.save(key, messageID, { ...value, status: "dismissed" })
      })
    },
    capture: () => {
      const target = visit()
      const version = revision
      return () => target === visit() && version === revision
    },
  }
}

export function expansionGenerationInput(turn: StudioTurnData, text: string, settings?: RecommendationImageSettings) {
  return {
    capability: "image.generate" as const,
    prompt: text,
    detailPrompt: text,
    refinedPrompt: text,
    effectivePrompt: text,
    referenceImages: turn.inputImages?.map((image) => image.url) ?? [],
    mentionImages: {},
    extra: {
      skipPromptRefine: true,
      promptExpansionSource: { assistantMessageID: turn.recommendation?.assistantMessageID },
    },
    useRestoredInputs: true,
    ...(settings ? {
      aspectRatio: settings.aspectRatio,
      count: settings.count,
      width: settings.isCustom && settings.customWidth > 0 && settings.customHeight > 0 ? settings.customWidth : 0,
      height: settings.isCustom && settings.customWidth > 0 && settings.customHeight > 0 ? settings.customHeight : 0,
    } : {}),
  }
}

export async function generateExpansion(input: {
  turn: StudioTurnData
  choice: "confirmed" | "ignored"
  ready: boolean
  review: ReturnType<typeof createExpansionReview>
  styleModel: string
  settings: RecommendationImageSettings
  notify: (message: string) => void
  generate: (request: ReturnType<typeof expansionGenerationInput> & { inputPolicy: "preserve"; styleModel: string }) => Promise<void>
}) {
  if (!input.ready || !input.review.editable(input.turn)) return
  const text = (input.choice === "confirmed" ? input.review.text(input.turn) : input.turn.userText).trim()
  if (!text) return
  const request = expansionGenerationInput(input.turn, text, input.settings)
  if (request.referenceImages.length > referenceImageLimit(input.styleModel)) {
    input.notify("参考图数量超过当前模型上限，请调整模型后重试。")
    return
  }
  if (request.width && request.height && !isStudioCustomSizeValid(input.styleModel, request.width, request.height)) {
    input.notify("当前自定义尺寸不符合所选模型要求，请调整后重试。")
    return
  }
  if (!input.review.choose(input.turn, input.choice)) return
  await input.generate({ ...request, inputPolicy: "preserve", styleModel: input.styleModel })
}
