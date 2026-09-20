# Proxy 能力总览

> 本文档整理 octoAI 中网络代理（企业 W3 代理）能力的完整架构、实现细节、踩坑记录与演进时间线。
> 涉及包：`packages/desktop`（Electron 主进程/sidecar）、`packages/app`（设置 UI）、`packages/opencode`（核心绕代理）。
>
> 注意区分：`packages/opencode/src/server/proxy.ts`、`proxy-util.ts`、`httpapi/middleware/proxy.ts` 是**工作区反向代理**（UI 请求转发），与本文的网络代理无关。

## 1. 背景与能力总览

华为内网环境下访问外部 LLM API / 文档站点需要走 W3 企业代理（`http://user:pass@{host}.huawei.com:8080`），而访问华为内网服务（本地预配 provider、内网 MCP）则必须**绕过**代理直连。本套能力解决两个方向的问题：

| 方向 | 能力 | 实现层 |
|---|---|---|
| 走代理 | 桌面端设置页配置 W3 代理（节点/账号/密码/NO_PROXY），验证连通性后持久化，主进程与 sidecar 全链路生效 | desktop + app |
| 绕代理 | 本地 provider（`*.huawei.com`）与内网 MCP 自动直连，不受系统代理/ClashX 干扰 | opencode |

功能点清单：

- 24 个预置代理节点（普通/非研发/研发三组，香港默认）
- 代理认证：W3 账号密码内嵌 URL，undici 自动发 `Proxy-Authorization: Basic`（特殊字符 `'"()!*` 二次百分号编码）
- 配置验证：与 webfetch 同栈的 Node fetch 探测出口 IP（要求 119.x），失败时 curl 双探针（严格证书 vs `-k`）输出 MITM 证书替换对照诊断
- 配置持久化到独立的 `~/.config/octo/proxy_config.json`（单一事实源，所有读写统一走 `proxy-config.ts`）
- 即时生效：配置成功后环境变量保持注入 + 全局 dispatcher 已切换，无需重启
- NO_PROXY 默认 `localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com`，UI 可自定义；loopback（127.0.0.1/localhost/::1）强制补齐
- 本地 provider / 内网 MCP 绕代理直连（双保险：NO_PROXY 追加 + 自定义 undici dispatcher）
- 远程 MCP 每服务可配置 `proxy: true/false`，未配置时按 URL 私有性自动判定
- Chromium 网络栈走系统代理（`session.setProxy({ mode: "system" })`），并放行 loopback

## 2. 整体架构

```
┌─ 设置 UI (app/octoapp) ────────────────────────────────────┐
│ settings-general.tsx  ProxySection: 节点/账号/密码/NO_PROXY  │
└──────────────┬─────────────────────────────────────────────┘
               │ IPC: get-proxy-config / configure-proxy
┌──────────────▼─────────────────────────────────────────────┐
│ Electron 主进程 (desktop/src/main)                          │
│  ipc.ts        configure-proxy: 验证 → 写 proxy_config.json │
│  index.ts      setupApp: 读配置注入 env → setGlobalProxy…   │
│  server.ts     fork sidecar 前强制覆盖 proxy env            │
│  proxy-config.ts  单一事实源 ~/.config/octo/proxy_config.json│
└──────────────┬─────────────────────────────────────────────┘
               │ utility process (sidecar)
┌──────────────▼─────────────────────────────────────────────┐
│ sidecar (desktop/src/main/sidecar.ts)                      │
│  ensureProxyFromConfig → ensureLoopbackNoProxy → useEnvProxy│
└──────────────┬─────────────────────────────────────────────┘
               │ 运行 opencode 核心
┌──────────────▼─────────────────────────────────────────────┐
│ opencode 核心                                               │
│  util/network.ts     setupBypassProxyForLocalProviders       │
│  provider/provider.ts  本地 provider → bypass dispatcher 直连│
│  mcp/index.ts        mcpFetch 三态代理决策                   │
└─────────────────────────────────────────────────────────────┘
```

