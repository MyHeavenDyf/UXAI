# macOS 代理配置重启不生效 — 修复尝试与还原记录

## 问题

用户在 macOS 桌面客户端中配置代理（通过 `settings-general.tsx` 的 `configureProxy` 按钮），成功验证并通过 curl 测试后，代理配置写入 `~/.config/octo/proxy_config.json`。但重启客户端后代理不生效。

## 根因分析

### 架构背景

客户端采用**主进程 + sidecar（utility process）** 双进程架构：

1. **主进程**（`index.ts`） — setupApp 时调用 `useEnvProxy()`，从 `~/.config/octo/proxy_config.json` 读取代理注入 `process.env` 并调用 `setGlobalProxyFromEnv()`
2. **Sidecar**（`sidecar.ts`） — 独立 utility process，由 `spawnLocalServer` 通过 `utilityProcess.fork` 启动，env 来自 `createSidecarEnv()`（主进程 `process.env` 快照）

### 排查方向

**1. 主进程 proxy 被 shell 探测覆盖**（`index.ts` + `server.ts`）

`setupApp()` 的启动时序：
```
useEnvProxy()     → 注入 proxy → process.env 有 proxy
preferAppEnv()    → macOS 走 loadShellEnv(shell 探测) → mergeShellEnv 覆盖 process.env
                    (shell 探测结果里没有 proxy_config.json 的 proxy，因为那是内存注入)
```

`preferAppEnv` 只在 macOS/Linux 执行（`process.platform === "win32" ? null : getUserShell()`），Windows 跳过。

**2. Sidecar 不读 `proxy_config.json`**（`sidecar.ts`）

Sidecar 的 `useEnvProxy()` 只调 `setGlobalProxyFromEnv()`，从不读 `proxy_config.json`。即使主进程传了 proxy 到 sidecar env，sidecar 也没有兜底机制。

### 修复尝试

**提交 1** — `7e1d28c0f`：sidecar 启动时从 `proxy_config.json` 读代理注入自身 env（仅 `darwin` 平台）

**提交 2** — `19bd16674`：主进程 `preferAppEnv` 后再次调用 `useEnvProxy()` 补注

### 修复无效原因

1. 用户反馈 `main.log` 中无相关 proxy 日志 → 但 `useEnvProxy()` 成功时本身不打日志，只在失败时打 `failed to load octo proxy config`。没有日志 = 大概率静默成功了。
2. 用户客户端不生效 → 说明主进程虽有 proxy env，但可能 Electron 的 `setGlobalProxyFromEnv()` 或 Chromium 网络栈（`net.fetch`/`net.request`）与 Node.js `process.env` 不在同一层。`configure-proxy` 配置成功后能生效，是因为配置时同时调了 `setGlobalProxyFromEnv()` + 此时 Electron 网络栈还活着。
3. 确认 sidecar 走得通环境变量依然不生效。说明需要结合 Electron 网络栈。
4. 考虑到 Electron 的 Chromium 网络栈不是通过 `process.env` 读取代理，而是通过 `--proxy-server` 命令行参数或其自身的代理配置接口，`setGlobalProxyFromEnv()` 能覆盖 Node.js 的 HTTP agent，但 Electron 的 `net.fetch`/`net.request` 可能不走 Node.js 的 HTTP 模块。

### 结论

后续需要参考 `configure-proxy` 配置时的方法，配置时生效的是主进程端，可能是因为 Electron 端的 `setGlobalProxyFromEnv()` 能生效，但重启后主进程启动时序中，`import("virtual:opencode-server")` 之前的 `setGlobalProxyFromEnv()` 调用时机可能不对。或者 sidecar 的网络请求走的是 Node.js fetch 而非 Chromium 网络栈，需要确认 sidecar 中实际使用的 HTTP 客户端。

关键位置：`setGlobalProxyFromEnv()` 在 `index.ts useEnvProxy()` 里，但 `preferAppEnv` 中 `loadShellEnv` 的 shell 探测结果可能覆盖了 `process.env` 中的 proxy。后续应:

