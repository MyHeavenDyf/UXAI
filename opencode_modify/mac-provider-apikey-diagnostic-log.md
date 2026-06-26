# Mac 平台预设 Provider API Key 失效问题诊断日志

## 背景

用户反馈在 Mac 平台上，预设 provider（`opencode`、`bpit`、`bpit-beta`）的 API Key 输入后没有效果。具体现象是：输入 API Key 后界面 toast 显示"已连接"，但再次打开设置发现 provider 仍处于"未连接"状态。

代码静态分析阶段见 `provider-system.md` 中的 `hasAuth` 谓词与 custom loader 分析，未能仅凭代码判定 Mac 特有的根因，因此添加运行时日志用于复现定位。

## 修改内容

本次只添加诊断日志，不修改任何业务逻辑。日志分 4 类，分别覆盖前端时序、后端 dispose、Provider 状态重建、env/path 解析。

### 1. 前端时序日志（packages/app）

#### `packages/app/octoapp/components/dialog-connect-provider.tsx`

- `ApiAuthView.handleSubmit`: 打印 `[octo:connect] start` / `updateConfig done` / `auth.set done`，区分 opencode（updateConfig 路径）和其他 provider（auth.set 路径）
- `complete()`: opencode 分支打印 `opencode branch: skip dispose`，非 opencode 分支打印 `calling global.dispose` / `global.dispose done`，确认前端到底走了哪条 dispose 路径

#### `packages/app/octoapp/context/global-sync/event-reducer.ts`

- `applyGlobalEvent`: 接收到 `global.disposed` / `server.connected` 时打印 `[octo:evt] global event → refresh`，确认 SSE 事件是否真的到达前端

#### `packages/app/octoapp/context/global-sync/bootstrap.ts`

- `loadProvidersQuery.queryFn`: 打印 `[octo:query] provider.list start` / `result`，result 包含 `connected` 数组、`all_ids`、`opencode` / `bpit` 完整对象，可直接看到后端返回的 provider 状态

### 2. 后端 dispose 流程日志（packages/opencode）

#### `packages/opencode/src/server/global-lifecycle.ts`

- `disposeAllInstancesAndEmitGlobalDisposed`: 添加 `disposeAll:start` / `emit-disposed` / `done` 三个时间戳日志，用于判断 dispose 是否完成以及完成时机

### 3. Provider 状态重建结果日志（packages/opencode）

#### `packages/opencode/src/provider/provider.ts`

- 在 state factory 末尾（L1508 `delete providers[providerID]` 循环之后，`return` 之前）添加两个日志：
  - `state:provider`: 对每个保留下来的 provider 打印 `{id, source, hasKey, optionsKeys, hasOptionsApiKey, modelsCount}`，直接看到 `hasAuth` 各字段
  - `state:deleted-providers`: 打印被 L1508-1511 过滤掉的 provider id 列表（database 里有但 providers 里没有的），用于确认空 models 过滤是否误删

#### `packages/opencode/src/server/routes/instance/provider.ts`

- Hono 路由 `ProviderRoutes.list` 的 `hasAuth` 谓词旁添加分解日志，对 opencode / bpit / bpit-beta 分别打印 `key` / `source` / `optionsApiKey` / `optionsKeys` / `modelsCount` / `result`，可直接定位 hasAuth 失败原因

#### `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`

- HTTP API `ProviderHttpApi.list` 同样添加 hasAuth 分解日志，覆盖实验性 HTTP API 路径

### 4. env / path 解析日志（packages/desktop + packages/opencode）

#### `packages/desktop/src/main/shell-env.ts`

- `loadShellEnv`: -il 模式成功时打印 `[server:shell-env] -il vars`，包含 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `OPENCODE_API_KEY_set` / `BPIT_API_KEY_set` / `BPIT_BETA_API_KEY_set`
- -il 超时时打印警告，提示 sidecar 将走 fallback env，可能导致 Mac 上 path 解析分歧
- -l 模式同样打印关键变量
- 全部失败时打印警告

#### `packages/desktop/src/main/server.ts`

- `preferAppEnv`: 合并完成后打印最终生效的 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `userDataPath`，用于判断 sidecar 进程读写路径是否与主进程一致

#### `packages/opencode/src/config/config.ts`

- `Config.updateGlobal`: 打印 `[config.updateGlobal]`，包含 `file` 路径、`patch_provider_keys`、`patch_opencode_options` / `patch_bpit_options` 的 keys、`patch_disabled_providers`，可对照 Provider.list 读取的路径是否一致

#### `packages/opencode/src/auth/index.ts`

- `Auth.all`: 读取文件后打印 `[auth.all] from file`，记录 `file` 路径和 `raw_keys`；如果走 `OPENCODE_AUTH_CONTENT` 环境变量分支也打印
- `Auth.set`: 写入前打印 `[auth.set] writing`，记录 `file` / `key` / `type`

## 日志读取顺序

复现一次连接操作后，按时间戳读：

1. `[octo:connect] start` → `updateConfig done` (前端)
2. `[config.updateGlobal]` → 看 file 路径和 patch（后端写入）
3. `disposeAll:start` → `done` → `emit-disposed`（后端 dispose 链路）
4. `[octo:evt] global event → refresh` (前端，确认 SSE 事件到达)
5. `[octo:query] provider.list start` → `result`（前端，看 connected 数组里有没有 opencode/bpit）
6. `[provider.list] hasAuth breakdown` / `[HttpApi.provider.list] hasAuth breakdown`（后端 hasAuth 判定）
7. `state:provider` / `state:deleted-providers`（后端重建后的最终 providers 结构）
8. `[server:shell-env]` / `[server:preferAppEnv] final env`（Mac 启动时一次性输出）
9. `[auth.set] writing` / `[auth.all] from file`（bpit 路径才有）

## 关键观察点

| 现象 | 可能根因 |
| --- | --- |
| step 6 的 hasAuth 输出 `optionsApiKey: false` 但 `key: false` | 配置写入丢失或被覆盖，看 step 2 的 patch 是否包含 apiKey |
| step 7 的 `modelsCount: 0` 且 id 出现在 `state:deleted-providers` | L1508-1511 把它删了，需要检查 models-snapshot 加载是否成功 |
| step 3 的 dispose 完成时间 > step 5 的 provider 查询时间 | race condition，dispose 还没完前端就查询了 |
| step 8 里 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` 与 `userDataPath` 不一致 | 路径分裂，配置写到 A、读取从 B |
| step 8 里 `-il timed out` 警告 | Mac 上 zsh 启动脚本太慢导致 shell env 加载失败 |
| step 9 的 `auth.all from file` 与 `auth.set writing` 路径不一致 | auth.json 读写路径分裂 |

## 影响评估

- 全部为 console.log / log.info，无业务逻辑改动
- 日志量可控：opencode/bpit/bpit-beta 的 hasAuth 分解只在 list 请求时触发；state:provider 只在状态重建时触发；shell-env / preferAppEnv 只在启动时触发一次
- 复现定位完成后应整体回退（保留 git history 即可）

## 涉及文件

- `packages/app/octoapp/components/dialog-connect-provider.tsx`
- `packages/app/octoapp/context/global-sync/event-reducer.ts`
- `packages/app/octoapp/context/global-sync/bootstrap.ts`
- `packages/opencode/src/server/global-lifecycle.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/server/routes/instance/provider.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`
- `packages/desktop/src/main/shell-env.ts`
- `packages/desktop/src/main/server.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/auth/index.ts`