三层各自把 env 准备好并调用 `http.setGlobalProxyFromEnv()`（Node 24.14+ API，Electron 41.2/42 均可用），把 undici 全局 dispatcher 换成 `EnvHttpProxyAgent`。所有 Node `fetch`（含 webfetch 链路：`webfetch.ts → Effect FetchHttpClient → globalThis.fetch → undici 全局 dispatcher`）自动走代理；命中 NO_PROXY 或 bypass dispatcher 的请求直连。

## 3. 配置层：单一事实源

**文件：`packages/desktop/src/main/proxy-config.ts`**

```ts
export type ProxyConfig = {
  http_proxy?: string   // http://user:pass@proxyhk.huawei.com:8080
  https_proxy?: string  // 与 http_proxy 共用同一个 http:// 地址
  no_proxy?: string
  proxyOptionId?: string
}
```

- `proxyConfigFile()`：固定 `~/.config/octo/proxy_config.json`，**刻意不跟随 XDG_CONFIG_HOME**。旧实现写入走 `getOctoConfigPath()`（尊重 XDG）而读取硬编码 `~/.config/octo`，shell 设置了 `XDG_CONFIG_HOME` 的 mac 上写读分裂——设置页显示已配置，但主进程与 sidecar 都读不到，重启后 webfetch 不走代理（commit `a2ea39db3`）。所有读写必须统一走本模块。
- `readProxyConfig()`：容错读取，文件不存在/解析失败返回 null。
- `maskProxyUrl()`：日志脱敏，隐藏 URL 中的账号密码。

独立文件而非写进 `octo.json` 的原因：避免污染 octo.json 的 schema 校验（commit `0f6831a02`）。

## 4. 设置 UI

**文件：`packages/app/octoapp/components/settings-general.tsx`**

- `PROXY_OPTIONS`（70 行起）：24 个节点，三组——普通（proxy）、非研发（香港 proxyhk 默认、中国、南京、英国、美国、俄罗斯、巴西、巴林、印度、开放代理、南非、土耳其、加拿大、德国）、研发（日本、中国、瑞典、德国、土耳其、美国、开放代理、俄罗斯）。host 形如 `{name}.huawei.com:8080`。
- `ProxySection`（809 行起）：节点下拉（按组分组）、W3 账号、密码（可见切换）、"跳过代理"（NO_PROXY）输入框、配置按钮。
- 已配置信息回填：启动时经 `get-proxy-config` 从 proxy_config.json 解析出账号/密码/节点/noProxy 回填 UI（commit `a6d419905`），优先按 `proxyOptionId` 匹配，回退按 host 匹配。
- IPC 经 `packages/desktop/src/preload/index.ts` 的 contextBridge 暴露：`getProxyConfig` / `configureProxy`。

## 5. 配置流程（IPC `configure-proxy`）

**文件：`packages/desktop/src/main/ipc.ts`（1445 行起）**

`get-proxy-config`（1385 行）：读 proxy_config.json，从 URL 解码账号密码回填 UI；无账号密码视为未配置返回 null。

`configure-proxy(account, password, noProxyInput, proxyHostInput, proxyOptionIdInput)` 流程：

1. **拼代理 URL**：host 必须在 `PROXY_HOSTS` 白名单（22 个）内，否则回退 `proxyhk`。账号 `encodeURIComponent`，密码再对 `'"()!*` 做二次百分号编码（encodeURIComponent 不编码这些字符）。结果 `http://{user}:{pwd}@{host}.huawei.com:8080`。
2. **注入环境变量**：`http_proxy/https_proxy/no_proxy` + 三个大写，共 6 份，先保存旧值。
3. **切换全局 dispatcher**：`http.setGlobalProxyFromEnv()`，返回 restore 函数（验证失败时还原）。
4. **验证（与 webfetch 同栈）**：主进程 Node `fetch("https://ifconfig.me/ip")`，20s 超时，**证书正常校验**，要求出口 IP 以 `119.` 开头才算通过。旧实现用 `curl -k` 会跳过证书校验——代理对 HTTPS 做证书替换（MITM）时验证"通过"但 sidecar 里 webfetch 实际失败。
5. **成功**：写 `~/.config/octo/proxy_config.json`，环境变量保持注入 → 即时生效，无需重启（commit `5320dd86a`）。
6. **失败**：趁 env 仍指向新代理跑 curl 双探针对照诊断——严格证书 vs `-k` 跳过证书。若"严格失败而跳过成功"，提示通常是代理 MITM 证书替换，需在系统钥匙串安装代理根证书。然后恢复旧环境变量 + 调 restore 函数还原 dispatcher，把诊断信息随错误返回 UI。

