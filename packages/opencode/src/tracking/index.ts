import { Effect } from "effect"
import * as Store from "./store"
import * as Scanner from "./scanner"
import { toolIs } from "./facts"

export const safe = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catchCause(() =>
      Effect.logWarning("[octo:artifact] capture failed; persisted facts retained").pipe(Effect.as(undefined)),
    ),
  )

export function aroundTool<A, E, R>(messageID: string, tool: string, effect: Effect.Effect<A, E, R>) {
  if (!["write", "edit", "bash", "powershell", "python"].some((name) => toolIs(tool, name))) return effect
  return Effect.acquireUseRelease(
    safe(Effect.tryPromise(() => Scanner.before(Store.assistantTurn(messageID), tool))),
    () => effect,
    (window) => safe(Effect.tryPromise(() => Scanner.after(window))),
  )
}

export * as ArtifactTracking from "./index"
