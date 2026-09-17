# 设置页 MCP 管理(transport 固定 / 配置缓存失效)

> 配套前端功能:设置对话框新增与 [供应商][模型] 同级的 MCP 页(内置仅展示;自定义可添加/编辑/开关/删除,类型 stdio / http / sse)。
> 实现主体在 `packages/app`(settings-mcp.tsx、dialog-mcp-form.tsx)与 `packages/desktop`(mcp-config-write IPC 直改 octo.json),本文只记录 packages/opencode 内为支撑该功能做的 3 处最小改动。

## 1. ConfigMCP schema 扩展 — `src/config/mcp.ts`

`Local` / `Remote` 各新增 3 个 optional 字段:

| 字段 | 类型 | 用途 |
|---|---|---|
| `transport` (仅 Remote) | `Schema.Literals(["http", "sse"])` | UI 强制指定 transport;`http`=仅 StreamableHTTP,`sse`=仅 SSE,不设置保持「HTTP 优先 + SSE 降级」现状 |
| `homepage` | String | 展示元数据(主页链接) |
| `docs` | String | 展示元数据(文档链接) |

**为什么必须进 schema**:Effect Schema 解码会剥离未声明字段(实测 `{transport, homepage, docs}` 经 `ConfigMCP.Remote` 解码后全被剥掉)。不进 schema,则用户在 octo.json 里手写的这些字段活不过配置加载,GET /global/config 也看不到。

**effect@4 beta 坑**:多值 literal 必须用 `Schema.Literals(["http", "sse"])`(数组参数);`Schema.Literal("http", "sse")` 只认第一个值,`"sse"` 解码直接失败。代码库惯例见 `Config.Info` 中 `Schema.Literals([...])` 用法。

## 2. connectRemote 按 transport 过滤 — `src/mcp/index.ts`

`connectRemote` 的 transports 数组(约 :413-430)追加一行 filter:

```ts
].filter((t) => !mcp.transport || t.name === (mcp.transport === "sse" ? "SSE" : "StreamableHTTP"))
```

- `transport: "http"` → 只尝试 StreamableHTTP;`"sse"` → 只尝试 SSE;`undefined` → 保持原双 transport 降级行为(存量/内置配置零影响)。
- 重连路径无需额外处理:`Reconnect.storeRemoteConfig` 存整个 config,重连时同样走此 filter。
- 诊断日志:`[octo:mcp] connect-remote`(:380)增加 `transport: mcp.transport ?? "auto"` 字段,`transport-try`(:436)天然只出现被保留的 transport,可据此确认强制生效。

## 3. dispose 时刷新配置缓存 — `src/server/global-lifecycle.ts`

`disposeAllInstancesAndEmitGlobalDisposed` 内 `store.disposeAll()` 之后新增:

```ts
yield* config.invalidate()
```

**为什么必须**:外部(桌面 IPC)直接编辑 octo.json 后,仅 dispose 不够——`cachedGlobal` 是无限 TTL 的缓存(config.ts getGlobal),只有 updateGlobal / replaceGlobalProvider 会显式失效。不 invalidate 则实例懒重建时仍读旧配置,MCP 增删改永远不生效。统一在 dispose 链路失效后,updateGlobal / replaceProvider 路径的双重 invalidate 无害(幂等)。

## 4. 全链路生效路径(跨包总览)

```
settings-mcp.tsx 写操作
  → window.api.mcpConfigWrite (desktop ipc.ts "mcp-config-write",jsonc modify 保留注释,内置名单拒改)
  → globalSDK.global.dispose() → disposeAll + config.invalidate()(本文 §3)
  → global.disposed 事件 → 实例懒重建 → 重读 octo.json → MCP 按新配置连接(§2 的 transport 语义)
  → 前端 invalidate ["config"] + mcpQueryKey → 设置页状态收敛
```

UI 类型 ↔ octo.json 映射:stdio→`{type:"local"}`;http→`{type:"remote",transport:"http"}`;sse→`{type:"remote",transport:"sse"}`。

## 5. 已知限制

- 强制 sse + OAuth 的服务器无法走完授权:`startAuth` 仅构造 StreamableHTTPClientTransport(mcp/index.ts 约 :1040),罕见组合,暂不处理。
- SDK v2 类型(`packages/sdk/js/src/v2/gen/types.gen.ts` 的 `McpRemoteConfig`)未再生成,不含 transport/homepage/docs;运行时响应经 `Config.Info`(直接引用 ConfigMCP schema,见 httpapi groups/global.ts `configGet`)已包含新字段,app 侧按宽对象读取(`mcpEntryToFormState`)。
- stdio(local)无自动重连,为存量行为,不在本次范围。
