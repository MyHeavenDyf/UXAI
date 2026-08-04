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