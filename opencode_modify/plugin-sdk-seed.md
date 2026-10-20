# Plugin SDK Seed 预打包 + waitForDependencies 超时兜底

> 日期：2026-10-10
> 分支：dev_dyf
> 状态：已完成，测试与 typecheck 通过（config.test.ts 原有 7 个失败与本次无关，stash 验证过）

## 一、问题诊断

内网用户打开桌面应用耗时 ~5 分钟（2026-10-10 用户日志实锤）：

1. opencode server 启动时对**每个配置目录**（`~/.config/octo`、`~/.config/opencode`、项目 `.opencode/.octo`、`~/.octo`）后台 npm install `@opencode-ai/plugin`（`src/config/config.ts` 的 directories 循环内 fork）
2. `plugin.init()` 阻塞在 `waitForDependencies()`（调用点 `plugin/index.ts:181`、`tool/registry.ts:188`）
3. registry.npmjs.org 不可达时，@npmcli/arborist 重试退避 ~5 分钟才失败（用户日志：3 次 connect timeout，+78s/+88s/+138s，最后 `NpmInstallFailedError`）
4. 期间 instance bootstrap（`project/bootstrap.ts`）卡死 → UI 长时间无响应
5. 且安装从未成功 → node_modules 永远缺失 → **每次启动重复 5 分钟**

### 根因链路（上游代码考古）

该机制全部来自上游 opencode（sst 团队），fork 从未修改过：

- `ca031278ca`（2025-08-02，"wip: plugins"）：引入 plugin 系统 + `@opencode-ai/plugin` SDK 包
- `096710a8cc`（2025-10-09）：config 加载时 fire-and-forget `bun add`
- `556adad67b`（2026-02-04，#12227）：`waitForDependencies` 改为阻塞 plugin 初始化
- `c9326fc199`（2026-04-01，#18308）：`bun add` → arborist reify（npm 退避卡死的直接来源）

## 二、方案

双管齐下：

1. **Seed 预打包**（治本）：构建时用 Bun.build 把 `@opencode-ai/plugin` 打成 3 个自包含 ESM 文件（index/tool/tui，effect/zod 全部内联，~2.3MB），随桌面应用打包；运行时通过 env `OPENCODE_PLUGIN_SDK_DIR` 指向安装目录内 seed，配置目录安装 SDK 时直接本地拷贝，完全不走网络
2. **waitForDependencies 超时**（治标兜底）：30s 超时放行（detached 安装 fiber 不受影响，继续后台跑，结果落盘由下次启动收敛）

## 三、改动清单

### packages/opencode

| 文件 | 改动 |
| --- | --- |
| `src/config/plugin-sdk-seed.ts` | **新增**。`install(deps, dir, input)` 拦截 SDK 安装：env 未设 / seed 损坏 → 原样回退 npm；目录不可写 → 静默返回（对齐 `Npm.install` canWrite 语义）；marker 版本一致 → 幂等跳过；拷贝在 `flock` 锁 `npm-install:${dir}` 内执行（与 arborist reify 互斥，**回退 npm 必须在锁外**，flock 无重入会死锁） |
| `src/config/config.ts` | directories 循环内 `npmSvc.install` → `PluginSdkSeed.install({npm, fs, flock}, ...)`（外层 `Effect.exit + tap warn + forkDetach` 原样保留）；Config layer 增加 `yield* EffectFlock.Service`；`waitForDependencies` 加 `Effect.timeout` + `catchTag("TimeoutError")` |
| `src/cli/cmd/tui/config/tui.ts` | TUI 版 `waitForDependencies` 同样加超时（`Effect.ignore` 前置，不 import config.ts，TUI 配置栈自成一体） |
| `test/config/plugin-sdk-seed.test.ts` | **新增**，12 用例（见下） |

### packages/desktop

| 文件 | 改动 |
| --- | --- |
| `scripts/prepare-plugin-sdk.ts` | **新增**。Bun.build 3 入口 → `resources/plugin-sdk/`（plugin/dist + 改写 exports 的 plugin/package.json + 根 package.json + lockfileVersion 3 的 lock + seed-manifest.json），临时目录构建后原子 rename |
| `scripts/predev.ts` / `prebuild.ts` | 末尾追加运行 prepare-plugin-sdk.ts |
| `.gitignore` | 追加 `resources/plugin-sdk`、`resources/.plugin-sdk-staging`（构建产物不提交） |
| `electron-builder.config.ts` | extraResources 加 `{from: "resources/plugin-sdk", to: "plugin-sdk"}`；`files` 加 `!resources/plugin-sdk/**`（防 asar 双份，rg 二进制老问题） |
| `src/main/migrate.ts` | 新增 `bundledPluginSdkPath()`（双路径模式同 `bundledRipgrepPath()`） |
| `src/main/server.ts` | `createSidecarEnv()` 注入 `OPENCODE_PLUGIN_SDK_DIR`（与 `OPENCODE_RIPGREP_PATH` 同通道） |

