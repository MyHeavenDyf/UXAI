// 临时调试模块：捕获所有 AbortController.abort() 调用
// 目的：定位 LLM 请求报 UND_ERR_ABORTED / AbortError 的真凶
//
// 日志位置（三路并行写入，保证至少一路可见）：
//   1. 独立文件：    <Global.Path.log>/abort-debug.log
//      - Linux/macOS: ~/.local/share/opencode/log/abort-debug.log
//      - Windows:     %LOCALAPPDATA%\opencode\log\abort-debug.log
//   2. opencode 主日志：通过 Log.Default.error 写入（dev.log 或时间戳.log）
//   3. stderr：直接输出（运行时可见）
//
// 环境变量：
//   - OPENCODE_ABORT_DEBUG=0          临时禁用
//   - OPENCODE_ABORT_DEBUG_LOG=/path  自定义独立日志路径
//
// 移除方法：删除 packages/opencode/src/index.ts 顶部的 `import "@/util/debug-abort"`，并删除本文件

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

const ABORT_DEBUG_DISABLED = process.env.OPENCODE_ABORT_DEBUG === "0"
const ABORT_DEBUG_LOG =
  process.env.OPENCODE_ABORT_DEBUG_LOG ?? `${Global.Path.log}/abort-debug.log`

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

// 多通道写入，写入失败时把错误暴露到所有可用通道（不静默吞）
function writeAll(content: string, label: string) {
  // 1. stderr（最稳，必成功）
  try {
    process.stderr.write(content + "\n")
  } catch (e) {
    // stderr 都失败的话基本无解，但还是尝试继续
    try {
      console.error(`[abort-debug] stderr write failed for ${label}: ${(e as Error)?.message ?? e}`)
    } catch {}
  }

  // 2. 独立日志文件
  try {
    appendFileSync(ABORT_DEBUG_LOG, content + "\n")
  } catch (e) {
    const errMsg = `[abort-debug] FAILED to write ${label} to ${ABORT_DEBUG_LOG}: ${(e as Error)?.message ?? e}\n`
    try {
      process.stderr.write(errMsg)
    } catch {}
    // 备用：尝试写 tmp 目录
    try {
      const fallback = `${tmpdir()}/opencode-abort-debug-failed.log`
      appendFileSync(fallback, `[${new Date().toISOString()}] ${errMsg}\n`)
    } catch {}
  }

  // 3. opencode 主日志系统
  try {
    Log.Default.error(`abort-debug:${label}`, {
      abort_seq: abortCallCount,
      log_file: ABORT_DEBUG_LOG,
    })
  } catch (e) {
    try {
      process.stderr.write(
        `[abort-debug] Log.Default.error failed for ${label}: ${(e as Error)?.message ?? e}\n`,
      )
    } catch {}
  }
}

if (!ABORT_DEBUG_DISABLED) {
  // 确保日志目录存在
  try {
    mkdirSync(dirname(ABORT_DEBUG_LOG), { recursive: true })
  } catch (e) {
    process.stderr.write(
      `[abort-debug] mkdir failed for ${dirname(ABORT_DEBUG_LOG)}: ${(e as Error)?.message ?? e}\n`,
    )
  }

  // 启动时同步写一个空文件，用来验证 monkey-patch 是否真的执行了
  // （如果这个文件不存在，说明 patch 根本没生效，需要重新构建）
  try {
    writeFileSync(ABORT_DEBUG_LOG, "")
  } catch (e) {
    process.stderr.write(
      `[abort-debug] initial writeFileSync failed: ${(e as Error)?.message ?? e}\n`,
    )
  }

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

    writeAll(entry, `abort#${abortCallCount}`)
  }

  const bootMsg =
    `\n[${startedAt}] === abort-debug monkey-patch installed ===\n` +
    `Log file: ${ABORT_DEBUG_LOG}\n` +
    `To disable: OPENCODE_ABORT_DEBUG=0\n` +
    `To change log path: OPENCODE_ABORT_DEBUG_LOG=/path/to/file\n\n`
  writeAll(bootMsg, "boot")
}