1. 确认 main.log 中 `preferAppEnv` 前后 `process.env.http_proxy` 的值（通过日志）
2. 确认 `setGlobalProxyFromEnv()` 是否真的对 Electron 的 Chromium 网络栈生效
3. 确认 sidecar 中实际使用的网络栈是 Node.js 还是 Chromium

## 还原

- 2026-08-03: 还原提交 `7e1d28c0f`（sidecar 注入）和 `19bd16674`（主进程补注）
- 还原后 `dev_dyf` 回到 `5192f7467`

---

# 2026-09-02 第二轮分析：webfetch 代理失效根因定位与修复

## 症状（聚焦 webfetch）

部分 mac 机器上，设置代理时连通性测试成功（curl 走代理访问 ifconfig.me 返回 119.x），
但桌面端实际使用 webfetch 访问同一地址失败。

## 关键验证（本地 Electron 42 / Node 24.15.0 实测，与线上同一二进制）

以下环节全部正常，逐项排除：

| 环节 | 验证方式 | 结论 |
|---|---|---|
| `http.setGlobalProxyFromEnv()` 存在 | Node changelog：24.14.0 加入（PR #60953） | Electron 41.2(24.14.1)/42(24.15.0) 均有 |
| 对全局 fetch 生效 | 假代理 127.0.0.1:9 → ECONNREFUSED 5ms | ✓ undici 全局 dispatcher 被替换为 EnvHttpProxyAgent |
| env 读取时机 | 进程启动后注入 env 再调用 | ✓ call-time 读取，不依赖启动快照 |
| 代理 URL 带账号密码 | 假 TCP 代理抓 CONNECT | ✓ `Proxy-Authorization: Basic ...` 正确发送，%40 等编码正确解码 |
| NO_PROXY 含 `::1`/`.huawei.com` | 直接实测 | ✓ 不影响 |
| 真实 Electron 主进程 fetch 栈 | 非 ELECTRON_RUN_AS_NODE 模式实测 | ✓ 主进程 fetch 也是 undici 栈，setGlobalProxyFromEnv 生效；https.globalAgent 同样生效 |
| restore 返回值 | 实测 | ✓ 返回还原函数，调用后恢复直连 dispatcher |
| webfetch 请求链 | 源码 | ✓ `webfetch.ts` → Effect `FetchHttpClient`（tool/registry.ts 提供）→ `globalThis.fetch` → 全局 dispatcher |
| sidecar 打包产物 | grep out/main/chunks | vendored undici 与内建 undici 共享 `Symbol.for("undici.globalDispatcher.1")` 全局槽，无覆盖冲突 |

> 注意：Windows 上 `process.env` 键不区分大小写，脚本里 `delete process.env.http_proxy`
> 会把 `HTTP_PROXY` 一起删掉——早期两组"代理被忽略"的测试结果是该原因造成的误判。

## 根因

### 根因 1（主因）：proxy_config.json 写入/读取路径不一致

- 写入（旧 `ipc.ts` configure-proxy）：`getOctoConfigPath()` = `$XDG_CONFIG_HOME || ~/.config` + `/octo`
- 读取（`index.ts` useEnvProxy、`server.ts` createSidecarEnv）：硬编码 `join(homedir(), ".config", "octo")`

macOS 用户 shell 里设置了 `XDG_CONFIG_HOME` 时（自己 export，或被 `preferAppEnv` shell 探测
带入主进程），配置写到 A 处、重启后从 B 处读不到 → 主进程与 sidecar 均无代理 env →
webfetch 直连失败。而设置页 `get-proxy-config` 走 `getOctoConfigPath()` 读取，
UI 仍显示"已配置"——与"设置成功但实际失效"症状完全吻合。
未设 XDG 的机器写读一致，一切正常 → 解释"有的 mac 行、有的不行"。

### 根因 2：curl -k 验证与 webfetch 实际链路不同栈

