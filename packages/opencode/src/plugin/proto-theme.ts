import type { Plugin } from "@opencode-ai/plugin"
import { STATIC_PROMPTS, resolvePromptForSessionAsync } from "@/agent/proto/theme"

/**
 * ProtoThemePlugin —— 把 proto agent 的静态提示词按会话主题动态覆盖,不改 llm.ts。
 *
 * 背景:122f218cb「提示词根据主题动态组装」曾把 ProtoTheme.resolvePromptForSession
 * 直接写进 llm.ts 的 system 组装段。这把"动态提示词"逻辑耦合进了核心 LLM 路径,
 * 不符合 llm.ts 自身留下的扩展点(`experimental.chat.system.transform` hook,
 * 见 llm.ts:117 / agent.ts:665)。本插件把那段逻辑整体迁回 hook,llm.ts 回到
 * upstream 原始形态(用 input.agent.prompt 直拼)。
 *
 * 机制:
 *   1. llm.ts 组装完 system[0](= 静态替换后的 proto prompt + 可能的 custom/user.system)
 *      后触发 `experimental.chat.system.transform` hook。
 *   2. 本插件拿 output.system[0] 与 STATIC_PROMPTS 做**前缀反查**:proto agent 的
 *      prompt 恒在 system[0] 开头(llm.ts 组装顺序决定),startsWith 命中即识别出
 *      agentName。前缀匹配同时兼容"无附加内容(精确等) / 有 custom 追加(前缀+\\n...)"
 *      两种情况。命中后只替换前缀部分,保留后续 custom/user.system 不动。
 *   3. 用 ctx.sessionID + 闭包捕获的 directory(来自 PluginInput.directory)调
 *      resolvePromptForSessionAsync,内部走 theme.json 读取 → parent 回溯 →
 *      override 加载 → formatPrompt 重替换 → fallback 到静态 prompt(无 theme 时)。
 *   4. themed === staticPrompt(无 theme)时 no-op;有 theme 时就地改写 output.system[0]。
 *
 * 纯 async 路径(非 Effect):Database.use 是同步函数(LocalContext 兜底全局 Client),
 * readFileSync/readdirSync 同步,loadThemeOverrides 的 async 仅是 Promise 包装。
 * 全程无需 InstanceState/AppRuntime,直接在 hook 的 async 上下文里跑。
 *
 * 失败策略:hook 内 try/catch,任何异常只 log 不抛(trigger 里 Effect.promise 抛错
 * 会中断 LLM stream)。降级 = 不改写 system[0],proto agent 仍拿到完整的静态 prompt
 * (无 theme override,但功能正常)。
 */
const LOG = "[proto-theme]"

export const ProtoThemePlugin: Plugin = async ({ directory }) => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      if (!sessionID) return
      const head = output.system[0]
      if (typeof head !== "string" || head.length === 0) return

      // 前缀反查:proto agent 的静态 prompt 恒在 system[0] 开头。
      // 找最长匹配,避免两个静态 prompt 互为前缀时命中较短的那个。
      let matchName: string | undefined
      let matchLen = 0
      for (const [name, prompt] of Object.entries(STATIC_PROMPTS)) {
        if (prompt.length > matchLen && head.startsWith(prompt)) {
          matchName = name
          matchLen = prompt.length
        }
      }
      if (!matchName) return // 非 proto agent,no-op

      try {
        const themed = await resolvePromptForSessionAsync(matchName, sessionID, directory)
        if (!themed || themed === head.slice(0, matchLen)) return // 无 theme / 无变化
        // 只替换前缀(静态 prompt 段),保留后续 custom/user.system 拼接段
        output.system[0] = themed + head.slice(matchLen)
      } catch (err) {
        console.error(`${LOG} resolve failed, keeping static prompt`, {
          agent: matchName,
          sessionID: input.sessionID,
          err,
        })
      }
    },
  }
}
