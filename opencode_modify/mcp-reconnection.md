# MCP 自动重连机制

## 概述

为远程 MCP 服务器添加自动重连机制。

**架构（2026-06-16 改造后）**：单层触发 — onerror 在满足条件时直接调用 `triggerReconnect()` 启动 `reconnectWithBackoff`，绕过 SDK 的 `onclose` 死链。onclose 仅作可观测性日志和最后兜底。

**架构（2026-06-29 方案 B）**：preflight 检查范围从 `s.clients` 扩展到 `remoteConfigs.keys()`，覆盖 5 次重连全失败后的 failed 状态。失败分支补清 `triggeredReconnectFlags`。死 server 在下次对话触发 tools() 时自动尝试恢复。

## 设计决策

- **独立文件**：重连核心逻辑放在 `src/mcp/reconnect.ts`，`index.ts` 仅做 ~20 行集成调用
- **不新增 Status 变体**：重连期间保持 `"connected"` 状态，前端无需改动
- **仅远程重连**：stdio 不自动重连（与 claude-code 一致）
- **Graceful degradation**：重连期间保持旧 client/defs 缓存，tool 调用失败时返回 isError 结果而不是抛异常中断 LLM 流
- **单层触发（2026-06-16）**：onerror 直接触发重连，不依赖 `client.close() → onclose` 链路。绕过 SDK 多个 race condition（give-up 后不调 onclose / 多 SSE stream 共享 `_reconnectionTimeout` / `transport.close()` 异步边界）

## 提交记录

### 2026-06-30: 修复 closeClient 误设 intentionalDisconnects 导致重连被永久拦下

**问题**：用户日志 `[reconnect] trigger suppressed - intentional disconnect`，所有重连触发（包括 tool-execute）都被第一道检查拦下。前 9 轮重连修复都没用，因为所有路径都被这一个标志拦在 triggerReconnect 入口。

**根因（致命 bug）**：`closeClient`（`packages/opencode/src/mcp/index.ts:705-711`）在 3 个场景被复用，但**无条件**调 `Reconnect.markIntentionalDisconnect(name)`：

| 调用点 | 场景 | 应设标志？ |
|---|---|---|
| `storeClient` line 721 | 装新 client 前关旧 client（**重连成功必走**） | ❌ |
| `createAndStore` 失败 line 768 | create 失败清理 | ❌ |
| `disconnect` line 793 | 用户主动断开 | ✓ |

每次重连成功后 `storeClient` → `closeClient` → `markIntentionalDisconnect`，标志被设。下次断开时 `triggerReconnect` 第一道检查就拦下，**整个重连系统形同虚设**。

**修复**：

1. **`closeClient` 移除 `markIntentionalDisconnect` 调用**（index.ts:705-713）
   ```ts
   function closeClient(s: State, name: string) {
     const client = s.clients[name]
     delete s.defs[name]
     if (!client) return Effect.void
     // 不在此处调 markIntentionalDisconnect：closeClient 被 storeClient/createAndStore 复用
     return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
   }
   ```

2. **`disconnect` 显式调 `markIntentionalDisconnect`**（index.ts:793-800）
   ```ts
   const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
     const s = yield* InstanceState.get(state)
     Reconnect.markIntentionalDisconnect(name)  // 显式：只有这里才是真"主动断开"
     yield* closeClient(s, name)
     delete s.clients[name]
     s.status[name] = { status: "disabled" }
   })
   ```

3. **`setupConnectionHandlers` 入口加 `intentionalDisconnects.delete(name)`**（reconnect.ts:529）
   - 防御性兜底：connect 成功（storeClient → setupConnectionHandlers）后清掉可能残留的标志
   - 即便 disconnect 后 connect 也能干净启动

**用户日志时间线还原**：
```
T0      启动连接成功 → storeClient → closeClient（旧 client） → markIntentionalDisconnect 设
T0+176s SSE stream disconnected → terminal error counted 1（< 2，未触发重连）
T0+176s+8min  tool "get_task_result" failed "Session not found"
        → triggerReconnect(source=tool-execute)
        → 被 intentionalDisconnects 拦下 [trigger suppressed - intentional disconnect]
        → 永久无法恢复
```

修复后：
- storeClient 替换不再设标志 → 后续断开能正常触发重连
- 单次终端错误累积到 2 → triggerReconnect → 标志没设 → 通过
- 5 次重连第 1 次成功 → storeClient → setupConnectionHandlers 清所有标志