日志脱敏：IPC 返回与前端日志中不输出账号密码（commit `6fcb6c98b`）。

## 6. 启动注入链路

### Electron 主进程（`packages/desktop/src/main/index.ts`）

```
setupApp():
  ensureLoopbackNoProxy()          # NO_PROXY 强制补 127.0.0.1/localhost/::1
  useEnvProxy()                    # 读 proxy_config.json 注入 6 个 env → setGlobalProxyFromEnv()
  appendSwitch("proxy-bypass-list", "<-loopback>")   # Chromium 侧放行 loopback
  preferAppEnv(userData)           # macOS shell 探测
  useEnvProxy()                    # 再补一次：防 shell 探测覆盖 proxy 变量
app.whenReady():
  session.defaultSession.setProxy({ mode: "system" })  # Chromium 走系统代理
spawnLocalServer 回调 (300 行):
  ensureLoopbackNoProxy() + useEnvProxy()   # sidecar 拉起前兜底
```

`useEnvProxy()`（228 行）注意顺序：**先注入 env 再调 `setGlobalProxyFromEnv()`**——后者读取调用时刻的 env，顺序反了首次调用是 no-op（旧 bug）。

Chromium 层用 `system` 模式而非强制直连：避免外部 CDN/API 在受代理网络下失败（commit `8ee04d4e0`）。page-capture 捕获窗口例外用 `direct`。

### sidecar 拉起（`server.ts` createSidecarEnv，255 行）

fork 前从 proxy_config.json **强制覆盖**（不是补充）子进程 env 的 proxy 变量，确保 macOS shell 探测干扰后 sidecar 仍能读到代理。

### sidecar 进程（`sidecar.ts`）

```
ensureProxyFromConfig()   # 只补缺失不覆盖；须在 ensureLoopbackNoProxy 之前
ensureLoopbackNoProxy()   # loopback 合并进 no_proxy
useSystemCertificates()
import("virtual:opencode-server")
useEnvProxy()             # import 服务后再调 setGlobalProxyFromEnv()
```

侧载日志：`[sidecar:proxy] proxy env ready` / `setGlobalProxyFromEnv OK, proxy: http://***:***@…`。

## 7. opencode 核心绕代理能力

### 7.1 NO_PROXY 追加（`packages/opencode/src/util/network.ts`）

`setupBypassProxyForLocalProviders()` 把内网域名追加进 NO_PROXY（已存在的不重复加）：

```ts
const BYPASS_PROXY_HOSTS = [
  "octoai-llm.ucd.huawei.com", "octoai-api.ucd.huawei.com",
  "aigateway.huawei.com", "aigateway.his-beta.huawei.com",
  ".huawei.com", "localhost", "127.0.0.1",
]
```

由三个入口顶部调用：`src/index.ts`、`src/node.ts`、`src/cli/cmd/tui/worker.ts`。另有 `proxied()` 检测是否配置了代理。

### 7.2 本地 provider 直连 dispatcher（`packages/opencode/src/provider/provider.ts`）

- `LOCAL_PROVIDER_IDS = { opencode, bpit, bpit-beta }`（318 行）
- `LOCAL_PROVIDER_HOST_PATTERNS`：`*.huawei.com`、`localhost`、`127.0.0.x`、`::1`
- `getBypassDispatcher()`（328 行）：懒加载单例 undici `Agent`——`headersTimeout/bodyTimeout` 5 分钟、`connectTimeout` 30s、`keepAliveTimeout` 1s（短 keepalive 防连接池陈旧连接被 RST）。Bun.fetch 不读 HTTP_PROXY，非 Node 环境直接返回 null。
- 请求时（2138 行）：`shouldUseBypassDispatcher()` 命中则通过 fetch 的 `dispatcher` 选项覆盖全局代理 dispatcher，强制直连。

