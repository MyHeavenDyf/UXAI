# MCP 自动重连机制

## 概述

为远程 MCP 服务器添加自动重连机制，参考 claude-code 的两层检测架构（onerror 计数 → onclose 重连）。

## 设计决策

- **独立文件**：重连核心逻辑放在 `src/mcp/reconnect.ts`，`index.ts` 仅做 ~20 行集成调用
- **不新增 Status 变体**：重连期间复用 `"connecting"` 状态，前端无需改动
- **仅远程重连**：stdio 不自动重连（与 claude-code 一致）
- **Graceful degradation**：重连期间保持旧 client/defs 缓存，tool 调用失败时返回 isError 结果而不是抛异常中断 LLM 流

## 提交记录

### 2026-06-15 10:30: 终端错误计数升级为模块级状态

**问题**：用户日志显示连续两次 `SSE stream disconnected` 的 `consecutiveErrors` 都从 0 → 1，而不是累积到 2。

```
09:22:17 +38568ms SSE stream disconnected  consecutiveErrors=0  → counted=1
09:22:17 +1ms    SSE stream disconnected  consecutiveErrors=0  → counted=1（应该是 2）
```

**根因分析**（SDK 源码确认）：

SDK `StreamableHTTPClientTransport` 内部维护两个独立的 SSE stream：
- GET 长连接 SSE（`_startOrAuthSse` → `_handleSseStream`）
- POST response SSE（`send` → `_handleSseStream`）

两者各自有独立的 `processStream()` async 函数，都调用同一个 `client.onerror`。

当网络断开时，两个 stream 的 `await reader.read()` 几乎同时抛错 → 两个 catch 分支 → 两次 `onerror`。但 JS microtask 调度的边界行为可能导致两次 catch 在读取闭包变量时还没累积（第一次 ++ 还没被第二次读取到）。

**修复**：

把 `consecutiveErrors` 和 `hasTriggeredClose` 从 `setupConnectionHandlers` 内的闭包变量升级为模块级状态：

```ts
// reconnect.ts 模块顶部新增
const terminalErrorCounts = new Map<string, number>()
const triggeredCloseFlags = new Set<string>()
```

- `terminalErrorCounts`：每个 server name 一份终端错误计数，所有 handler 共享
- `triggeredCloseFlags`：每个 server name 一份"已触发 close"标志，避免重复 close

改动点：
1. `setupConnectionHandlers`：移除 `let consecutiveErrors = 0` 和 `let hasTriggeredClose = false`，改用 `terminalErrorCounts.get(name)` 和 `triggeredCloseFlags.has(name)`
2. `cleanup()`：清理新增的两个状态
3. `reconnectWithBackoff` succeeded 分支：清理 `terminalErrorCounts.delete(name)` 和 `triggeredCloseFlags.delete(name)`，让下次断开能重新触发
4. `onclose` handler 的 `triggeredByOnerror` 字段：改用 `triggeredCloseFlags.has(name)`

**效果**：无论 SDK 有多少个并行 SSE stream 触发 onerror，状态都按 server name 全局累积，不再受闭包变量竞争影响。

### 2026-06-15: 修复 onclose 永不触发的死链（SDK give-up 信号）

**问题日志（运行 37 分钟后远程服务断开）**：

```
03:00:31  SSE stream disconnected                              isTerminal=true  consecutiveErrors=1
03:00:34  fetch failed                                         isTerminal=false consecutiveErrors=0  ← 清零
03:00:34  Failed to reconnect SSE stream: fetch failed         isTerminal=true  consecutiveErrors=1  ← 回 1
03:00:38  Maximum reconnection attempts (2) exceeded           ← SDK 放弃信号被忽略
（整段日志从未出现 [reconnect] onclose fired — Layer 2 死链）
```

**根因（调研 @modelcontextprotocol/sdk v1.27.1 源码确认）**：

