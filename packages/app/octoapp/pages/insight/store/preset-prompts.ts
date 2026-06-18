// 预置提示词配置 - 见 SPEC-INS-007 §3.1
//
// 与上游模板的差异:
// - 不走 session.prompt() 的 system 字段(消除 session 级元提示词污染)
// - 点击按钮 = 把 text 填入输入框,作为本 turn 的用户消息发送
// - 与 MCP 任务触发类 tool 1:1 对应(spec §2.2)

export type PresetPrompt = {
  id: string                  // 与 expectedTool 同名,便于追踪
  label: string               // 按钮上的短文案
  text: string                // 点击后填入输入框的文本
  expectedTool: string        // 预期调用的 MCP tool 名(本期仅用于追踪/调试日志)
  categories: string[]        // 外网将按 category 过滤;本期 octo 不读但 schema 要预留
  description?: string        // 可选 tooltip
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "key_findings",
    label: "观点解析",
    expectedTool: "key_findings",
    categories: ["interview"],
    // 文案不再明示工具名,改设计师友好中文;工具映射由 agent 提示词「工具选择指南」负责(SPEC-INS-007 §3.1.2 2026-06-15 修订)
    text: "基于上传的逐字稿，解析用户观点。",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "基于上传的访谈大纲和逐字稿，聚类用户观点。",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "基于上传的逐字稿，生成思维导图。",
  },
  {
    id: "run_usability_analysis",
    label: "可用性问题分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "基于上传的任务书和逐字稿，分析整理可用性问题。",
  },
]