**未改动**：
- MAX_ERRORS_BEFORE_RECONNECT 保持 2（不是阈值问题）
- 6 路触发架构不变
- AbortError ping 验证（2026-06-30）保持
- 方案 B（5 次失败后自愈）保持

**反思**：这个 bug 之所以藏了 9 轮修复，因为：
- 日志 `[reconnect] trigger suppressed - intentional disconnect` 不显眼（INFO 级别）
- 重连触发逻辑本身没问题，问题在更上游（标志设置）
- 测试只覆盖触发逻辑，没覆盖 closeClient 复用语义
- 设计上 closeClient 应该叫 `closeClientForReplace` 或拆分成两个函数

### 2026-06-30: AbortError 兜底（方案 B - onerror 异步 ping 验证）

**问题**：用户日志显示 `[reconnect] transport error error=This operation was aborted isTerminal=false`，MCP 状态显示 connected 但实际不可用。

**根因**：`isTerminalConnectionError` 的 9 个关键字不含 "aborted"。Node Web Streams 内部 stream 清理时会触发 `AbortController.abort()`（栈：`writableStreamAbort` → `readableStream.complete`，全部 `node:internal/webstreams/*`，`from_user_code=no`），SDK 把它转成 `client.onerror("This operation was aborted")`。reconnect.ts 当非终端处理 → 不计数、不重连 → status 残留 connected → 用户感知"MCP 不可用"。

**为何不直接把 aborted 加入终端列表**：SDK 内部正常的 stream 清理（单 SSE 完成）也会触发 abort，列终端会误触发重连。需要区分"SDK 正常清理"和"transport 真死"。

**修复（方案 B：onerror 异步 ping 验证）**：

1. **`isAbortError(msg)`（reconnect.ts:51-56）**：新增辅助函数，匹配 `aborted` / `aborterror`（大小写不敏感）

2. **`verifyClientAfterAbortedError`（reconnect.ts:278-348）**：新增 Effect 函数
   - ping client（3s 超时，复用 `PREFLIGHT_PING_TIMEOUT_MS` + `withClientTimeout`）
   - ping OK → info 日志，认为 SDK 正常清理，不触发重连
   - ping 失败 → warn 日志，调 `triggerReconnect(source="onerror-aborted")`
   - `Effect.catch` 兜底，永不让 onerror 失败

3. **`client.onerror` 加优先级 3 分支（reconnect.ts:503-516）**：
   ```ts
   if (isAbortError(msg)) {
     bridge.promise(verifyClientAfterAbortedError(...)).catch(...)
     return
   }
   ```
   fire-and-forget，不阻塞 onerror

4. **`TriggerSource` 扩展**：新增 `"onerror-aborted"` union 成员

**幂等保障**：
- `triggerReconnect` 内的 `triggeredReconnectFlags` + `intentionalDisconnects` + stale 检查仍生效
- ping 期间 client 被替换 → triggerReconnect 的 stale 检查拦下
- ping 期间别的路径触发重连 → triggeredReconnectFlags 幂等

**预期日志序列（transport 真死场景）**：
```
[reconnect] transport error  error="This operation was aborted" isTerminal=false
[reconnect] aborted error - pinging to verify
[reconnect] aborted error - ping failed, triggering reconnect  pingError="..."
[reconnect] trigger fired - starting reconnect loop  source=onerror-aborted
[reconnect] starting reconnect loop
[reconnect] attempt starting  attempt=1
[reconnect] succeeded  attempt=1
```

**预期日志序列（SDK 正常清理场景）**：
```
[reconnect] transport error  error="This operation was aborted" isTerminal=false
[reconnect] aborted error - pinging to verify
[reconnect] aborted error - ping ok, treating as SDK internal cleanup
```

**未改动**：
- 现有 5 路触发架构不变（onerror-giveup / onerror-counter / onclose-fallback / tools-preflight / tool-execute）
- `isTerminalConnectionError` 列表不变（不加入 aborted）
- preflight / 重连循环 / 状态机不变

**风险**：
- 每次 AbortError 多 ~50ms 正常 / 最多 3s 异常的 ping 开销
- SDK 高频内部清理会反复触发 ping，但 ping OK 不会触发重连（只是日志噪音）
- 若 SDK 的 ping API 自身有问题（如 ping 永远 hang），3s 超时兜底

