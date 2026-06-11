# Agent 系统扩展

## 概述

将默认 agent 从 `build` 重命名为 `octo_ai`，引入 4 个专业 agent（octo_insight、octo_make、octo_design、octo_studio），添加 agent 级别的 skills、mcp 字段和内置 MCP 绑定。

## 提交记录

### `c3b80dc0e` 基础修改

- 默认 agent `build` → `octo_ai`，`get("build")` 自动映射到 `octo_ai`
- 新增 4 个专业 agent：`octo_insight`、`octo_make`、`octo_design`、`octo_canva`
- 每个 agent 配套提示文件 `src/agent/prompt/octo_*.txt` 和 `src/agent/skills/<agent>/<skill>/SKILL.md`
- `Agent.Info` schema 添加 `skills` 字段
- **涉及文件**：`src/agent/agent.ts`、`src/agent/prompt/`、`src/agent/skills/`、`src/config/agent.ts` 等 227 个文件

### `8d89a8aae` 还原 opencode 重命名并恢复专业 agent 与内置 skill 功能

- 回退 `OPENCODE_*` → `OCTO_*` 标志重命名（错误的重命名），保留功能添加
- 保留专业 agent、session 分类、skill 发现等功能
- **涉及文件**：139 个文件

### `77df1ae2a` 隐藏 plan agent 并增加 skill 加载错误保护

- `src/agent/agent.ts`：plan agent 添加 `hidden: true`
- `src/session/prompt.ts`：`sys.skills(agent)` 用 `Effect.catch` 包装，skill 发现失败不崩溃

### `908dfff47` 修复近期修改引入的 bug

- 多处 `"build"` 硬编码引用 → `"octo_ai"`
- `src/session/session.ts`：会话创建时自动根据 agent 类型插入分类

### `c4d1c5090` 添加 octo_ai agent 专属提示词

- 新增 `src/agent/prompt/octo_ai.txt`（104 行），octo_ai 默认 agent 的系统提示
- 更新 insight agent description

### `509c38161` 实现 Agent 内置 MCP 绑定

- `Agent.Info` 和 config schema 添加 `mcp` 字段（字符串数组）
- 新增 `src/config/builtin-mcp.ts`：内置 MCP 服务器定义
- MCP 接口添加 `toolsForAgent()` 方法，按 agent 的 `mcp` 字段过滤工具
- `src/session/prompt.ts`：调用 `toolsForAgent()` 替代未过滤的 `tools()`
- agent 绑定：`octo_insight` → `uxr-tool`，`octo_make` → `prototype-dev`，`octo_design` → `pixso-design`

### `1ec7c712b` 支持多 artifact 分解生成 + 子 agent 并行组件生成

- 新增 `make_component` sub-agent（`mode: "subagent"`，禁止 task/todowrite 递归）
- 新增 `src/agent/prompt/make_component.txt`（39 行）

### `edb59de5a` revert: 还原 PR #16 对 opencode/src 的改动

- `src/session/prompt.ts`：移除中断时取消子会话的逻辑
- `src/tool/task.ts`：简化 onAbort 处理程序

### Agent 工具权限精简（待提交）

- **octo_ai**：允许 bash, read, glob, grep, edit, skill；deny task, todowrite, webfetch, websearch, jimeng_image_generate, internel_image_generate, lsp。移除 question/plan_enter 的 allow 覆盖（恢复 defaults 的 deny）
- **octo_make**：允许 bash, read, glob, grep, task, webfetch, skill, question；deny edit, todowrite, websearch, jimeng_image_generate, internel_image_generate, lsp。新增 question: allow 覆盖
- 目的：减少不必要工具描述注入系统提示词，降低上下文长度
- **涉及文件**：`src/agent/agent.ts`
