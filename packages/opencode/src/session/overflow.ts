import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

const COMPACTION_THRESHOLD = 0.85

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

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
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
  if (input.unavoidableInput >= usable(input)) return "reject" as const
  return "compact" as const
}