### 2026-06-29: 修复 5 次重连全失败后永久卡死（方案 B）

**问题**：用户反馈"服务重启后客户端永久不可用"，需手动点 disconnect→connect 才能恢复。

**根因**：`reconnectWithBackoff` 5 次全部失败的分支（reconnect.ts:646-659）只清 `clients/defs` + 设 `status=failed`，**没清 `triggeredReconnectFlags`**。`finally` 块只清 `activeReconnects`。后果是 server 进入"永久死"状态：

| 触发路径 | 是否能自愈 | 原因 |
|---------|-----------|------|
| `onerror` / `onclose` | ❌ | client 已 `delete`，handler 不存在 |
| `tools-preflight` | ❌ | `remoteNames = Object.keys(s.clients).filter(...)` 不含 failed 的 server（client 没了） |
| `tool-execute` | ❌ | `clientGetter()` 返回 undefined → 直接返回 isError |
| `setupConnectionHandlers` | ❌ | 没新 client 创建，不会装新 handler |

唯一恢复途径：用户手动点 UI 的 disconnect→connect。

**修复（方案 B：preflight 覆盖 failed 状态，按需触发）**：

1. **`verifyAndReconnectIfNeeded`（reconnect.ts:116-205）**：
   - `remoteNames` 从 `Object.keys(s.clients).filter(...)` 改为 `Array.from(remoteConfigs.keys())`，覆盖所有有 remote 配置的 server（含 failed/missing client）
   - 新增 failed/missing 分支：`!client || currentStatus === "failed"` 时跳过 ping，直接 `triggerReconnect(s, name, client /* undefined */, ..., "tools-preflight", ...)`
   - 不引入定时器，按需触发（用户发消息 → tools() → preflight），与现有设计哲学一致

2. **`triggerReconnect`（reconnect.ts:339-418）**：
   - 签名 `client: Client` → `client: Client | undefined`（适配 failed 分支）
   - stale 检查逻辑不变（`undefined !== undefined === false`，不误判；`undefined !== someClient === true`，state 已有 client 时跳过）
   - `client.close()` → `client?.close()` 防 undefined 崩溃

3. **`reconnectWithBackoff` 失败分支（reconnect.ts:654）**：
   - 补 `triggeredReconnectFlags.delete(name)`
   - 否则下次 preflight 因标志残留被幂等检查拦下（`triggerReconnect` line 349）

**预期行为**：
- 服务重启 → SSE 断开 → 终端错误累积到 2 → triggerReconnect → 5 次重连全失败 → status=failed + 标志已清
- 远端服务恢复 → 用户重新发消息 → tools() → preflight 发现 status=failed + 无 client → 直接 triggerReconnect → 5 次重连尝试 → 第 1 次成功 → storeClient → status=connected

**未改动**：
- onerror / onclose / 5 路触发架构保持不变
- MAX_RECONNECT_ATTEMPTS=5 / backoff 序列不变
- 前端 SSE 监听不变
- `convertMcpTool` getter 不变

**风险**：
- 每次 tools() 都会遍历所有 remoteConfigs（含 failed 的），但 `triggeredReconnectFlags` 幂等检查保证同一 server 同一轮只触发一次
- failed server 持续触发 5 次重试会消耗 ~30s（5×backoff），但因为是用户主动对话触发，用户本来就在等
- 若远端真的死了（永久），每次对话都会浪费 ~30s 重试。后续可考虑加"连续 N 次失败后退避"机制（暂不做，等待实际反馈）

**新日志**：
- `[reconnect] preflight found dead client - triggering reconnect directly` — preflight 发现 failed/missing client 时（关键字段 `name, currentStatus, hasClient`）

### 2026-06-17: 新增 D2+B 方案 — preflight ping + 工具调用失败兜底

**问题**：2026-06-16 的架构改造（onerror 直接触发重连）覆盖了所有 SDK 触发 onerror/onclose 的场景，但仍有一个未覆盖的边界：

- **静默 TCP 丢包**：网络中间设备丢包，TCP 连接看似存活但实际已死。SDK 不触发任何回调，onerror/onclose 都不来。

**两个互补方案**：

#### 方案 D2：tools() 调用前 preflight ping

**触发时机**：`tools()` 是 agent 启动时第一次拿工具列表的入口。用户每次"发新会话"必然走这条路。

