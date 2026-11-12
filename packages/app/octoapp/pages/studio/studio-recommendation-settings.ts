import { createEffect } from "solid-js"
import { STUDIO_ASPECT_RATIOS } from "./data"
import type { StudioAspectRatio } from "./types"

export type RecommendationImageSettings = {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  customWidth: number
  customHeight: number
  isCustom: boolean
}

export function createRecommendationSettings(input: {
  key: () => string
  enabled: () => boolean
  entries: () => Record<string, RecommendationImageSettings>
  ready: () => boolean
  imageActive: () => boolean
  lastImage: () => RecommendationImageSettings | undefined
  saveImage: (value: RecommendationImageSettings) => void
  fallback: () => RecommendationImageSettings
  global: () => RecommendationImageSettings
  setGlobal: (value: RecommendationImageSettings) => void
  save: (key: string, value: RecommendationImageSettings) => void
}) {
  const snapshot = () => {
    const value = input.entries()[input.key()] ?? input.lastImage() ?? input.fallback()
    return { ...value, aspectRatio: STUDIO_ASPECT_RATIOS.includes(value.aspectRatio) ? value.aspectRatio : "3:4" as const }
  }
  createEffect(() => {
    if (!input.ready()) return
    if (input.enabled() && !input.entries()[input.key()]) input.save(input.key(), snapshot())
    if (input.imageActive() && !input.lastImage())
      input.saveImage({ ...(input.enabled() ? snapshot() : input.global()) })
  })
  return {
    image: snapshot,
    current: () => input.enabled() ? snapshot() : input.global(),
    set: <K extends keyof RecommendationImageSettings>(field: K, value: RecommendationImageSettings[K]) => {
      const next = { ...(input.enabled() ? snapshot() : input.global()), [field]: value }
      if (input.enabled()) {
        input.save(input.key(), next)
        if (input.ready() && input.imageActive()) input.saveImage({ ...next })
        return
      }
      input.setGlobal(next)
      if (input.ready() && input.imageActive()) input.saveImage({ ...next })
    },
  }
}