旧验证 `curl -k` 跳过证书校验且用 curl 自己的代理实现。若华为代理对 HTTPS 做证书
替换（MITM），Node fetch 证书校验会失败，而 curl -k 完全掩盖 → 测试通过但 webfetch 失败。
机器是否装有代理根证书决定成败，同样表现为机器相关。

### 根因 3（预期行为但易踩）：配置后必须重启

configure-proxy 只改主进程 env；sidecar 的 env 是 `utilityProcess.fork` 时的快照，
不重启永远拿不到新代理。UI 有"请重启"提示，用户不重启就测 webfetch 必失败。

## 修复内容（dev_dyf）

1. **统一路径**：新增 `packages/desktop/src/main/proxy-config.ts`，`proxyConfigFile()`
   固定返回 `~/.config/octo/proxy_config.json`（明确不跟随 XDG_CONFIG_HOME），
   提供 `readProxyConfig()`/`maskProxyUrl()`。四处统一接入：
   - `ipc.ts` configure-proxy 写入 + get-proxy-config 读取
   - `index.ts` useEnvProxy 读取
   - `server.ts` createSidecarEnv 读取
2. **修正 useEnvProxy 顺序**：先注入 config env 再调 `setGlobalProxyFromEnv()`
   （后者读调用时刻 env，旧顺序首次调用必为 no-op，依赖 setupApp 补调第二次）。
3. **sidecar 兜底**：`sidecar.ts` 新增 `ensureProxyFromConfig()`，启动时自读
   proxy_config.json 补齐缺失的代理变量（只补缺失不覆盖），置于 `ensureLoopbackNoProxy`
   之前。此前提交 `7e1d28c0f` 做过类似事情被还原，当时根因（路径分裂）未修所以无效。
4. **验证改栈**：configure-proxy 弃用 `curl -k`，改为与 webfetch 同栈验证——
   注入 env → `setGlobalProxyFromEnv()` → Node `fetch`（证书正常校验）→ 校验 119.x 出口 IP。
   失败时：保留返回的 restore 函数还原 dispatcher、还原 env，并跑 curl 双探针
   （严格证书 / 跳过证书）输出对照诊断 + MITM 提示，方便远程定位。
5. **诊断日志**（全部脱敏，`maskProxyUrl` 隐藏账号密码）：
   - `index.ts`："octo proxy config loaded"（文件路径 + 生效值）
   - `server.ts`："[server:createSidecarEnv] proxy config injected"
   - `sidecar.ts`："[sidecar:proxy] proxy env ready" / "setGlobalProxyFromEnv OK" /
     "no proxy_config.json"（stdout 转入 main.log 的 sidecar stdout）
   - 设置页失败 toast 改为展示后端返回的完整错误与诊断（原为笼统"配置值不正确"）
6. 类型检查 `bun run typecheck`（desktop + app）通过，`bun run build` 产物已确认包含全部新逻辑。

## 失败机器排查指引

1. 终端 `echo $XDG_CONFIG_HOME`——非空即命中根因 1（本次修复后已不依赖该变量，重新配置一次即可）
2. 看设置页代理配置失败的 toast / main.log `[configure-proxy] 配置失败` 的
   `curl 对照诊断`：
   - 严格证书失败 + 跳过证书成功 → 代理 MITM，需装根证书（根因 2）
   - 两者都失败 → 代理本身不通/账号密码错
   - Node fetch 失败但严格证书 curl 成功 → Node CA 库缺公司根证书
3. 重启后查 main.log：应有 `octo proxy config loaded`、`proxy config injected`、
   `[sidecar:proxy] proxy env ready`、`setGlobalProxyFromEnv OK` 四条链路日志，
   缺哪条即断在哪层。

## 本次分析用的临时脚本（仓库根目录，可删）

`_proxy_test.cjs`、`_proxy_test.mjs`、`_proxy_auth_test.cjs`、`_proxy_variant_test.cjs`、
`_proxy_behavior_test.cjs`、`_proxy_auth2_test.cjs`、`_electron_main_proxy_test.cjs`、
`_electron_restore_test.cjs`——用 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe`
或直接 `electron.exe` 运行，复现上述验证表中的各实验。