**实现**：
- 在 `tools()` 入口（wait loop 之后）加 `Reconnect.verifyAndReconnectIfNeeded(bridge, reconnectCtx)`
- 并行对所有 remote client 调 `client.ping()`，3s 超时
- ping 失败 → 调用 `triggerReconnect(s, name, client, bridge, ctx, "tools-preflight", "ping failed: ...")`
- preflight 完成后重新 `s = InstanceState.get(state)`（client 可能已替换）

**优势**：
- 正好覆盖静默死连接（最常见场景：服务端刚重启后用户开新会话）
- 用户感知最低（每次会话开始时验证一次，不需要定时心跳）
- 正常情况 ping 几十 ms，用户无感；异常情况最多 3s 后触发重连

#### 方案 B：工具调用失败兜底

**触发时机**：`convertMcpTool.execute` 内 catch 网络错误后。

**实现**：
- `convertMcpTool` 新增 `onFailure?: (err) => void` 参数
- catch 块内调 `onFailure?.(err)`，外层 `try/catch` 防止回调抛错
- `tools()` 内 `handleToolFailure(clientName, toolName)` 通过 `bridge.promise(Reconnect.triggerReconnectFromToolFailure(...))` fire-and-forget 触发重连

**优势**：
- 覆盖 "preflight ping 通过后、工具实际调用期间连接死了" 的边界
- 零额外开销（只在失败时触发）

#### 双重保险逻辑

```
agent 启动 (tools() 调用)
  ↓
  ├─ D2: 并行 ping 所有 remote client
  │   ├─ ping OK → 用现有 client
  │   └─ ping 失败 → triggerReconnect(source="tools-preflight")
  │
  └─ 工具实际调用时 (execute)
      └─ B: catch 网络错误 → triggerReconnect(source="tool-execute")
```

**新增类型**：
```ts
type TriggerSource =
  | "onerror-giveup"      // SDK give-up 信号
  | "onerror-counter"     // 终端错误累积到阈值
  | "onclose-fallback"    // onclose 兜底
  | "tools-preflight"     // D2: preflight ping 失败
  | "tool-execute"        // B: 工具调用失败
```

**新增公开 API**（`reconnect.ts`）：
- `verifyAndReconnectIfNeeded(bridge, ctx, timeoutMs=3000): Effect<void>` — 并行 ping 所有 remote client
- `triggerReconnectFromToolFailure(name, bridge, ctx, error, toolName?): Effect<void>` — 工具失败时触发

**新增辅助函数**：
- `withClientTimeout(promise, timeoutMs): Promise<T>` — 纯 JS 的 Promise 超时包装

**关键改动文件**：
- `packages/opencode/src/mcp/reconnect.ts`：扩展 `TriggerSource` union；新增两个公开 API；新增 `withClientTimeout`
- `packages/opencode/src/mcp/index.ts`：
  - `convertMcpTool` 新增 `onFailure` 参数 + catch 内调用
  - `tools()` 入口加 preflight（带 `EffectBridge.make()` + 重新拿 state）
  - `tools()` 内创建 `handleToolFailure` 闭包注入 `convertMcpTool`

**新日志点**：

| 日志 | 级别 | 触发时机 | 关键字段 |
|------|------|----------|----------|
| `preflight starting` | debug | verifyAndReconnectIfNeeded 开始 | `serverCount, names` |
| `preflight skipped - already in progress / intentional` | debug | 跳过单个 server | `name` |
| `preflight ping ok` | debug | 单个 server ping 成功 | `name` |
| `preflight ping failed - triggering reconnect` | warn | 单个 server ping 失败 | `name, error, timeoutMs` |
| `preflight completed` | debug | 全部完成 | `serverCount` |
| `preflight aborted with error` | warn | 整个 preflight 异常（兜底） | `error` |
| `tool-failure trigger skipped - no client in state` | info | client 已被替换 | `name, toolName, error` |
| `tool-failure trigger aborted` | warn | 整个 tool-failure 异常（兜底） | `name, toolName, error` |

**完整性保障**：
- preflight 永不让 tools() 失败（包 `Effect.catch` 兜底，吞为日志）
- tool-failure 永不让上层调用失败（同样 `Effect.catch` 兜底）
- 多个 remote client 并行 ping（`Effect.forEach` concurrency unbounded）
- 同一 server 的多次失败用 `triggeredReconnectFlags` 幂等

