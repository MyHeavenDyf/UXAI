// insight 页面专用的 agent 名,与服务端 agent 定义
// (packages/opencode/src/agent/agent.ts 的 octo_insight 条目;提示词在同目录
// prompt/octo_insight.txt,工具白名单见 SPEC-INS-021)保持一致。
//
// 单一真相源:会话创建、侧栏/列表按 agent 过滤、标题护栏等所有判定都引用此常量,
// 避免重命名(如改成 "octo_insight1")时多处魔法字符串漏改导致行为不一致。
export const INSIGHT_AGENT = "octo_insight"

// insight 会话列表**可见**的 agent 集合。新建会话一律用 INSIGHT_AGENT;这里额外含 "octo_ai" 是
// SPEC-INS-030 §6 的路径 B(读时合并):chat 下线后其历史(agent=octo_ai)从 insight 侧列出,
// 不回填数据库、可随时回退。与服务端 session-insight-query.ts 的 LISTED_AGENTS 同源同策略
// (那边是权威过滤;这里只用于端点缺失时的前端回退分支)。
export const INSIGHT_LISTED_AGENTS = [INSIGHT_AGENT, "octo_ai"]
