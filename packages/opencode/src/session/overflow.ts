import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

const COMPACTION_THRESHOLD = 0.85
const DESIGN_AGENTS = new Set(["octo_make", "octo_make_plan", "ict_pattern"])

export const AUTOMATIC_COMPACTION_ENABLED = true
export const CONTEXT_OVERFLOW_MESSAGE = "系统的单次处理能力已满。请点击“新建对话”重置上下文。"

export function exceedsContext(input: { model: Provider.Model; input: number; agent?: string; parentAgent?: string }) {
  if (input.agent === "octo_insight") return false
  if (input.agent && DESIGN_AGENTS.has(input.agent)) return false
  if (input.agent === "proto_replanner" && input.parentAgent === "octo_make") return false
  const limit = input.model.limit.input ?? input.model.limit.context
  if (limit === 0) return false
  return input.input >= limit
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const limit = input.model.limit.input ?? context
  const reserved = input.cfg.compaction?.reserved
  if (reserved !== undefined) return Math.max(0, limit - reserved)
  return Math.floor(limit * COMPACTION_THRESHOLD)
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count = input.tokens.input + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

export function preflight(input: {
  cfg: Config.Info
  model: Provider.Model
  estimatedInput: number
  unavoidableInput: number
}) {
  const full = isOverflow({
    cfg: input.cfg,
    model: input.model,
    tokens: {
      input: input.estimatedInput,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  })
  if (!full) return "send" as const
  // 不再按"已压缩过一次"提前拒绝:二次压缩的循环风险已由压缩侧兜底 —— no-op 分支的
  // 全账核算(clip-only 救援/提纯止损计数/信号失真放行)+ prompt 侧 compaction_noop
  // 防护保证连续触发必然收敛。提前拒绝会把"未标记超配额工具输出"这类 clip 必救的
  // 场景一刀切死(续跑轮一步回灌巨型 skill 后直接终止会话,只能靠用户手动 /compact)。
  if (input.unavoidableInput >= usable(input)) return "reject" as const
  return "compact" as const
}
