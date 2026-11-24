import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import os from "os"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import type { Parsed } from "./store"

const log = Log.create({ service: "memory.debug" })

const DUMP_DIR = path.join(os.homedir(), ".temp", "auto-memory")

const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

// 一个 session 一个文件夹:<sessionID>_<首次落盘时间戳>;进程重启后按 sessionID 前缀复用已有文件夹。
const sessionDirs = new Map<string, string>()

const sessionDir = (sessionID: string) => {
  const cached = sessionDirs.get(sessionID)
  if (cached) return cached
  mkdirSync(DUMP_DIR, { recursive: true })
  const existing = readdirSync(DUMP_DIR).find((entry) => entry.startsWith(`${sessionID}_`))
  const dir = existing ?? `${sessionID}_${stamp()}`
  sessionDirs.set(sessionID, dir)
  return dir
}

// extract 与 inject 各自按 session 计数,文件名互不干扰
const counters = new Map<string, { extract: number; inject: number }>()

const next = (sessionID: string, kind: "extract" | "inject") => {
  const counter = counters.get(sessionID) ?? { extract: 0, inject: 0 }
  counter[kind]++
  counters.set(sessionID, counter)
  return counter[kind]
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

const separator = "=".repeat(80)

const write = (sessionID: string, kind: "extract" | "inject", content: string) => {
  const dir = path.join(DUMP_DIR, sessionDir(sessionID))
  mkdirSync(dir, { recursive: true })
  const index = next(sessionID, kind)
  writeFileSync(path.join(dir, `memory_${stamp()}_no${index}_${kind}.txt`), content)
}

// 提取埋点:收集完成(或模型返回但解析为空)后,记录提取输入、原始输出与解析结果
export const dumpExtract = Effect.fn("MemoryDebug.dumpExtract")(function* (input: {
  sessionID: string
  projectID: string
  model: string
  prompt: unknown[]
  indexBefore: string
  rawOutput: string
  actions: Parsed[]
}) {
  const content = [
    separator,
    `memory extract dump`,
    separator,
    `session:         ${input.sessionID}`,
    `project:         ${input.projectID}`,
    `time:            ${new Date().toISOString()}`,
    `model:           ${input.model}`,
    `actions parsed:  ${input.actions.length}`,
    `actions tokens:  ${Token.estimateValue(input.actions)}`,
    separator,
    "",
    "===== MEMORY INDEX BEFORE EXTRACTION =====",
    input.indexBefore,
    "",
    "===== PROMPT SENT TO EXTRACTOR =====",
    JSON.stringify(input.prompt, binaryReplacer, 2),
    "",
    "===== RAW MODEL OUTPUT =====",
    input.rawOutput,
    "",
    "===== PARSED ACTIONS =====",
    JSON.stringify(input.actions, binaryReplacer, 2),
    "",
  ].join("\n")
  const exit = yield* Effect.sync(() => write(input.sessionID, "extract", content)).pipe(Effect.exit)
  if (Exit.isFailure(exit)) log.warn("memory extract dump failed", { cause: Cause.squash(exit.cause) })
})

// 注入埋点:记忆带进 prompt 时,记录全部上下文(system + tools + messages)
export const dumpInject = Effect.fn("MemoryDebug.dumpInject")(function* (input: {
  sessionID: string
  model: string
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}) {
  const content = [
    separator,
    `memory inject dump`,
    separator,
    `session:         ${input.sessionID}`,
    `time:            ${new Date().toISOString()}`,
    `model:           ${input.model}`,
    `tool count:      ${Object.keys(input.activeTools).length}`,
    `message count:   ${input.modelMsgs.length}`,
    `tokens system:   ${Token.estimateValue(input.system)}`,
    `tokens messages: ${Token.estimateValue(input.modelMsgs)}`,
    `tokens tools:    ${Token.estimateValue(input.activeTools)}`,
    `tokens total:    ${Token.estimateValue([input.system, input.modelMsgs, input.activeTools])}`,
    separator,
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
  const exit = yield* Effect.sync(() => write(input.sessionID, "inject", content)).pipe(Effect.exit)
  if (Exit.isFailure(exit)) log.warn("memory inject dump failed", { cause: Cause.squash(exit.cause) })
})

export * as MemoryDebug from "./debug"
