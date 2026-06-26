// 临时调试模块：捕获所有 AbortController.abort() 调用
// 目的：定位 LLM 请求报 UND_ERR_ABORTED / AbortError 的真凶
// （即：到底是哪段业务代码主动 abort 了 fetch 的 signal）
//
// 用法：
//   1. 默认开启，日志写入 $CWD/.opencode-abort-debug.log（同时输出到 stderr）
//   2. 可通过环境变量 OPENCODE_ABORT_DEBUG_LOG=/path/to/log 覆盖日志路径
//   3. 可通过环境变量 OPENCODE_ABORT_DEBUG=0 临时禁用
//
// 移除方法：删除 packages/opencode/src/index.ts 顶部的 `import "@/util/debug-abort"`，并删除本文件

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const ABORT_DEBUG_DISABLED = process.env.OPENCODE_ABORT_DEBUG === "0"
const ABORT_DEBUG_LOG =
  process.env.OPENCODE_ABORT_DEBUG_LOG ?? `${process.cwd()}/.opencode-abort-debug.log`

let abortCallCount = 0
const startedAt = new Date().toISOString()

function describeReason(reason: unknown): string {
  if (reason == null) return "<none>"
  if (reason instanceof Error) {
    const causeStr =
      reason.cause instanceof Error ? ` (cause: ${reason.cause.name}: ${reason.cause.message})` : ""
    return `${reason.name}: ${reason.message}${causeStr}`
  }
  if (typeof reason === "string") return reason.slice(0, 1000)
  try {
    return JSON.stringify(reason).slice(0, 1000)
  } catch {
    return String(reason).slice(0, 1000)
  }
}

function classifyStack(stackLines: string[]): {
  fromUserCode: boolean
  userCodeFrames: string[]
} {
  const userCodeFrames: string[] = []
  let fromUserCode = false
  // 跳过第一行 "Error"
  for (const line of stackLines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (
      trimmed.includes("node:internal") ||
      trimmed.includes("node:stream") ||
      trimmed.includes("node:http") ||
      trimmed.includes("(node:")
    ) {
      continue
    }
    if (
      trimmed.includes("/packages/opencode/") ||
      trimmed.includes("\\packages\\opencode\\") ||
      trimmed.includes("@opencode-ai") ||
      trimmed.includes("/session/") ||
      trimmed.includes("/provider/") ||
      trimmed.includes("/effect/") ||
      trimmed.includes("/cli/") ||
      trimmed.includes("/plugin/") ||
      trimmed.includes("/tool/") ||
      trimmed.includes("/agent/") ||
      trimmed.includes("/dist/")
    ) {
      fromUserCode = true
      userCodeFrames.push(trimmed)
    }
  }
  return { fromUserCode, userCodeFrames }
}

if (!ABORT_DEBUG_DISABLED) {
  try {
    mkdirSync(dirname(ABORT_DEBUG_LOG), { recursive: true })
  } catch {}

  const origAbort = AbortController.prototype.abort
  // @ts-ignore - patching on purpose
  AbortController.prototype.abort = function patchedAbort(reason?: unknown) {
    abortCallCount++
    const now = new Date()
    const ts = now.toISOString()
    const stack = new Error().stack ?? "<no stack>"
    const stackLines = stack.split("\n")
    const { fromUserCode, userCodeFrames } = classifyStack(stackLines)
    const reasonStr = describeReason(reason)

    const lines: string[] = [
      `=========================================================`,
      `[${ts}] ABORT #${abortCallCount} (patch started at ${startedAt})`,
      `FromUserCode: ${fromUserCode ? "YES  <<< 关注这条" : "no (node-internal only)"}`,
      `Reason: ${reasonStr}`,
      ``,
      `--- Top user-code frames ---`,
      userCodeFrames.length > 0 ? userCodeFrames.slice(0, 5).join("\n") : "<none>",
      ``,
      `--- Full Stack ---`,
      stack,
      ``,
    ]
    const entry = lines.join("\n")

    // stderr 同步输出（运行时可见）
    try {
      process.stderr.write(entry + "\n")
    } catch {}
    // 文件追加（事后分析，stderr 可能被日志系统重定向）
    try {
      appendFileSync(ABORT_DEBUG_LOG, entry + "\n")
    } catch {}
  }

  const bootMsg =
    `\n[${startedAt}] === abort-debug monkey-patch installed ===\n` +
    `Log file: ${ABORT_DEBUG_LOG}\n` +
    `To disable: OPENCODE_ABORT_DEBUG=0\n` +
    `To change log path: OPENCODE_ABORT_DEBUG_LOG=/path/to/file\n\n`
  try {
    process.stderr.write(bootMsg)
  } catch {}
  try {
    appendFileSync(ABORT_DEBUG_LOG, bootMsg + "\n")
  } catch {}
}