## 四、核心决策

### 4.1 接管条件（防毁用户数据）

seed 只在以下情况接管目录，否则一律回退 npm：

- **无 marker + package.json 不存在或无任何依赖字段**（isUnclaimed）→ 接管（覆盖"node_modules 被删、目录空置"场景）
- **marker 版本一致** → 幂等跳过（无拷贝）
- **marker 版本不匹配 + 根 package.json 仍是 seed 产物**（name 为 `octo-plugin-sdk-seed`、dependencies 只含 SDK、无 dev/peer/optional 依赖）→ force 覆盖更新（应用升级）
- **marker 版本不匹配 + 用户改过 package.json** → 回退 npm，绝不覆盖
- **npm 安装过的目录**（有依赖、无 marker）→ 回退 npm（其 checkDirty 离线短路，无额外开销）

### 4.2 拷贝细节

- `rmSync` 只清 `node_modules/@opencode-ai` scope，不动用户其它包
- 接管已有 package.json 时保留用户附加字段（如 `type: "module"`）
- lock 的 `packages[""].dependencies` 键集合满足 `Npm.install` checkDirty 短路（`packages/core/src/npm.ts`），后续真实 install 不触发 reify 联网
- marker 写在 `node_modules/.plugin-sdk-seed.json`（含 pluginVersion）

### 4.3 测试覆盖（12 用例）

env 未设回退 npm / manifest 非法回退 / 非 SDK 输入透传 / 空目录整树拷贝（exports、lock、marker 断言）/ 接管无主 package.json 保留字段 / marker 一致幂等（产物文件不被覆盖）/ 版本升级覆盖 / 用户改过回退 / 无 node_modules 的用户目录不接管 / 不可写静默返回（win32 skip）/ 集成：seed 后真实 `Npm.install` 走 checkDirty 短路（`mock.module` 把 Arborist 构造函数换成抛错，reify 一旦发生即 fail）/ waitForDependencies 超时放行（挂起 install 的 Config 实例 ~50ms 返回）

## 五、Effect v4 (4.0.0-beta.59) 踩坑记录

types 声明有但 **runtime dist 没有**（tsgo 通过、运行时 undefined，.pipe 报 `args[0] is not a function`）：

- `Either` 命名空间 → 用 `_tag === "Left"` 判断
- `Effect.either` → 用 `Effect.exit` + `Exit.isFailure`
- `Effect.async` → 用 `Effect.callback`（register 立即执行，不 resume 即挂起）
- `Duration.fromInput` 返回 `Option`，入参是模板字面量类型，env 字符串需 `as Duration.Input`

另外：`JSON.parse` 异常在 Effect.gen 里是 **defect**，`orElseSucceed` 接不住，需 `Effect.catchDefect`（`readJsonSafe` 因此三连 catch）。

## 六、已知限制 / 范围外

1. **OPENCODE_VERSION define bug**（建议单独修）：`packages/core/src/installation/version.ts` 读 `OPENCODE_VERSION`，但 `packages/opencode/script/build-node.ts` define 的是 `OCTO_VERSION` → 打包版 `InstallationVersion === "local"` → 走 npm 时装的是 registry latest（1.16.2）而非匹配版本 1.14.41。seed 从 workspace 构建天然版本一致，绕开此问题，但纯 CLI 场景仍受影响
2. `npm:` spec 形式的插件声明走 `Npm.add` → 全局 cache reify 联网，不经 waitForDependencies，seed 与超时均不覆盖（桌面端插件均为路径型自动发现，不受影响）
3. seed 不含 .d.ts（类型链会拉入 sdk→effect→zod 全套）；用户插件编辑器暂无类型提示，后续可补精简手写 index.d.ts
4. TUI 场景只加了超时兜底，没接 seed（`OPENCODE_PLUGIN_SDK_DIR` 仅桌面 sidecar 注入）
5. waitForDependencies 超时可用 `OPENCODE_DEPENDENCY_WAIT_TIMEOUT` 覆盖（如 `"50 millis"`），非法值回落 30s

