# 本地 provider 6 秒 fetch failed 修复

## 背景

octo AI 等本地预配 provider 走华为内网域名（`http://octoai-llm.ucd.huawei.com/v1`），
在某些用户机器上（特别是 Mac）出现：

```
AI_RetryError / AI_APICallError
  └── cause: TypeError: fetch failed
  └── cause.cause: Error: Request was cancelled. (code: 0)
  └── at_ms: ~6032ms / ~6027ms （严格 6 秒规律）
```

## 根因（fetch-debug 日志定位）

| 字段 | 值 | 含义 |
|---|---|---|
| `user-agent` | `runtime/node.js/24` | Node.js 24 + undici（不是 Bun） |
| `at_ms` | 严格 ~6000ms | 6 秒规律，不是随机抖动 |
| `error.cause` | `Error: Request was cancelled.` code: 0 | undici 在 dispatcher 主动 cancel 时的标准错误 |
| `combined_aborted_at_error` | `false` | fetch 抛错时所有 signal 都未 abort |
| `sources_seen` | `[]` | 完全没有 signal abort 事件 |
| `options_timeout_signal_present` | `false` | opencode 的 timeout 配置没生效 |
| `chunk_signal_present` | `false` | opencode 的 chunkTimeout 也没设 |

**结论**：abort 完全不来自客户端 signal 链路，是 fetch 底层被某个代理 / dispatcher 拦截后主动 cancel。
参考 [undici Issue #2161](https://github.com/nodejs/undici/issues/2161) —
`Request was cancelled.` 在 undici 中**只在 ProxyAgent / dispatcher 主动 cancel 时出现**。

curl 能拿到 SSE 流说明服务端正常，**问题在客户端网络层**（系统代理 / ClashX 增强模式 /
Surge / 公司网关 / TUN 模式）。

## 修复方案（双保险）

### 1. 自定义 undici dispatcher（主方案）

`packages/opencode/src/provider/provider.ts` 中新增 `getBypassDispatcher()` +
`shouldUseBypassDispatcher()`。在 `options["fetch"]` 包装器中：

- 命中本地 provider（`opencode` / `bpit` / `bpit-beta`）或华为内网域名（`*.huawei.com`）时
- 使用独立的 undici `Agent`，配置：
  - `headersTimeout: 0` — 禁用 headers 超时
  - `bodyTimeout: 0` — 禁用 body 超时（SSE 流可能慢）
  - `connectTimeout: 30_000` — 连接建立仍给 30s 兜底
  - `keepAliveTimeout: 1_000` / `keepAliveMaxTimeout: 5_000` — 短 keepalive，
    避免连接池里的陈旧连接被服务端 RST
- 通过 `fetchFn(input, { ...opts, dispatcher })` 传入，**覆盖**任何全局 dispatcher
  （包括 EnvHttpProxyAgent / setGlobalDispatcher 设置的代理）

Bun 环境自动跳过（Bun.fetch 不读 HTTP_PROXY，无需修复）。

### 2. 进程启动时设 NO_PROXY（兜底）

`packages/opencode/src/util/network.ts` 新增 `setupBypassProxyForLocalProviders()`：
追加以下 host 到 `NO_PROXY` / `no_proxy` 环境变量：
- `octoai-llm.ucd.huawei.com`
- `octoai-api.ucd.huawei.com`
- `aigateway.huawei.com`
- `aigateway.his-beta.huawei.com`
- `.huawei.com`
- `localhost` / `127.0.0.1`

在三个入口文件顶部调用：
- `src/index.ts`（CLI）
- `src/node.ts`（Desktop sidecar）
- `src/cli/cmd/tui/worker.ts`（TUI worker）

兜底场景：第三方代码（如 ai-sdk、MCP server）若显式使用 `EnvHttpProxyAgent`，
NO_PROXY 也能让它跳过这些 host。

### 关闭开关

如修复引发副作用，可通过环境变量关闭：

```bash
OPENCODE_DISABLE_BYPASS_DISPATCHER=1 opencode
```

## 涉及文件

- `packages/opencode/src/provider/provider.ts`
  - 新增模块级 helper：`LOCAL_PROVIDER_IDS` / `LOCAL_PROVIDER_HOST_PATTERNS` /
    `getBypassDispatcher()` / `shouldUseBypassDispatcher()`
  - `options["fetch"]` 包装器中应用 `dispatcher` 选项
- `packages/opencode/src/util/network.ts`
  - 新增 `setupBypassProxyForLocalProviders()` 函数
- `packages/opencode/src/index.ts`（顶部加调用）
- `packages/opencode/src/node.ts`（顶部加调用）
- `packages/opencode/src/cli/cmd/tui/worker.ts`（顶部加调用）

## 验证

```bash
cd packages/opencode
bun turbo build --force
```

修复生效后，fetch-debug 日志会出现：
```
INFO service=fetch-debug seq=N using bypass dispatcher
```

并且原来 6 秒规律抛错的 `fetchFn threw` 事件不再出现。

## 如果修复无效

说明问题不在客户端代理层，可能是：
- **服务端 RST**：联系 octoai-llm.ucd.huawei.com 服务端团队查 nginx access log
- **HTTP/2 兼容性**：尝试在 `getBypassDispatcher` 中显式 `allowH2: false`（已是 undici 默认）
- **DNS / TLS 问题**：用 `openssl s_client` 测试连接

排查时仍可参考 `abort-controller-diagnostic.md` 的 fetch-debug 日志。
