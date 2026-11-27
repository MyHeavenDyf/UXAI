// 渐进式披露:execute_tool 元工具的 part,input 是外层信封 {tool_name, params}。
// 渲染/统计按内层工具名展示。pending 流式态 state.input 是字符串,必须判型;
// 返回 undefined 表示不是元工具形态,调用方回落到原始值。
// 独立纯模块:message-part.tsx 的组件依赖链(kobalte 等)无法在 bun test 环境导入,
// 消费方经 @opencode-ai/ui/message-part 的 re-export 使用,行为不变。
export function unwrapMetaTool(
  tool: string,
  input: unknown,
): { tool: string; input: Record<string, any> } | undefined {
  if (tool !== "execute_tool") return
  if (typeof input !== "object" || input === null) return
  const envelope = input as Record<string, unknown>
  const name = envelope.tool_name
  if (typeof name !== "string" || !name) return
  const params = envelope.params
  return {
    tool: name,
    input: typeof params === "object" && params !== null ? (params as Record<string, any>) : {},
  }
}