## 七、验证结果

- `bun run typecheck`（根，12 包）通过
- `packages/opencode`：plugin-sdk-seed.test.ts 12/12 通过；config.test.ts 74 pass / 7 fail（stash 前后一致，均为既有失败：jsonc/well-known/MCP merge 等）
- `packages/core`：108/108 通过
- seed 构建 + 纯 Node 加载验证：`node import` 成功，exports 与 registry 包一致
- 真实 seed 冒烟（Windows）：本地拷贝落位（marker/exports/lock）、`import` 链路可用、二次运行幂等、npm 兜底零调用

## 八、macOS 兼容性审计（2026-10-10，静态审查）

Windows 上开发，macOS 侧做了逐项静态审计，结论：**新代码零平台分支，全链路平台无关**。

### 8.1 代码层

- `prepare-plugin-sdk.ts`：全部 `import.meta.url` + `path.join`/`path.resolve` 定位（macOS 上 `fileURLToPath` 产出 `/Users/...`，trailing slash 由 path API 归一）；staging→outDir 同卷 rename 在 APFS 同样原子；Bun.build `target:"node"` 产物是纯 JS，arch 无关（mac x64/arm64 共用同一 seed 内容，仅 sourcemap 内路径差异，不影响功能）
- `plugin-sdk-seed.ts`：只用 node:fs 同步 API（rmSync/mkdirSync/cpSync/writeFileSync），无 shell 调用、无路径字面量
- `migrate.ts` `bundledPluginSdkPath()` / `server.ts` env 注入：无平台分支（对比 rg 需要平台命名 + 非 win32 chmod——seed 是被 import 的 JS 而非可执行文件，不需要 chmod）
- 路径含空格/中文（`Octo Agent.app/Contents/Resources/plugin-sdk`）：全程 node fs API，不经 shell，无风险

### 8.2 macOS 专项确认

- **entitlements**（`resources/entitlements.plist`）：仅 JIT/library-validation 类，无 App Sandbox、无文件读写限制——读 Resources + 写 `~/.config` 不受影响
- **notarization + hardened runtime**：seed 是数据文件，运行时只读取和拷贝、从不执行，无 Gatekeeper/quarantine/签名校验问题
- **App Translocation**（Gatekeeper 首启）：`process.resourcesPath` 指向 translocated 副本，仍可读
- **shell env 探测**（macOS 特有 `preferAppEnv` → zsh 探测）：`createSidecarEnv()` 在合并之后**无条件覆写** `OPENCODE_PLUGIN_SDK_DIR`（无 `if (!env.x)` 守卫，区别于 OCTO_KB_BASE_URL），用户 shell profile 无法干扰
- **大小写不敏感 APFS**：`node_modules/@opencode-ai/plugin` 全链路大小写一致
- **flock**：mkdir 跨进程锁本身平台无关（npm 路径在 mac 已在用）；2.3MB cpSync 远小于 STALE_MS 心跳阈值

### 8.3 构建/CI 链路（mac）

- 本地 dev：`bun run dev` → `predev`（实测 bun 会执行 pre/post 脚本）→ `prepare-plugin-sdk.ts` ✓
- CI（`.github/workflows/publish.yml`）：`macos-26`（arm64）+ `macos-26-intel`（x64）两个 job，`bun ./scripts/prepare.ts`（内部 `import "./prebuild"`）→ `bun run build` → `electron-builder --mac`；extraResources 在 base config，mac dmg/zip 目标自动继承，`!resources/plugin-sdk/**` 的 asar 排除同在 base ✓

### 8.4 测试可移植性

- 测试文件全部 `path.join`，无硬编码分隔符/绝对路径；断言值均由 path API 推导
- 不可写目录用例仅 POSIX（win32 skip），语义与既有 `config.test.ts:961`（read-only OPENCODE_CONFIG_DIR）完全一致，后者已在 Linux CI 长期跑通
- **残留缺口**：`.github/workflows/test.yml` unit 矩阵只有 linux + windows，无 macOS——若需要 mac 自动化验证，需在矩阵加 macos runner（成本较高，未擅自加）；建议在真机 mac 上跑一次 `bun run dev` 验证 `~/.config/octo/node_modules/@opencode-ai/plugin/` 落位 + marker + 重启幂等秒开
