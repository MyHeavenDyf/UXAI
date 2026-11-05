import { batch, createMemo } from "solid-js"
import type { StudioAsset } from "./types"

export function createStudioDraftCapture<T>(value: () => T, frames: () => { first?: StudioAsset; last?: StudioAsset }) {
  const snapshot = createMemo(() => ({
    value: value(),
    // Solid Store merges new frame fields into the existing object.
    frames: [frames().first?.id, frames().first?.dataUrl, frames().last?.id, frames().last?.dataUrl],
  }))
  return () => {
    const captured = snapshot()
    return () => captured === snapshot()
  }
}

export async function restoreStudioDraft<T>(input: {
  prepare: () => Promise<T>
  valid: () => boolean
  apply: (prepared: T) => void
  afterApply?: () => void
}) {
  const prepared = await input.prepare()
  if (!input.valid()) return false
  batch(() => input.apply(prepared))
  input.afterApply?.()
  return true
}
