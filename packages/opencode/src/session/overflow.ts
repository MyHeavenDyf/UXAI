import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

const COMPACTION_THRESHOLD = 0.85
const REQUEST_SAFETY_THRESHOLD = 0.9

// Keep automatic compaction available for a future rollout, but leave it disabled for now.
export const AUTOMATIC_COMPACTION_ENABLED = false
export const REQUEST_TOO_LARGE_MESSAGE = "本次发送的内容过多，已超过模型可安全处理的范围。请减少或拆分文件后重试。"

export function exceedsContext(input: { model: Provider.Model; input: number }) {
  const limit = input.model.limit.input ?? input.model.limit.context
  if (limit === 0) return false
  return input.input >= limit
}

export function exceedsSafeContext(input: { model: Provider.Model; input: number }) {
  const limit = input.model.limit.input ?? input.model.limit.context
  if (limit === 0) return false
  return input.input >= Math.floor(limit * REQUEST_SAFETY_THRESHOLD)
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
  compactionAttempted?: boolean
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
  if (input.compactionAttempted || input.unavoidableInput >= usable(input)) return "reject" as const
  return "compact" as const
}