**解决的问题**：系统代理/ClashX 场景下，本地预配 provider（octoai-llm 等）被 EnvHttpProxyAgent 送进代理，6 秒规律性 "Request was cancelled"。NO_PROXY 追加（7.1）与 dispatcher 覆盖（7.2）双保险（commit `4130c1408`）。

开关：`OPENCODE_DISABLE_BYPASS_DISPATCHER=1` 同时关闭 7.1 和 7.2。

### 7.3 远程 MCP 三态代理决策（`packages/opencode/src/config/mcp.ts` + `src/mcp/index.ts`）

MCP schema 增加可选字段 `proxy?: boolean`。连接时：

```ts
mcpFetch(proxy, url):
  proxy === true  → globalThis.fetch            # 强制走代理
  proxy === false → noProxyFetch                # 强制绕过
  未设置          → isPrivateUrl(url) ? noProxyFetch : globalThis.fetch
```

- `noProxyFetch`（44 行）：临时清空 4 个 proxy env → fetch → finally 恢复。
- `isPrivateUrl`（54 行）：localhost / 127.0.0.1 / ::1 / 10.x / 172.16-31.x / 192.168.x。
- 日志：`[octo:mcp] connect-remote` 携带 `proxyMode`（`system(forced)` / `bypass(forced)` / `bypass(private)` / `system(public)`），与 mcpFetch 决策同口径。
- **已知坑**：华为 7.x 内网 IP 不被 `isPrivateUrl` 识别为私有，会落到 system(public) 走代理 → 504。所以 `builtin-mcp.ts` 中 uxr-tool 显式 `proxy: false`（commit `128df7109`）。

## 8. 环境变量与开关汇总

| 变量 | 说明 |
|---|---|
| `http_proxy` / `https_proxy`（+大写） | 代理 URL，含认证信息；两者共用同一个 `http://` 地址 |
| `no_proxy` / `NO_PROXY` | 默认 `localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com` |
| `OPENCODE_DISABLE_BYPASS_DISPATCHER=1` | 关闭本地 provider bypass dispatcher + NO_PROXY 追加 |

## 9. 日志排查点

| 场景 | 日志 |
|---|---|
| 主进程加载配置 | `octo proxy config loaded`（含脱敏后的代理地址、配置文件路径） |
| 配置验证 | `[configure-proxy] 开始配置代理 / 环境变量已注入 / 执行 Node fetch 验证 / 代理验证通过 / 配置写入成功 / 配置失败` |
| MITM 诊断 | `curl 对照诊断 — 严格证书: … \| 跳过证书(-k): …` |
| sidecar | `[sidecar:proxy] proxy env ready` / `setGlobalProxyFromEnv OK` / `no proxy_config.json, env proxy: <unset>` / `proxy env MISSING — setGlobalProxyFromEnv is a NO-OP`(env 缺失,fetch 必直连) |
| sidecar dispatcher 强校验（2026-09-16 新增） | `global dispatcher verified: EnvHttpProxyAgent`（读回 undici 全局槽确认已装上）；WARN `dispatcher slot is "Agent"/"<unset>" (expected EnvHttpProxyAgent) — fetch will go DIRECT` = setGlobalProxyFromEnv 声称 OK 但槽里不是代理 dispatcher，所有 fetch 必直连 |
| webfetch 失败 | 错误信息含 cause 链:`webfetch failed (url): TypeError [ECONNREFUSED] ...`(连接层)或 `HTTP 4xx/5xx`(状态层)或 `Request timed out`(超时)，尾部附 `[net-diag: proxy=on/off dispatcher=<ctor> runtime=<bun|electron|node>]`（2026-09-16 新增） |
| fork 注入 | `[server:createSidecarEnv] proxy config injected` |
| provider 直连 | `fetch #N using bypass dispatcher`（fetchDebug） |
| MCP 连接 | `[octo:mcp] connect-remote`（key、url、proxy、proxyMode、timeout、oauth、headerKeys） |

net-diag 判读（实现见 `packages/opencode/src/util/network.ts` `networkDiag()`）：

