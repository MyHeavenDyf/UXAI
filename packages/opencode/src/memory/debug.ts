import { chmod, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import os from "os"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { Token } from "@/util/token"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { SECRET_PATTERNS, type Parsed } from "./store"

const log = Log.create({ service: "memory.debug" })

// 独立 debug 开关,测试阶段默认常开(OCTO_MEMORY_DEBUG=0/false 关闭);
// 目录可用 OCTO_MEMORY_DEBUG_DIR 覆盖(测试指向临时目录)
const dumpDir = () => Flag.OCTO_MEMORY_DEBUG_DIR ?? path.join(os.homedir(), ".temp", "auto-memory")

const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES_PER_SESSION = 50
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000

const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

// node:fs/promises 的 Effect 包装:失败静默(返回 fallback),不打断 dump 主流程
const attempt = <T>(fn: () => Promise<T>, fallback: T) =>
  Effect.tryPromise(fn).pipe(Effect.catch(() => Effect.succeed(fallback)))

// 一个 session 一个文件夹:<sessionID>_<首次落盘时间戳>;进程重启后按 sessionID 前缀复用已有文件夹。
const sessionDirs = new Map<string, string>()

const sessionDir = Effect.fnUntraced(function* (sessionID: string) {
  const cached = sessionDirs.get(sessionID)
  if (cached) return cached
  const root = dumpDir()
  yield* Effect.tryPromise(() => mkdir(root, { recursive: true }))
  const entries = yield* attempt(() => readdir(root), [] as string[])
  const dir = entries.find((entry) => entry.startsWith(`${sessionID}_`)) ?? `${sessionID}_${stamp()}`
  sessionDirs.set(sessionID, dir)
  return dir
})

// extract 与 inject 各自按 session 计数,文件名互不干扰
const counters = new Map<string, { extract: number; inject: number }>()

const next = (sessionID: string, kind: "extract" | "inject") => {
  const counter = counters.get(sessionID) ?? { extract: 0, inject: 0 }
  counter[kind]++
  counters.set(sessionID, counter)
  return counter[kind]
}

// 脱敏:密钥/凭证模式统一替换,宁可误杀不可漏放(超长 base64/hex 串一并处理)
const redact = (value: string) =>
  SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(new RegExp(pattern.source, pattern.flags + "g"), "[REDACTED]"),
    value,
  )

// 二进制数据降级为占位符,避免把音频/图片原始字节写进 dump
const binaryReplacer = (_key: string, value: unknown) =>
  value instanceof Uint8Array
    ? `<Uint8Array ${value.byteLength} bytes>`
    : value instanceof ArrayBuffer
      ? `<ArrayBuffer ${value.byteLength} bytes>`
      : value

// 安全序列化:循环引用等无法序列化的内容降级为字符串表示,dump 构建绝不抛异常
const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, binaryReplacer, 2)
  } catch {
    return JSON.stringify(String(value))
  }
}

const isPosix = process.platform !== "win32"

const write = Effect.fnUntraced(function* (sessionID: string, kind: "extract" | "inject", content: string) {
  const dir = path.join(dumpDir(), yield* sessionDir(sessionID))
  yield* Effect.tryPromise(() => mkdir(dir, { recursive: true }))
  if (isPosix) yield* Effect.tryPromise(() => chmod(dir, 0o700)).pipe(Effect.ignore)
  const index = next(sessionID, kind)
  const file = path.join(dir, `memory_${stamp()}_no${index}_${kind}.txt`)
  let body = redact(content)
  if (body.length > MAX_FILE_BYTES) body = body.slice(0, MAX_FILE_BYTES) + "\n... [truncated]\n"
  yield* Effect.tryPromise(() => writeFile(file, body))
  if (isPosix) yield* Effect.tryPromise(() => chmod(file, 0o600)).pipe(Effect.ignore)
  // 每 session 只保留最近 N 个 dump 文件,按修改时间淘汰旧文件
  const files = yield* attempt(() => readdir(dir), [] as string[])
  const withTime = yield* Effect.forEach(files, (name) =>
    Effect.tryPromise(() => stat(path.join(dir, name))).pipe(
      Effect.map((info) => ({ name, mtime: info.mtimeMs })),
      Effect.catch(() => Effect.succeed(undefined)),
    ),
  )
  const stale = withTime
    .filter((entry): entry is { name: string; mtime: number } => entry !== undefined)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(MAX_FILES_PER_SESSION)
  yield* Effect.forEach(
    stale,
    (entry) => Effect.tryPromise(() => unlink(path.join(dir, entry.name))).pipe(Effect.ignore),
    { discard: true },
  )
})

// 自动清理:超过 7 天未更新的 session 目录整体移除
const cleanup = Effect.fnUntraced(function* () {
  const root = dumpDir()
  const entries = yield* attempt(() => readdir(root), [] as string[])
  const now = Date.now()
  yield* Effect.forEach(
    entries,
    (entry) =>
      Effect.tryPromise(() => stat(path.join(root, entry))).pipe(
        Effect.flatMap((info) =>
          now - info.mtimeMs > MAX_SESSION_AGE_MS
            ? Effect.tryPromise(() => rm(path.join(root, entry), { recursive: true, force: true }))
            : Effect.void,
        ),
        Effect.catch(() => Effect.void),
      ),
    { discard: true },
  )
})

const separator = "=".repeat(80)

// 开关判断在序列化之前(build 是惰性闭包,关闭时零序列化开销);内容构建与写入
// 全部在 exit 隔离区内,任何序列化/IO 异常只 warn,绝不影响 Agent 主流程。
const dump = Effect.fn("MemoryDebug.dump")(function* (
  kind: "extract" | "inject",
  sessionID: string,
  build: () => string,
) {
  if (!Flag.OCTO_MEMORY_DEBUG) return
  const exit = yield* Effect.gen(function* () {
    const content = yield* Effect.try({ try: build, catch: (error) => new Error(String(error)) })
    yield* cleanup()
    yield* write(sessionID, kind, content)
  }).pipe(Effect.exit)
  if (Exit.isFailure(exit)) log.warn("memory debug dump failed", { kind, cause: Cause.squash(exit.cause) })
})

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
  yield* dump("extract", input.sessionID, () =>
    [
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
      stringify(input.prompt),
      "",
      "===== RAW MODEL OUTPUT =====",
      input.rawOutput,
      "",
      "===== PARSED ACTIONS =====",
      stringify(input.actions),
      "",
    ].join("\n"),
  )
})

// 注入埋点:记忆带进 prompt 时,记录全部上下文(system + tools + messages)
export const dumpInject = Effect.fn("MemoryDebug.dumpInject")(function* (input: {
  sessionID: string
  model: string
  system: string[]
  modelMsgs: unknown[]
  activeTools: Record<string, unknown>
}) {
  yield* dump("inject", input.sessionID, () =>
    [
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
      stringify(input.activeTools),
      "",
      "===== MESSAGES PREPARED FOR THE AI =====",
      stringify(input.modelMsgs),
      "",
    ].join("\n"),
  )
})

export * as MemoryDebug from "./debug"
