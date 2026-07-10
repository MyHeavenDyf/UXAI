# MCP Preflight 只检查当前会话的 remote server

## 动机

`tools()` 每次调用前会对所有 `remoteConfigs` 做 ping 健康检查。`toolsForAgent()` 调用 `tools()` 时只需要当前 agent 绑定的那部分 server，但仍触发全量检查，导致频繁握手压垮服务器。

## 改动

| 文件 | 改动内容 |
|------|----------|
| `packages/opencode/src/mcp/reconnect.ts` | 新增 `verifyAndReconnectForAgent()` 函数，只对 `agentMcp` + `customServerNames` 范围内的 server 做 preflight |
| `packages/opencode/src/mcp/index.ts` | `tools()` 新增 `skipPreflight?: boolean` 参数；`toolsForAgent()` 先调 `verifyAndReconnectForAgent` 做 scope preflight，再以 `skipPreflight=true` 调 `tools()` 避免重复检查 |

## 设计决策

### 1. 集中在 reconnect.ts

scope 计算逻辑完全封装在 `verifyAndReconnectForAgent` 中，index.ts 只需传递 `agentMcp`/`customServerNames`，不关心具体过滤逻辑。

### 2. `skipPreflight` 避免重复

`toolsForAgent` 先做 scope preflight，然后调 `tools()` 时跳过内部的 preflight。`tools()` 无参调用时保留全量 preflight 作为兜底（其他调用方仍受益）。

## 验证

- `bun run typecheck` 通过
- `toolsForAgent` 日志中 preflight 只检查当前 agent 相关的 server