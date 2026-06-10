# MCP 自动重连机制

## 概述

为远程 MCP 服务器添加自动重连机制，参考 claude-code 的两层检测架构（onerror 计数 → onclose 重连）。

## 设计决策

- **独立文件**：重连核心逻辑放在 `src/mcp/reconnect.ts`，`index.ts` 仅做 ~20 行集成调用
- **不新增 Status 变体**：重连期间复用 `"connecting"` 状态，前端无需改动
- **仅远程重连**：stdio 不自动重连（与 claude-code 一致）

## 提交记录

### 新增 MCP 自动重连机制

- `src/mcp/reconnect.ts`（新建 ~200 行）：
  - 常量：MAX_RECONNECT_ATTEMPTS=5, INITIAL_BACKOFF_MS=1000, MAX_BACKOFF_MS=30000, MAX_ERRORS_BEFORE_RECONNECT=3
  - `isTerminalConnectionError()`：9 种终端错误分类（ECONNRESET/ETIMEDOUT/EPIPE 等）
  - `setupConnectionHandlers()`：两层检测 — Layer 1 (onerror 计数, 3次后强制 close) + Layer 2 (onclose 触发 reconnectWithBackoff)
  - `reconnectWithBackoff()`：5 次指数退避重连（1s→2s→4s→8s→16s），每次 create + fetch tools
  - 通过 `ReconnectContext` 接口注入 Layer 依赖，避免循环 import

- `src/mcp/index.ts`（集成，~20 行新增，无现有代码修改）：
  - import Reconnect 模块
  - `let reconnectCtx!:` 前置声明 + 在 storeClient 之后赋值（打破循环依赖）
  - state init: remote client 存储 config + setupConnectionHandlers
  - closeClient: 首行 markIntentionalDisconnect
  - storeClient: watch 之后 setupConnectionHandlers
  - finalizer: Reconnect.cleanup()

## 与 claude-code 对照

| 功能 | claude-code | 本方案 |
|------|------------|--------|
| onerror terminal error 追踪 | 3 次触发 close | 3 次触发 close |
| isTerminalConnectionError | 9 种 | 9 种 |
| hasTriggeredClose 防重入 | 有 | 有 |
| onclose 触发重连 | 远程 only | 远程 only |
| reconnectWithBackoff | 5 次, 1s→16s | 5 次, 1s→16s |
| 缓存清理 | memo cache | s.clients/defs |
| StatusReconnecting UI | pending + attempt | 复用 "connecting" |
| session 过期检测 | 有 | 省略 |
| SDK "Maximum reconnection attempts" | 有 | 省略 |
