import { Flag } from "@opencode-ai/core/flag/flag"
import type { ProjectID } from "@/project/schema"
import type { ConfigMemory } from "@/config/memory"
import * as persist from "./persist"

export const DEFAULT_BUDGET_TOKENS = 2000
export const MIN_BUDGET_TOKENS = 300

// 统一开关:env 硬关优先于 config,注入与 Worker 全部经此判断
export function disabled(cfg?: ConfigMemory.Info) {
  return Flag.OCTO_DISABLE_MEMORY || cfg?.enabled === false
}

// 动态预算:索引不得超过模型上下文窗口的 1/8
export function effectiveBudget(base: number, contextLimit?: number) {
  if (!contextLimit || contextLimit <= 0) return base
  return Math.max(MIN_BUDGET_TOKENS, Math.min(base, Math.floor(contextLimit / 8)))
}

// 注入:从 persist 层读取索引构建 <memory> 块(只读,主 Agent 不维护)
export function system(projectID: ProjectID, budget?: number) {
  return persist.buildInjection(projectID, budget ?? DEFAULT_BUDGET_TOKENS) ?? ""
}

// 清空项目记忆
export function clear(projectID: ProjectID) {
  persist.clear(projectID)
}

export * as MemoryStore from "./store"