| net-diag | 含义 |
|---|---|
| `proxy=off dispatcher=Agent` | 本进程无 proxy env，请求必直连（未配置代理 / env 没传进该进程） |
| `proxy=on dispatcher=EnvHttpProxyAgent` | 代理已生效，失败为连接层问题——再看 cause 链 attempted addresses：是代理 IP=代理连不上；是目标 IP=异常（见 §10.6） |
| `proxy=on dispatcher=Agent/<unset>` | env 有但全局 dispatcher 没装上（setGlobalProxyFromEnv 未生效或被覆盖），强信号直接定位层 |
| `runtime=bun` | 报错来自 TUI/CLI（Bun 原生 fetch 不走 undici dispatcher，目前完全无代理能力，见 §10.6 待办） |

## 10. 踩坑记录（详见对应文档）

1. **mac 上配置后 webfetch 不生效**（`mac-proxy-not-effective.md`）：三重根因——XDG_CONFIG_HOME 导致 proxy_config.json 写读分裂；curl 与 webfetch 不同栈（curl -k 跳过证书掩盖 MITM 问题）；macOS shell 探测（preferAppEnv）覆盖 proxy 环境变量需补注入。最终修复：统一走 `proxy-config.ts` 固定路径 + createSidecarEnv 强制覆盖 + preferAppEnv 后补调（`a57e41649`、`a2ea39db3`）。
2. **本地 provider 6 秒规律 fetch failed**（`fix-local-provider-proxy-bypass.md`）：系统代理把内网请求送进代理 → dispatcher 覆盖 + NO_PROXY 双保险（`4130c1408`）。
3. **内网 MCP 504**（`mcp-proxy-strategy.md`）：7.x IP 不被识别为私有 → mcp `proxy` 字段三态决策 + uxr-tool 显式 `proxy: false`（`3a5e1a785`、`cea9f2086`、`128df7109`）。
4. **MITM 证书替换**：代理对 HTTPS 做证书替换时，curl -k 验证通过但 Node fetch（正常校验证书）失败 → 验证链路改为与 webfetch 同栈的 Node fetch + curl 双探针对照诊断。
5. **Intel mac 配置后 webfetch 依旧不生效**（2026-09-09 起，排查中）：`setGlobalProxyFromEnv OK` 日志与 sidecar env（`proxy env ready` 的 effective 值）均正常，但 webfetch 失败。关键结论：
   - **`setGlobalProxyFromEnv OK` 是弱信号**：Node 24.15 源码（`lib/http.js`）确认，env 无 `http_proxy`/`https_proxy` 时函数**静默 no-op 不报错**（`return () => {}`）；env 有值时**无条件** `setGlobalDispatcher(new EnvHttpProxyAgent(...))`，不存在被已有 dispatcher 阻挡的 no-op。已加 `proxy env MISSING` 警告补强。
   - **utility process（sidecar 同环境）已实测代理生效**（Electron 42 + Node 24.15，假代理 ECONNREFUSED 毫秒级）→ 排除 utility process 环境问题。**注意：该实测在 Windows 上执行，mac 未单独实测**（见 §10.6）。
   - **no_proxy 匹配实测**（`_proxy_noproxy_match_test.cjs`）：默认值/loopback 追加/尾逗号/空条目均正常走代理；`*` 或过短后缀条目（`.me`/`.com`）会让匹配域名**绕过代理直连**。Intel mac 实际 effectiveNoProxy 为默认值，无污染。
   - **代理 URL 尾斜杠**（`...:8080/`）实测无影响（undici 照常走代理），但注意标准拼接（ipc.ts）不产生尾斜杠，配置里出现说明来源有差异（手改/旧版本/UI 输入）。
   - **webfetch 错误信息曾丢失 cause 链**（只有 `TypeError: fetch failed`）→ 已增强 `webfetch.ts`：失败时展开 cause 链（errno code/证书错误/HTTP 状态）。
   - ~~剩余方向：webfetch 是否跑在该 sidecar（远程 server URL）；或 fetch 走了代理但请求失败~~ → §10.6 第二轮排查已证明是**直连**，"走了代理但失败"方向排除。