**未改动**：
- 已有的 onerror / onclose / reconnectWithBackoff 逻辑保持不变
- MAX_ERRORS_BEFORE_RECONNECT / MAX_RECONNECT_ATTEMPTS / backoff 序列不变
- 前端 SSE 监听不变
- `convertMcpTool` 的 client getter 不变

**风险**：
- 每次 tools() 多 ~50ms 正常 / 最多 3s 异常。可接受。
- `EffectBridge.make()` 在 tools() 内创建 2 次（preflight + toolFailure）。开销小，不优化。

### 2026-06-16: 架构改造 — 重连触发从 onclose 改为 onerror 直调 + 全链路日志补齐

**问题**：之前的三轮修复（识别 SDK give-up 信号 / 模块级状态 / 入口清理）虽然覆盖了已知的失败路径，但仍有用户报告"远程 MCP 服务重启后客户端无法恢复"。在不复现的前提下进行代码审查，发现核心架构存在以下不确定性：

1. **onclose 触发链路依赖 SDK 内部状态**：
   - SDK 在 give-up 后只调 `onerror`，不调 `onclose`
   - SDK 内部 `_reconnectionTimeout` 被多个 SSE stream 共享，close() 的 clearTimeout 只能清当前 stream 的 timeout，旧 stream 的 timeout 仍可能触发
   - `transport.close()` 是 async function，理论上同步调用 `this.onclose?.()`，但中间存在多个 race condition

2. **onclose handler 的 stale check 可能误判**：
   - 如果在 onerror 触发 close 后、onclose 实际回调前，有其他代码路径调用了 `storeClient`（如重连成功的 race），`s.clients[name] !== client` 会跳过重连

3. **日志粒度不足**：无法在不下断点的情况下精确定位卡在哪个环节

**架构变更（彻底性改造）**：

将"触发重连"从 onclose 链路改为 **onerror 直接调用**，绕过 SDK 的所有不确定性：

```
旧架构：
  onerror (give-up / count >= 2) → client.close() → transport.close() → onclose → reconnectWithBackoff
                                        ↑ 多个 race condition，可能死链

新架构：
  onerror (give-up / count >= 2) → triggerReconnect() → reconnectWithBackoff
                                  ↓ (异步清理)
                                  client.close() — 不依赖其 onclose
```

**关键改动（仅 `packages/opencode/src/mcp/reconnect.ts`）**：

1. **新增统一触发入口 `triggerReconnect()`**：
   - 参数 `source` 标记触发来源（`onerror-giveup` / `onerror-counter` / `onclose-fallback`）
   - 三重检查：`triggeredReconnectFlags`（防重入）+ `intentionalDisconnects`（用户主动断开）+ stale client
   - 异步调用 `client.close()` 做兜底清理，不依赖其 onclose 触发
   - 通过 `bridge.promise(reconnectWithBackoff(...))` 直接启动重连

2. **`client.onerror` 重构**：
   - 优先级 1（give-up 信号）：一次即触发，不计数
   - 优先级 2（终端错误累积到 2）：触发重连
   - 非终端错误：不清零、不计数（仅 debug 日志）

3. **`client.onclose` 降级为可观测性日志**：
   - 不再触发重连
   - 仅记录 SDK 是否真的调用了 onclose，以及当时的 stale/intentional/triggered 状态
   - **唯一兜底场景**：如果 onerror 因任何原因没触发，onclose 仍能作为最后保险（带 `source: "onclose-fallback"` 标记）

4. **handler 安装时间戳改为模块级 `handlerInstalledAt: Map<string, number>`**：
   - 用于 aliveMs 计算
   - 跨 handler 实例共享

5. **`triggeredCloseFlags` 改名为 `triggeredReconnectFlags`**（语义更准确）

**新日志点（全部带 `[reconnect]` 前缀，便于过滤）**：

