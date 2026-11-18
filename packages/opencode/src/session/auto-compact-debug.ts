import { mkdirSync, writeFileSync } from "node:fs"
import os from "os"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "./schema"
import type { MessageV2 } from "./message-v2"

const log = Log.create({ service: "session.auto-compact-debug" })

const ANALYSIS_DIR = path.join(os.homedir(), ".temp", "octo-compact-analysis", "auto-compact")

const triggers = new Map<SessionID, number>()

const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${String(now.getMilliseconds()).padStart(3, "0")}`
}

const binaryReplacer = (_key: string, value: unknown) =>
  value instanceof Uint8Array
    ? `<Uint8Array ${value.byteLength} bytes>`
    : value instanceof ArrayBuffer
      ? `<ArrayBuffer ${value.byteLength} bytes>`
      : value

const stringifyTools = (tools: Record<string, unknown>) => {
  try {
    return JSON.stringify(tools, binaryReplacer, 2)
  } catch {
    return JSON.stringify(
      Object.entries(tools).map(([name, tool]) => ({
        name,
        description: (tool as { description?: unknown }).description ?? undefined,
      })),
      null,
      2,
    )
  }
}

type DumpInput = {
  sessionID: SessionID
  trigger: string
  note?: string
  model: string
  tokens?: MessageV2.Assistant["tokens"]
  limit?: number
  usable?: number
  compactions?: number
  overflow?: boolean
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}

const write = Effect.fn("AutoCompactDebug.write")(function* (input: DumpInput) {
  const index = (triggers.get(input.sessionID) ?? 0) + 1
  triggers.set(input.sessionID, index)

  const content = [
    "================================================================================",
    "auto compact trigger dump",
    "================================================================================",
    `trigger:            ${input.trigger}`,
    ...(input.note ? [`note:               ${input.note}`] : []),
    ...(input.overflow !== undefined
      ? [`overflow:           ${input.overflow} (true = request never completed, may replay the unanswered user message)`]
      : []),
    `session:            ${input.sessionID}`,
    `auto-compact:       #${index} (per session, growth signals a compaction loop)`,
    `time:               ${new Date().toISOString()}`,
    `model:              ${input.model}`,
    ...(input.tokens
      ? [
          `usage input:        ${input.tokens.input}`,
          `usage cache read:   ${input.tokens.cache.read}`,
          `usage cache write:  ${input.tokens.cache.write}`,
          `usage context:      ${input.tokens.input + input.tokens.cache.read + input.tokens.cache.write} (input + cache read + cache write)`,
        ]
      : []),
    ...(input.limit !== undefined ? [`context limit:      ${input.limit}`] : []),
    ...(input.usable !== undefined ? [`usable limit:       ${input.usable}`] : []),
    ...(input.compactions !== undefined ? [`compactions in context: ${input.compactions} (markers visible in the compacted context)`] : []),
    `tool count:         ${Object.keys(input.activeTools).length}`,
    `message count:      ${input.modelMsgs.length}`,
    `tokens system:      ${Token.estimateValue(input.system)}`,
    `tokens messages:    ${Token.estimateValue(input.modelMsgs)}`,
    `tokens tools:       ${Token.estimateValue(input.activeTools)}`,
    `tokens total:       ${Token.estimateValue([input.system, input.modelMsgs, input.activeTools])}`,
    "================================================================================",
    "",
    "===== SYSTEM PROMPT =====",
    input.system.join("\n\n"),
    "",
    "===== TOOLS =====",
    stringifyTools(input.activeTools),
    "",
    "===== MESSAGES PREPARED FOR THE AI =====",
    JSON.stringify(input.modelMsgs, binaryReplacer, 2),
    "",
  ].join("\n")

  mkdirSync(ANALYSIS_DIR, { recursive: true })
  writeFileSync(path.join(ANALYSIS_DIR, `auto_compact_${stamp()}.txt`), content)
})

export const dump = Effect.fn("AutoCompactDebug.dump")(function* (input: DumpInput) {
  // 暂时禁用埋点落盘,恢复调试时取消下面两行注释
  // const exit = yield* write(input).pipe(Effect.exit)
  // if (Exit.isFailure(exit)) log.warn("auto compact trigger dump failed", { cause: Cause.squash(exit.cause) })
})

export * as AutoCompactDebug from "./auto-compact-debug"