6. **四条链路日志全绿仍直连——第二轮排查与自诊断加固**（2026-09-16，用户 lixiaomin/mac，webfetch 阿里云/华为云超时）：
   - **报错分析**：`ConnectTimeoutError [UND_ERR_CONNECT_TIMEOUT]` + `attempted addresses` 全是**目标站 CDN IP**（12 个）而非代理节点 IP → 该请求 100% 没走代理（走 EnvHttpProxyAgent 时 undici 连的是代理地址，目标 DNS 由代理解析，本地拿不到目标 IP 列表）。10s 是 undici 默认 connect timeout，先于 webfetch 自身 30s 超时触发。
   - **报错进程定位**：该错误签名是 **undici 独有**；Bun 原生 fetch 的连接失败格式完全不同（`Unable to connect. Is the computer able to access the url?`，实测 Bun 1.3.13）→ 报错的 webfetch 跑在 Node 系进程（= desktop sidecar），不是 TUI。错误日志位于 `~/.local/share/opencode/log/<启动时间戳>.log`——**sidecar（legacy storage）与 CLI 共用该目录**（`Global.Path.log = $XDG_DATA_HOME/opencode/log`，legacy 模式只覆盖 XDG_STATE_HOME），日志路径不能单独区分进程，需按文件名（=进程启动时间 UTC）与 main.log 的 sidecar 启动时间比对。
   - **进程内篡改路径全部排除**（源码 + opencode/desktop 两棵 node_modules + 23MB 交付 bundle `dist/node/node.js` 逐一 grep）：无人调 `setGlobalDispatcher`（仅 undici 自身 global.js 模块初始化）、无人赋值 `globalThis.fetch`（SDK 里只是报错文案；undici `install()` 无人调用）、无每请求 `dispatcher` 传入 webfetch 链（effect `FetchHttpClient` 用 `globalThis.fetch`，`RequestInit` service 无人 provide）、`SnapshotAgent` 无人构造。
   - **slot 机制 Windows 实测通过**（`_verify_slot_test.cjs`，Electron 42.0.0/Node 24.15.0）：`setGlobalProxyFromEnv` 写入 `globalThis[Symbol.for("undici.globalDispatcher.1")]` = EnvHttpProxyAgent；npm undici 7.25.0 `getGlobalDispatcher()` 读到同一对象；`globalThis.fetch` 假代理 16ms ECONNREFUSED → 机制在 Windows 端到端无懈可击。**矛盾：用户 mac 上同样四条绿日志却直连 → 唯一未验证变量是 mac 版 Electron utility process**。
   - **undici EnvHttpProxyAgent 7.25.0 源码结论**：`http_proxy/https_proxy` 在**构造时缓存** ProxyAgent（运行时删 env 不影响已装 dispatcher → `noProxyFetch` 因此失效，见待办）；`no_proxy` **每次请求动态读 env**（`#noProxyChanged`）——好在全仓无运行时改写 NO_PROXY 的代码，否则并发请求会瞬间变直连。
   - **Bun fetch 代理行为实测**（对 TUI 修复关键）：运行中 `process.env.HTTP_PROXY=...` **完全无效**（对照直连成功）；**进程启动时**设置的 env 有效（假代理 14ms ECONNREFUSED）→ Bun 只认启动时（或首次 fetch 前）的 proxy env。
   - **本轮新增自诊断**（已实现并重建产物）：
     - `sidecar.ts` `useEnvProxy()`：调 `setGlobalProxyFromEnv` 后**读回全局 dispatcher 槽**，非 `EnvHttpProxyAgent` 打 WARN `dispatcher slot is "..." (expected EnvHttpProxyAgent) — fetch will go DIRECT`（§9 表）。
     - `webfetch.ts`：失败与超时错误尾部附 `[net-diag: proxy=… dispatcher=… runtime=…]`（`util/network.ts` `networkDiag()`），用户下次报错自带定位信息（判读表见 §9）。
   - **剩余动作**：① 让用户装新构建重试，报错自带 net-diag 一锤定音；② 找一台 mac 跑 `packages/desktop/node_modules/.bin/electron _electron_utility_proxy_test.cjs`（假代理毫秒级 ECONNREFUSED = mac 机制正常；否则根因即 mac 版 utility process）；③ 对照报错日志文件名与 main.log sidecar 启动时间，确认进程归属。
   - **顺带发现的待办**（独立于本案，建议排期）：
     - TUI/CLI 完全无代理能力：入口（`index.ts`/`node.ts`/`worker.ts`）不读 `proxy_config.json`，Bun fetch 只认启动时 env → 修法：在**任何 fetch 发生前**读配置注入 env（Node 环境再补 `setGlobalProxyFromEnv()`）。
     - `noProxyFetch`（`mcp/index.ts`）在桌面端配了代理时**无效**：EnvHttpProxyAgent 构造时缓存 ProxyAgent，删 env 改不了已装 dispatcher，uxr-tool 等内网 MCP 的 `proxy: false` 并未真正绕过代理 → 应改为 provider.ts 式每请求裸 `dispatcher`。
     - `configure-proxy` 只更新主进程，sidecar 需重启才拿到新代理（UI 仅 toast 提示）→ 可经 parentPort 通知 sidecar 重跑 `ensureProxyFromConfig()+setGlobalProxyFromEnv()` 实现热更新。