- `StreamableHTTPClientTransport._scheduleReconnection`（`streamableHttp.js:138-157`）在重连失败后**只调用 `this.onerror`，绝不调用 `this.onclose`**。
- 我们的设计依赖 `onclose` 触发 `reconnectWithBackoff`，但 SDK 放弃后 transport 进入"僵死"状态（流已停、abortController 未 abort、onclose 从未触发），Layer 2 永远等不到。
- 同时 `reconnect.ts:143-145` 的"非终端错误清零 consecutiveErrors"逻辑让计数永远 0↔1 振荡（SDK 重连时会先抛 `fetch failed` 非终端，再抛 `Failed to reconnect SSE stream` 终端），Layer 1 兜底永远到不了 3。
- 关键事实：`transport.close()` 会显式调用 `this.onclose`（`streamableHttp.js:280-287`）→ 经 `protocol.js:220-225` 桥接到 `client.onclose`。这是可靠触发 onclose 的路径。

**修复（仅改 `packages/opencode/src/mcp/reconnect.ts`）**：

1. **新增 `isSdkGiveUpSignal(msg)` 辅助函数**（在 `isTerminalConnectionError` 旁）：匹配 `/Maximum reconnection attempts.*exceeded/`
2. **重写 `client.onerror`**（`setupConnectionHandlers` 内）按优先级处理：
   - **优先级 1（give-up 信号，一次即触发）**：`isSdkGiveUpSignal(msg)` 命中 → 若 `!hasTriggeredClose`，置位并 `client.close()` → 显式触发 `transport.onclose` → Layer 2 接管。不计数，直接 return。
   - **优先级 2（终端错误累积，兜底）**：`isTerminalConnectionError(msg)` 命中 → `consecutiveErrors++` → 达到阈值时同上 close 流程。
   - **非终端错误不再清零 consecutiveErrors**（移除 `else { consecutiveErrors = 0 }`）。
3. **常量调整**：`MAX_ERRORS_BEFORE_RECONNECT` 从 `3` 降为 `2`（加快兜底）。
4. **日志增强**：`[reconnect] transport error` 增加 `isGiveUp: boolean` 字段；新增 `[reconnect] SDK gave up reconnecting - forcing close` warn 日志（关键字段 `name, error, consecutiveErrors`）。

**未改动**：
- `reconnectWithBackoff` 主流程（5 次 1s→16s 保持不变）
- `onclose` handler（已含 stale 检查）
- `index.ts` 接入点（remote 条件分支保持不变，local/stdio 类型仍未覆盖）
- 前端 SSE 监听、`convertMcpTool` getter

**预期效果**：
- 远程服务重启后，`Maximum reconnection attempts (2) exceeded` 错误一出现 → 主动 close → 触发 onclose → 启动 5 次指数退避重连
- 远程服务恢复后下一次 attempt 成功 → storeClient 替换新 client → tool 调用恢复
- 前端收到 `mcp.tools.changed` SSE 事件 → 自动 refetch mcp status

**验证路径**：
- 启动后配置 remote SSE MCP（如 uxr-tool）→ 确认 `connection handlers installed` + 工具 fetch 成功
- kill 远程服务 → 期望日志序列：`transport error (isGiveUp=false)` ×N → `transport error (isGiveUp=true)` 或终端计数达 2 → `SDK gave up reconnecting - forcing close` → `onclose fired` → `connection closed unexpectedly` → `starting reconnect loop` → 重启远程服务 → `succeeded`
- tool 调用恢复（如 `/insight` 的 `key_findings`）

### 2024-06-11: 修复重连期间 tools() 阻塞 + tool 执行健壮化

**问题**：
- `reconnectWithBackoff` 写 `s.status = "connecting"` 导致 `tools()` 触发 5s 等待循环
- `onclose` 删除 `s.clients/defs` 导致 `tools()` 返回空对象，`octo_insight` agent 无法工作
- `convertMcpTool` 的 client 闭包在重连后仍指向旧的死 client，tool 调用必然失败并中断 LLM 流

**修复**：
- `src/mcp/reconnect.ts`：
  - `onclose` 不再删除 `s.clients[name]` / `s.defs[name]` / `s.status[name]`
  - `reconnectWithBackoff` 不再写 `s.status = "connecting"`（保持旧 `connected`）
  - 仅在全部重连失败后才删除 defs/clients 并置为 `failed`
  - 补全日志：handler 安装时间、onclose 触发来源（onerror 计数 vs SDK）、aliveMs、每次 attempt 耗时、backoff delay、成功/失败状态

- `src/mcp/index.ts`：
  - `convertMcpTool` 签名改为 `(mcpTool, clientGetter, clientName, timeout)`
  - `execute` 内加 try/catch，失败时返回 `{ content, isError: true }` 而不是抛异常
  - `tools()` 调用时传 `() => s.clients[clientName]` getter，确保重连后命中最新 client

