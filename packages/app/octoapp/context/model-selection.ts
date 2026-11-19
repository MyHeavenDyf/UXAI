import { batch } from "solid-js"
import type { ModelKey } from "./local"

export function createModelSelection(input: {
  select: (item: ModelKey | undefined) => void
  setVisibility: (item: ModelKey, visible: boolean) => void
  pushRecent: (item: ModelKey) => void
}) {
  return (item: ModelKey | undefined, options?: { recent?: boolean; enable?: boolean }) => {
    batch(() => {
      input.select(item)
      if (!item) return
      // Restoring session/tab state must not override the user's visibility preference.
      if (options?.enable) input.setVisibility(item, true)
      if (options?.recent) input.pushRecent(item)
    })
  }
}
