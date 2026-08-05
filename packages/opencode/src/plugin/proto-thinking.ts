import type { Plugin } from "@opencode-ai/plugin"

/**
 * ProtoThinkingPlugin —— 按 agent 控制 DeepSeek-v4 系列的思考模式,不改 llm.ts / transform.ts。
 *
 * 背景:DeepSeek-v4 的思考模式默认打开且 effort=high,开销大。proto pipeline 的
 * `proto_module_create` 受益于深度思考,其余 agent (triage / intent / planner /
 * wireframes / pattern_page / pattern_block / modify / replanner / module_modify /
 * intent_audit / intent_confirm) 不需要思考。本插件把 per-agent 差异化配置收敛到
 * 单一 map,避免给每个 agent 的 model.options 硬编码 thinking 开关。
 *
 * 机制:
 *   1. llm.ts:170 在组装完 chat 请求参数 (含已合并的 variant / model.options /
 *      agent.options) 后触发 `chat.params` hook,output.options 是 mutable record。
 *   2. 本插件拿 input.agent (agent name) 与 input.model.api.id (模型 ID) 做匹配,
 *      按 AGENT_THINKING map 选 "high" 或 "disabled" 模式,直接 mutate
 *      output.options.thinking / output.options.reasoningEffort。
 *   3. llm.ts:374 把 params.options 经 ProviderTransform.providerOptions() 包装成
 *      `{ deepseek: { thinking: {...}, reasoningEffort: "high" } }` 传给 ai-sdk
 *      的 @ai-sdk/openai-compatible provider。该 provider 把 schema 内字段
 *      (reasoningEffort) 提取为 reasoning_effort,把 schema 外字段 (thinking)
 *      原样透传到请求体。
 *
 * DeepSeek 文档:https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 *   - 思考开关 (OpenAI 格式): thinking: { type: "enabled" | "disabled" }
 *   - 思考强度: reasoning_effort: "low" | "high" | "max" (medium 也接受)
 *
 * 不依赖 variant 机制:transform.ts 的 variants() 在 `capabilities.reasoning=false`
 * 时会 early-return {},variant 字段会被 llm.ts:131 静默忽略。本插件绕开整条 variant
 * 链路,直接在 chat.params 写 options,即使 opencode.json 没设 reasoning: true 也生效。
 *
 * 模型无关兜底:map 里的 agent 不在当前 session 出现时 no-op;选中的模型不属于
 * deepseek-v4 系列时 no-op;ai-npm 不是 @ai-sdk/openai-compatible 时 no-op。
 *
 * 失败策略:hook 内只做字段赋值,不抛错 (cloudflare.ts:64 同款写法)。
 */
const LOG = "[proto-thinking]"

// 单一真相源:agent name -> 思考模式
//   "high"     → 走 reasoning_effort: "high" (思考开,高强度)
//   "disabled" → 走 thinking: { type: "disabled" } (思考关)
// 未列出的 agent 走 DEFAULT_THINKING。改 agent 配置就改这个 map。
const AGENT_THINKING: Record<string, "high" | "disabled"> = {
  proto_module_create: "high",
}
const DEFAULT_THINKING: "high" | "disabled" = "disabled"

export const ProtoThinkingPlugin: Plugin = async () => {
  return {
    "chat.params": async (input, output) => {
      // 只对 DeepSeek-v4 系列 (v4-flash / v4-pro 都匹配) 生效
      const id = input.model.api.id.toLowerCase()
      if (!id.includes("deepseek-v4")) return
      if (input.model.api.npm !== "@ai-sdk/openai-compatible") return

      const mode = AGENT_THINKING[input.agent] ?? DEFAULT_THINKING
      if (mode === "high") {
        // 设 reasoning_effort: "high" —— ai-sdk 把 reasoningEffort 映射成请求体的
        // reasoning_effort 字段。DeepSeek 文档 effort 表里 high → flash/pro 实际都映射 high。
        output.options.reasoningEffort = "high"
      } else {
        // 关闭思考 —— DeepSeek 文档的 OpenAI 格式开关。ai-sdk openai-compatible
        // 把 schema 外字段透传到请求体 (见 openai-compatible-chat-language-model
        // 的 Object.fromEntries(...).filter(...) spread)。
        output.options.thinking = { type: "disabled" }
      }
      // 冗余日志开关:需要排查时打开
      // console.log(LOG, { agent: input.agent, model: id, mode, sessionID: input.sessionID })
    },
  }
}