- `packages/app/octoapp/context/global-sync/event-reducer.ts`：
  - `applyDirectoryEvent` 新增 `invalidateMcp?: () => void` 参数
  - 新增 `case "mcp.tools.changed"` 调用 `invalidateMcp()`

- `packages/app/octoapp/context/global-sync.tsx`：
  - 传入 `invalidateMcp: () => queryClient.invalidateQueries({ queryKey: mcpQueryKey(directory) })`

**效果**：
- 重连期间 `tools()` 不阻塞、不返回空，LLM 可继续使用旧 tool 定义
- 重连成功后 tool 调用自动切换到新 client（getter 动态 lookup）
- 重连失败后前端收到 SSE 事件并 refetch mcp status，UI 显示 `failed`
- tool 调用失败时 LLM 收到 `isError: true` 结果，可自行 retry 或告知用户，不中断对话流

### 新增 MCP 自动重连机制

- `src/mcp/reconnect.ts`（新建 ~230 行）：
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
| StatusReconnecting UI | pending + attempt | 复用 "connected" + graceful degradation |
| session 过期检测 | 有 | 省略 |
| SDK "Maximum reconnection attempts" | 有 | 省略 |
| tool execute try/catch | 无 | 有（返回 isError） |
| client getter 动态 lookup | 无 | 有 |

## 异常码处理

**终端错误（触发 onerror 计数 → 强制 close → 重连）**：
- `ECONNRESET` — 连接被远程重置
- `ETIMEDOUT` — 连接超时
- `EPIPE` — 写入已关闭的管道
- `EHOSTUNREACH` — 主机不可达
- `ECONNREFUSED` — 连接被拒绝
- `Body Timeout Error` — HTTP body 超时
- `terminated` — SDK/transport 终止
- `SSE stream disconnected` — SSE 断开
- `Failed to reconnect SSE stream` — SSE 重连失败

**非终端错误（不计数，不触发重连）**：
- HTTP 4xx（鉴权失败等）— 由上层 needs_auth/needs_client_registration 处理
- 其他未知错误 — consecutiveErrors 清零

## 状态流转

```
connected ──onclose(非主动)──> 保持 connected + 启动重连
    │                           │
    │                           ├─ attempt 1-5: 保持 connected, try create()
    │                           │   ├─ 成功 → storeClient → connected (新 client)
    │                           │   └─ 失败 → backoff sleep, continue
    │                           │
    │                           └─ 全部失败 → delete defs/clients → failed
    │
    └──onclose(主动)──> 不触发重连，跳过
```

## 日志点（可观测性）

所有日志带 `[reconnect]` 前缀，便于过滤：

| 日志 | 级别 | 触发时机 | 关键字段 |
|------|------|----------|----------|
| `connection handlers installed` | info | client 创建后 | `name, at` |
| `transport error` | error | onerror | `name, error, isTerminal, consecutiveErrors` |
| `terminal connection error counted` | info | onerror 累计 | `name, consecutiveErrors, maxErrors` |
| `max terminal errors reached - forcing close` | info | onerror ≥3 | `name, threshold` |
| `onclose fired` | info | SDK 触发 onclose | `name, aliveMs` |
| `connection closed intentionally` | info | 主动断开 | `name, aliveMs` |
| `stale onclose handler` | info | 过期 handler | `name, aliveMs` |
| `connection closed unexpectedly` | warn | 非主动断开 | `name, aliveMs, triggeredByOnerror, currentStatus, toolCount` |
| `starting reconnect loop` | info | 重连开始 | `name, maxAttempts` |
| `attempt` | info | 每次 attempt | `name, attempt, maxAttempts, elapsedSinceStartMs` |
| `attempt failed` | warn | attempt 失败 | `name, attempt, durationMs, status, error` |
| `backoff` | info | sleep before next | `name, nextAttempt, delayMs` |
| `cancelled` | info | 用户断开中断 | `name, attempt` |
| `succeeded` | info | 重连成功 | `name, attempt, attemptDurationMs, totalDurationMs, toolCount` |
| `failed - max attempts reached` | error | 全部失败 | `name, totalDurationMs` |
| `loop ended` | info | finally 清理 | `name` |