| 日志 | 级别 | 触发时机 | 关键字段 |
|------|------|----------|----------|
| `connection handlers installed` | info | client 创建后 | `name, at, previousHandlerAgeMs, hadPreviousHandler, hasActiveReconnect` |
| `mark intentional disconnect` | info | closeClient 调用 | `name` |
| `transport error` | error | 每次 onerror | `name, error, isTerminal, isGiveUp, consecutiveErrors, clientAgeMs, currentStatus` |
| `SDK gave up reconnecting` | warn | give-up 信号命中 | `name, error, consecutiveErrors` |
| `terminal connection error counted` | info | 终端错误计数 +1 | `name, consecutiveErrors, maxErrors, error` |
| `non-terminal error ignored` | debug | 非终端错误 | `name, error, consecutiveErrors` |
| `trigger fired - starting reconnect loop` | warn | triggerReconnect 通过检查 | `name, source, reason, consecutiveErrors, currentStatus, clientAgeMs, toolCount` |
| `trigger suppressed - already triggered` | info | 幂等检查命中 | `name, source, reason` |
| `trigger suppressed - intentional disconnect` | info | 主动断开 | `name, source, reason` |
| `trigger suppressed - stale handler` | info | state client 已替换 | `name, source, reason, hasCurrentClient, clientAgeMs` |
| `old client close error` | debug | close 抛错（兜底） | `name, error` |
| `onclose fired (observability only)` | info | SDK 调 onclose | `name, aliveMs, isIntentional, isStale, hasActiveReconnect, alreadyTriggered, currentStatus` |
| `onclose fallback triggered` | warn | onclose 兜底（onerror missed） | `name, aliveMs` |
| `starting reconnect loop` | info | reconnectWithBackoff 开始 | `name, maxAttempts, clientAgeMs, url` |
| `reconnect loop skipped - already active` | info | 防重入 | `name` |
| `no remote config - cannot reconnect` | warn | 配置丢失 | `name` |
| `attempt starting` | info | 每次 attempt 开始 | `name, attempt, maxAttempts, elapsedSinceStartMs` |
| `attempt failed` | warn | attempt 失败 | `name, attempt, durationMs, status, error` |
| `backoff` | info | sleep before next | `name, nextAttempt, delayMs` |
| `succeeded` | info | 重连成功 | `name, attempt, attemptDurationMs, totalDurationMs, toolCount` |
| `cancelled - user disconnected` | info | 用户断开中断 | `name, attempt, elapsedMs` |
| `cancelled during backoff` | info | backoff 期间用户断开 | `name, attempt, elapsedMs` |
| `failed - max attempts reached` | error | 全部失败 | `name, totalDurationMs, lastError` |
| `loop ended` | info | finally 清理 | `name, totalDurationMs, outcome` |
| `module state cleaned up` | info | 应用关闭 | `intentional, active, configs, counters, flags, handlers` |

**预期日志序列（服务端重启场景）**：

```
[reconnect] connection handlers installed  name=uxr-tool previousHandlerAgeMs=...
...
# 服务端重启 → SSE 断开
[reconnect] transport error  name=uxr-tool error="SSE stream disconnected: ..." isTerminal=true consecutiveErrors=0
[reconnect] terminal connection error counted  name=uxr-tool consecutiveErrors=1
# SDK 内部重连失败
[reconnect] transport error  name=uxr-tool error="Failed to reconnect SSE stream: ..." isTerminal=true consecutiveErrors=1
[reconnect] terminal connection error counted  name=uxr-tool consecutiveErrors=2
# 计数到阈值 → 直接触发重连
[reconnect] trigger fired - starting reconnect loop  name=uxr-tool source=onerror-counter reason="terminal errors reached threshold (2/2)"
[reconnect] starting reconnect loop  name=uxr-tool
[reconnect] attempt starting  name=uxr-tool attempt=1
# 服务端起来了
[reconnect] succeeded  name=uxr-tool attempt=1
[reconnect] loop ended  name=uxr-tool outcome=completed
# SDK 兜底调 onclose（如果调了）
[reconnect] onclose fired (observability only)  name=uxr-tool alreadyTriggered=true
```

**未改动**：
- `MAX_ERRORS_BEFORE_RECONNECT = 2` / `MAX_RECONNECT_ATTEMPTS = 5` / backoff 序列（1s→16s）
- `index.ts` 接入点（storeClient / closeClient / setupConnectionHandlers 调用关系不变）
- `convertMcpTool` 的 client getter（重连后自动命中新 client）
- 前端 SSE 监听（`mcp.tools.changed` 事件触发 refetch）
- `isTerminalConnectionError` 的 9 种匹配条件
- `isSdkGiveUpSignal` 的正则匹配