## 11. 演进时间线

| 日期 | Commit | 内容 |
|---|---|---|
| 06-03 | `3a5e1a785` | fix(mcp): 内网 MCP 服务器绕过 HTTP 代理 |
| 06-06 | `cea9f2086` | feat: MCP 代理可配置（proxy 字段） |
| 06-15 | `128df7109` | uxr-tool 强制绕过代理 |
| 06-27 | `4130c1408` | fix(provider): 本地 provider 6 秒 fetch failed — dispatcher + NO_PROXY 双保险 |
| 07-24 | `feab6fb42` / `0913c5f48` | feat(proxy): 添加 W3 代理配置功能 + 启动注入 |
| 07-27 | `2316886fc`…`6cc444736` | curl 验证链路系列改进 + 119.x 出口 IP 校验 |
| 07-27 | `0f6831a02` | 代理配置写入独立 proxy_config.json，避免污染 octo.json |
| 07-30 | `5320dd86a` | 配置成功后保持环境变量注入，即时生效 |
| 08-03 | `7e1d28c0f`/`19bd16674` → revert | mac 注入尝试及回退 |
| 08-05 | `a57e41649` / `8ee04d4e0` | macOS 强制注入防 shell 探测覆盖；defaultSession 改 system proxy |
| 08-28 | `4a3f74d12` / `a6d419905` / `fe8047263` | 可配置代理节点（24 个）；已配置信息回填；样式 |
| 09-02 | `a2ea39db3` | 统一 proxy_config.json 路径，修复 mac 上 webfetch 不生效 |

## 12. 相关文档与验证脚本

详细设计/排查文档（同目录）：

- `mac-proxy-not-effective.md` — mac 代理不生效两轮根因分析
- `mcp-proxy-strategy.md` — MCP 代理策略
- `fix-local-provider-proxy-bypass.md` — 本地 provider 绕代理修复

根目录临时验证脚本（`_proxy*.cjs`/`.mjs`、`_electron_*_test.cjs`，验证 undici 行为用，可删）：

- `_proxy_test.cjs` / `_proxy_test.mjs` / `_proxy_variant_test.cjs` — `setGlobalProxyFromEnv` 生效条件
- `_proxy_auth_test.cjs` / `_proxy_auth2_test.cjs` — 假 TCP 代理验证 `Proxy-Authorization: Basic` 头
- `_proxy_behavior_test.cjs` — EnvHttpProxyAgent 行为
- `_electron_main_proxy_test.cjs` / `_electron_restore_test.cjs` — Electron 主进程 fetch 栈与 restore 函数
- `_electron_utility_proxy_test.cjs` + `_electron_utility_sidecar_test.cjs` — **utility process 假代理验证（mac 定案关键：毫秒级 ECONNREFUSED = 机制正常）**
- `_verify_slot_test.cjs` — 全局 dispatcher 槽机制验证（slot 写入 / npm undici 同槽 / fetch 实走代理）
