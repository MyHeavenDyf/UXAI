// 临时调试模块：捕获所有 AbortController.abort() 调用
// 目的：定位 LLM 请求报 UND_ERR_ABORTED / AbortError 的真凶
//
// 输出方式：仅通过 opencode 原生 Log 模块（Log.create + service=abort-debug）
//   - 日志文件：<Global.Path.log>/<dev|时间戳>.log
//   - Linux/macOS: ~/.local/share/opencode/log/dev.log
//   - Windows:     %LOCALAPPDATA%\opencode\log\dev.log
//   - 用 grep "service=abort-debug" 即可过滤
//
// 环境变量：
//   - OPENCODE_ABORT_DEBUG=0  临时禁用
//
// 移除方法：删除 packages/opencode/src/index.ts 顶部的 `import "@/util/debug-abort"`，并删除本文件

import * as Log from "@opencode-ai/core/util/log"

const ABORT_DEBUG_DISABLED = process.env.OPENCODE_ABORT_DEBUG === "0"

// 用独立 service 名创建 logger，便于在主日志里过滤（grep "service=abort-debug"）
const logger = Log.create({ service: "abort-debug" })

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

if (!ABORT_DEBUG_DISABLED) {
  const origAbort = AbortController.prototype.abort
  // @ts-ignore - patching on purpose
  AbortController.prototype.abort = function patchedAbort(reason?: unknown) {
    abortCallCount++
    const stack = new Error().stack ?? "<no stack>"
    const stackLines = stack.split("\n")
    const { fromUserCode, userCodeFrames } = classifyStack(stackLines)
    const reasonStr = describeReason(reason)

    // payload 完全相同，按来源分级输出：
    //   from_user_code=YES → error（业务代码触发的 abort，重点关注）
    //   from_user_code=no  → warn  （Node 内部触发，可忽略）
    // 这样默认 INFO 级别下所有信息都能写入，便于排查
    const payload = {
      seq: abortCallCount,
      from_user_code: fromUserCode ? "YES" : "no",
      reason: reasonStr,
      top_frames: userCodeFrames.slice(0, 5),
      full_stack: stack,
    }

    if (fromUserCode) {
      logger.error(`abort #${abortCallCount} (user-code)`, payload)
    } else {
      logger.warn(`abort #${abortCallCount} (node-internal)`, payload)
    }

    return origAbort.call(this, reason)
  }

  // 启动时打一条标记，用于验证 patch 已生效（info 级别，避免淹没 error 日志）
  logger.info("monkey-patch installed", { started_at: startedAt })
}