**风险点**：
- onclose 不再触发重连意味着如果 onerror 因任何原因没触发（极端边界场景），唯一兜底是 `onclose fallback`。如果连 onclose 也没触发，重连不会启动。但实际场景下 SDK 至少会触发其中一个。

### 2026-06-16: 修复 setupConnectionHandlers 重复装时残留标志导致重连死链

**问题**：状态升级为模块级后，触发过 close 的 server name 在以下场景下重新连接时，`triggeredCloseFlags` 残留导致新 client 永远不触发 close：

| 路径 | 状态清理时机 | 是否残留 |
|------|------------|---------|
| ① 应用启动 init | Map 本来空 | ✓ 不残留 |
| ② 断开 → 重连成功 | succeeded 分支清理 | ✓ 不残留 |
| ③ 断开 → 重连全失败 | 失败分支未清理 | ❌ 残留 |
| ④ 用户主动 disconnect → connect | closeClient 跳过 reconnect 不清状态 | ❌ 残留 |
| ⑤ authenticate → storeClient | 同 ④ | ❌ 残留 |
| ⑥ add → storeClient | 同 ④ | ❌ 残留 |

**根因**：闭包变量版本是 per-handler，每次 `setupConnectionHandlers` 自动重新开始；改成 per-name 后，状态跨 handler 实例残留。

**修复**：在 `setupConnectionHandlers` 入口清理两个状态：

```ts
terminalErrorCounts.delete(name)
triggeredCloseFlags.delete(name)
```

同时移除 `reconnectWithBackoff` succeeded 分支的冗余清理（入口已统一处理）。

**效果**：所有触发 `setupConnectionHandlers` 的路径（init / storeClient / reconnect succeeded）都从干净状态开始，标志残留问题彻底解决。

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

## 状态流转（2026-06-16 架构改造后）

```
connected ──onerror(give-up signal)──> 保持 connected + triggerReconnect(source=onerror-giveup)
        │                                      │
        │                                      └─> reconnectWithBackoff (异步)
        │
        └──onerror(terminal error count >= 2)──> 保持 connected + triggerReconnect(source=onerror-counter)

reconnectWithBackoff:
  ├─ attempt 1-5: 保持 connected, try create()
  │   ├─ 成功 → storeClient → connected (新 client, 装新 handler, 清状态)
  │   └─ 失败 → backoff sleep, continue
  │
  └─ 全部失败 → delete defs/clients → failed

onclose (可观测性日志，不触发重连):
  ├─ isIntentional=true → 仅日志
  ├─ isStale=true → 仅日志
  ├─ alreadyTriggered=true → 仅日志
  └─ 都为 false → onclose fallback 触发 triggerReconnect(source=onclose-fallback)
```

## 日志点（可观测性，2026-06-16 改造后）

所有日志带 `[reconnect]` 前缀，便于过滤。详细字段见 2026-06-16 章节的「新日志点」表格。

核心日志：
- `connection handlers installed` — 装上 handler 时
- `transport error` — 每次 onerror（含 `isTerminal` / `isGiveUp` / `consecutiveErrors` 字段）
- `trigger fired - starting reconnect loop` — 重连启动（含 `source` 标记来源）
- `trigger suppressed - *` — 重连被跳过（含具体原因）
- `attempt starting` / `attempt failed` / `succeeded` / `failed - max attempts reached`
- `onclose fired (observability only)` — SDK 调 onclose（不再触发重连）

## 异常码处理

**终端错误（计数 +1，累积到 2 触发重连）**：
- `ECONNRESET` — 连接被远程重置
- `ETIMEDOUT` — 连接超时
- `EPIPE` — 写入已关闭的管道
- `EHOSTUNREACH` — 主机不可达
- `ECONNREFUSED` — 连接被拒绝
- `Body Timeout Error` — HTTP body 超时
- `terminated` — SDK/transport 终止
- `SSE stream disconnected` — SSE 断开
- `Failed to reconnect SSE stream` — SSE 重连失败

**SDK give-up 信号（一次即触发重连，不计数）**：
- `Maximum reconnection attempts (N) exceeded`

**非终端错误（不计数，不触发重连）**：
- HTTP 4xx（鉴权失败等）— 由上层 needs_auth/needs_client_registration 处理
- 其他未知错误 — 不清零计数（旧逻辑清零导致振荡，已修复）

| `loop ended` | info | finally 清理 | `name` |