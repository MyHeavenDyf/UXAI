// insight 页面专用的 agent 名,与服务端 agent 定义
// (packages/opencode/src/agent/agent.ts 的 octo_insight 条目;提示词在同目录
// prompt/octo_insight.txt,工具白名单见 SPEC-INS-021)保持一致。
//
// 单一真相源:会话创建、侧栏/列表按 agent 过滤、标题护栏等所有判定都引用此常量,
// 避免重命名(如改成 "octo_insight1")时多处魔法字符串漏改导致行为不一致。
export const INSIGHT_AGENT = "octo_insight"
