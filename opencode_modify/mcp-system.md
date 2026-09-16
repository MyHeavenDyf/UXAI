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

### 当前未提交：内置 pixso MCP（本地 HTTP 服务，绑定 octo_make）

- `src/config/builtin-mcp.ts`：`BUILTIN_MCP_SERVERS` 新增 `pixso`——`type: "remote"`（HTTP 传输，指协议而非物理位置），url `http://127.0.0.1:3667/mcp`，enabled，timeout 30000。`127.0.0.1` 被 `isPrivateUrl` 识别为私有地址，自动绕过系统代理，无需显式 `proxy: false`
- `src/agent/agent.ts`：octo_make 的 `mcp` 字段最终为 `["pixso"]`（原 `["prototype-dev"]` 中的 prototype-dev 为悬空绑定，已一并移除，见下条）
- 行为说明：pixso 为 remote 类型且绑定 octo_make → 每次 octo_make 对话开始时 `waitForAgentMcpReady` 预检连接；本地服务未启动时触发最多 3 次快速重连（ECONNREFUSED 立即失败，不阻塞 60s 上限），失败后正常继续对话但该轮无 pixso 工具

### 当前未提交：移除 prototype-dev 悬空绑定

- `prototype-dev` 只存在于 `octo_make` 的 `mcp` 数组和 `test/config/builtin-mcp.test.ts` 的过滤逻辑 fixture 字符串中，无任何配置定义（不在 `BUILTIN_MCP_SERVERS`、无 url/command、无文档提及部署）
- 删除绑定无副作用：若用户在 opencode.json 自配了同名 server，其工具经 `toolsForAgent` 的 `customServerNames` 通道仍对包括 octo_make 在内的所有 agent 可见，`agent.mcp` 字段只是内置 MCP 的准入门槛
- test fixture 中的 `prototype-dev_generate_html` 字符串保留——自包含过滤算法测试，不依赖真实 agent 配置
