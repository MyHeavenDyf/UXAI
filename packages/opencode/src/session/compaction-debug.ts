import { mkdirSync } from "node:fs"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.compaction-debug" })

const triggers = new Map<SessionID, { index: number; stamp: string }>()

const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const binaryReplacer = (_key: string, value: unknown) =>
  value instanceof Uint8Array
    ? `<Uint8Array ${value.byteLength} bytes>`
    : value instanceof ArrayBuffer
      ? `<ArrayBuffer ${value.byteLength} bytes>`
      : value

type DumpInput = {
  sessionID: SessionID
  phase: "before" | "after"
  outcome?: "success" | "failed"
  note?: string
  model: string
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}

const write = Effect.fn("SessionCompactionDebug.write")(function* (input: DumpInput) {
  const ctx = yield* InstanceState.context
  const trigger =
    input.phase === "before"
      ? { index: (triggers.get(input.sessionID)?.index ?? 0) + 1, stamp: stamp() }
      : (triggers.get(input.sessionID) ?? { index: 1, stamp: stamp() })
  triggers.set(input.sessionID, trigger)

  const content = [
    "================================================================================",
    `compact ${input.phase} dump`,
    "================================================================================",
    `phase:           ${
      input.phase === "before"
        ? "before compaction (context prepared for the AI, includes the /compact marker message)"
        : "after compaction (context prepared for the AI)"
    }`,
    ...(input.outcome ? [`outcome:         ${input.outcome}`] : []),
    ...(input.note ? [`note:            ${input.note}`] : []),
    `session:         ${input.sessionID}`,
    `trigger:         #${trigger.index} (per session)`,
    `time:            ${new Date().toISOString()}`,
    `model:           ${input.model}`,
    `tool count:      ${Object.keys(input.activeTools).length}`,
    `message count:   ${input.modelMsgs.length}`,
    `tokens system:   ${Token.estimateValue(input.system)}`,
    `tokens messages: ${Token.estimateValue(input.modelMsgs)}`,
    `tokens tools:    ${Token.estimateValue(input.activeTools)}`,
    `tokens total:    ${Token.estimateValue([input.system, input.modelMsgs, input.activeTools])}`,
    "================================================================================",
    "",
    "===== SYSTEM PROMPT =====",
    input.system.join("\n\n"),
    "",
    "===== MESSAGES PREPARED FOR THE AI =====",
    JSON.stringify(input.modelMsgs, binaryReplacer, 2),
    "",
  ].join("\n")

  const dir = path.join(ctx.directory, "analysis")
  mkdirSync(dir, { recursive: true })
  yield* Effect.promise(() =>
    Bun.write(path.join(dir, `compact_${trigger.stamp}_no${trigger.index}_${input.phase}.txt`), content),
  )
})

export const dump = Effect.fn("SessionCompactionDebug.dump")(function* (input: DumpInput) {
  const exit = yield* write(input).pipe(Effect.exit)
  if (Exit.isFailure(exit)) log.warn("compact debug dump failed", { cause: Cause.squash(exit.cause) })
})

export * as CompactionDebug from "./compaction-debug"
