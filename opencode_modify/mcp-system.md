# MCP 系统

## 概述

MCP 生命周期诊断日志、tools() 首次调用时序竞争修复、内网 MCP 代理绕过策略。

## 提交记录

### `509c38161` 实现 Agent 内置 MCP 绑定

- 新增 `src/config/builtin-mcp.ts`：定义内置 MCP 服务器（如 `uxr-tool`）
- `src/mcp/index.ts`：添加 `toolsForAgent()` 方法，按 agent 的 `mcp` 字段过滤工具
- `src/session/prompt.ts`：调用 `toolsForAgent()` 替代未过滤的 `tools()`

### `80e342df9` 添加 MCP 生命周期关键路径日志

- `src/mcp/index.ts`：添加 `elog`（EffectLogger），关键路径诊断日志：init、connecting、connect result、defs fetched、tools list updated、tools overview、toolsForAgent 过滤前后
- `src/session/prompt.ts`：prompt 组装时添加 `mcp tools assembled` 日志
- 删除空的 `octo_design/design-basics/SKILL.md` 和 `octo_studio/creative-assets/SKILL.md`

### `8209a2d5d` 修复 sidecar 日志级别过滤 + tools() 首次调用时序竞争

- `src/mcp/index.ts`：`tools()` 添加连接等待逻辑——服务器处于 "connecting" 状态时，轮询最多 5 秒（50x100ms）再返回

### `3a5e1a785` 内网 MCP 服务器绕过 HTTP 代理

- `src/node.ts`：导出 `BuiltinMCP`，供 sidecar 设置 `NO_PROXY` 环境变量

### 当前未提交：MCP 代理策略（自动检测 + 显式配置）

- `src/config/mcp.ts`：Remote schema 添加 `proxy` 可选字段
- `src/mcp/index.ts`：新增 `noProxyFetch`、`isPrivateUrl`、`mcpFetch`，transport 使用动态 fetch
- 详见 `mcp-proxy-strategy.md`
