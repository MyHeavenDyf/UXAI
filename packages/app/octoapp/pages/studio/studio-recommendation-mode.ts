import { createEffect, createMemo } from "solid-js"
import type { StudioCapability } from "./types"

// Only recommendation sessions override the ordinary global capability preference.
export function createRecommendationMode(input: {
  key: () => string
  enabled?: () => boolean
  active: () => boolean
  ready: () => boolean
  entries: () => Record<string, StudioCapability>
  save: (key: string, value: StudioCapability) => void
  global: () => StudioCapability
  setGlobal: (value: StudioCapability) => void
}) {
  const visit = createMemo(() => ({ key: input.key(), enabled: input.enabled?.() }))
  const taskLocked = () => input.active() || (!input.ready() && Boolean(input.entries()[input.key()]))
  const locked = () => Boolean(input.enabled?.()) || taskLocked()
  createEffect(() => {
    if (input.enabled?.() || input.active()) input.save(input.key(), "image.generate")
  })
  return {
    locked,
    taskLocked,
    capture: () => {
      const target = visit()
      return () => visit() === target && !locked()
    },
    capability: () =>
      input.enabled?.() || input.active()
        ? ("image.generate" as const)
        : (input.entries()[input.key()] ?? input.global()),
    select: (value: StudioCapability) => {
      if (locked()) return
      if (input.entries()[input.key()]) input.save(input.key(), value)
      input.setGlobal(value)
    },
    hideTemplate: (owner: string | undefined) =>
      input.enabled?.() || input.active() || Boolean(input.entries()[input.key()] && owner !== input.key()),
  }
}
