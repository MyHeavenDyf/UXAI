import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { StudioCapability } from "./types"

// Owned by the Studio page: session switches retain preferences, module exits do not.
export function createRecommendationSwitch() {
  const [enabled, setEnabled] = createStore<Record<string, boolean>>({})
  return {
    ready: () => true,
    enabled: (key: string) => enabled[key] ?? false,
    save: (key: string, value: boolean) => setEnabled(key, value),
  }
}

// Remember the image recommendation preference without overriding the selected capability.
export function createRecommendationMode(input: {
  key: () => string
  enabled?: () => boolean
  busy: () => boolean
  ready: () => boolean
  entries: () => Record<string, StudioCapability>
  save: (key: string, value: StudioCapability) => void
  global: () => StudioCapability
  setGlobal: (value: StudioCapability) => void
}) {
  const visit = createMemo(() => ({ key: input.key() }))
  const capability = () => input.entries()[input.key()] ?? input.global()
  const active = () => capability() === "image.generate" && Boolean(input.enabled?.())
  createEffect(() => {
    if (input.enabled?.() && !input.entries()[input.key()]) input.save(input.key(), input.global())
  })
  return {
    active,
    taskBlocked: () => input.busy() || !input.ready(),
    capture: () => {
      const target = visit()
      return () => visit() === target && !input.busy()
    },
    capability,
    select: (value: StudioCapability) => {
      if (input.busy()) return
      if (input.enabled?.() || input.entries()[input.key()]) input.save(input.key(), value)
      input.setGlobal(value)
    },
    hideTemplate: (owner: string | undefined) =>
      active() || Boolean(input.entries()[input.key()] && owner !== input.key()),
  }
}
