import { mkdirSync, writeFileSync } from "node:fs"
import os from "os"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "./schema"
import type { MessageID } from "./schema"

const log = Log.create({ service: "session.message-debug" })

const DEBUG_DIR = path.join(os.homedir(), ".temp", "octo-compact-analysis")

const dumpedUsers = new Set<MessageID>()

const stamped = () => {
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

const write = Effect.fn("SessionMessageDebug.write")(function* (input: {
  sessionID: SessionID
  userID: MessageID
  agent: string
  model: string
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}) {
  const content = [
    "================================================================================",
    "message dump (request sent to the AI)",
    "================================================================================",
    `session:         ${input.sessionID}`,
    `user message:    ${input.userID}`,
    `agent:           ${input.agent}`,
    `model:           ${input.model}`,
    `time:            ${new Date().toISOString()}`,
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
    "===== TOOLS =====",
    stringifyTools(input.activeTools),
    "",
    "===== MESSAGES PREPARED FOR THE AI =====",
    JSON.stringify(input.modelMsgs, binaryReplacer, 2),
    "",
  ].join("\n")

  mkdirSync(DEBUG_DIR, { recursive: true })
  writeFileSync(path.join(DEBUG_DIR, `message_${stamped()}.txt`), content)
})

export const dumpTurn = Effect.fn("SessionMessageDebug.dumpTurn")(function* (input: {
  sessionID: SessionID
  userID: MessageID
  agent: string
  model: string
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}) {
  if (dumpedUsers.has(input.userID)) return
  dumpedUsers.add(input.userID)
  const exit = yield* write(input).pipe(Effect.exit)
  if (Exit.isFailure(exit)) log.warn("message debug dump failed", { cause: Cause.squash(exit.cause) })
})

export * as MessageDebug from "./message-debug"
