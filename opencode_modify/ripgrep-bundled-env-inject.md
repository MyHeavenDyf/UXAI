# ripgrep 捆绑二进制 env 注入：绕过 ~/.cache 权限故障

## 背景

内网 Mac 用户执行 skill 命令（如 `/ICT领域PC端设计规范`）失败，前端控制台报：

```
[MakePage] command /ICT领域PC端设计规范 failed
{"name":"UnknownError","data":{"message":"PlatformError: PermissionDenied:
FileSystem.writeFile (/Users/xxx/.cache/opencode/bin/ripgrep-15.1.0-aarch64-apple-darwin.tar.gz)...
```

### 根因链

1. skill 发现与模板加载依赖 `Ripgrep.Service`（skill/index.ts），触发 rg 二进制解析。
2. `ripgrep.ts` 的 `filepath` 三级解析：系统 PATH `which(rg)` → `Global.Path.bin`（`~/.cache/opencode/bin/rg`）→ GitHub 下载兜底。
3. 该用户机器上 `~/.cache/opencode/bin` 目录存在但当前用户不可写（典型成因：曾用 `sudo` 跑过 opencode CLI，留下 root 属主的 `~/.cache/opencode*`；`ensureDir` 对已存在目录只 stat 不报错，`writeFile`/`copyFile` 才被 EACCES 拒绝）。
4. 两条安装路径全部撞墙：
   - 桌面端预装 `deployRipgrep`（desktop/src/main/migrate.ts）`copyFileSync` EACCES → 仅 `log.warn`，静默失败；
   - 服务端 GitHub 下载兜底 `fs.writeWithDirs(archive)` EACCES → 命令失败，即用户看到的报错。
5. 前端 `executeSessionCommand` 对非 compact 命令失败只 `console.error`，用户无 toast，只能翻控制台。

已排除：非 App Sandbox（entitlements.plist 无 sandbox key）；非路径错位（desktop 与 core 均用 xdg-basedir 5.1.0，macOS 一致解析为 `~/.cache`，该版本无 `~/Library/Caches` 映射）。

## 改动文件

| 文件 | 改动内容 |
|------|----------|
| `packages/desktop/src/main/migrate.ts` | 抽出 `bundledRipgrepPath()`：计算安装包内捆绑 rg 的绝对路径（打包态 `process.resourcesPath/bin/rg-<platform>-<arch>`，开发态 `resources/bin/...`），不存在返回 null。`deployRipgrep` 改为复用该 helper |
| `packages/desktop/src/main/server.ts` | `createSidecarEnv()` 注入 `OPENCODE_RIPGREP_PATH=<捆绑 rg 绝对路径>`。sidecar 为 `utilityProcess.fork`，服务端在 sidecar 进程内运行（sidecar.ts `import("virtual:opencode-server")`），env 直读可见；`prepareSidecarEnv` 只增不删，不会剥掉该变量 |
| `packages/opencode/src/file/ripgrep.ts` | `filepath` 解析增加最高优先级：读 `OPENCODE_RIPGREP_PATH`，`fs.isFile` 校验通过即直接返回，跳过 which/缓存/下载三级解析 |

## opencode 侧逻辑（ripgrep.ts）

```ts
const bundled = process.env.OPENCODE_RIPGREP_PATH
if (bundled && (yield* fs.isFile(bundled).pipe(Effect.orDie))) return bundled
```

- 优先级高于系统 `which(rg)`：桌面端行为确定，不依赖用户 shell 环境。
- 仅在变量存在且文件校验通过时生效；非桌面场景（独立 CLI、外部 server）不设该变量，行为与上游完全一致。
- `Effect.cached` 语义不变，首次成功解析后进程内缓存。

## 后续修复：捆绑二进制可执行位（2026-09-23 复查发现）

复查时发现阻塞性缺陷：仓库中 4 个 unix 二进制的 git mode 为 `100644`（初始提交 `719bc0f5f5` 加入时即无执行位）。

- 旧 `deployRipgrep` 链路无感：拷贝到 `~/.cache` 后有 `chmodSync(0o755)` 补位。
- 新 env 直连链路有坑：服务端直接 spawn `process.resourcesPath/bin/rg-darwin-*`，无任何 chmod 步骤；electron-builder 的 extraResources 拷贝保留源文件 mode，也不自动加执行位。macOS/Linux 上 spawn 644 文件 → EACCES，复现同类故障。
- 不能在运行时对 resourcesPath 内文件 chmod：打包态位于 .app bundle 内，改动会破坏 codesign 封装；DMG translocation 场景该目录只读。

**修复**：`git update-index --chmod=+x` 标记 4 个 unix 二进制（darwin-arm64/x64、linux-arm64/x64）为 `100755`。macOS/Linux 构建机检出/拉取后文件即为可执行，electron-builder 原样打包。Windows `.exe` 不需要执行位，保持 644。

验证方式：`git ls-files -s packages/desktop/resources/bin/` 应显示 4 个 unix 二进制为 `100755`。

## 验证结论（链路核对）

- 打包配置：electron-builder.config.ts `extraResources` 将 `resources/bin → bin`，打包态 `process.resourcesPath/bin/rg-<platform>-<arch>` 存在；开发态 `out/main → ../../resources/bin` 解析正确（与原 deployRipgrep 逻辑一致）。
- env 传递：`spawnLocalServer` → `utilityProcess.fork(sidecar, { env: createSidecarEnv() })` → sidecar 进程内 `prepareSidecarEnv` 仅 Object.assign 增量合并，不会剥掉 `OPENCODE_RIPGREP_PATH`；服务端与 ripgrep 解析同在 sidecar 进程，`process.env` 直读可见。
- 远程 server 模式（连接外部 server）不走 sidecar，无该变量，行为与上游一致。

## 技能调用失败与 ~/.cache 权限问题的关系分析

**结论：有直接因果关系，权限问题是技能调用失败的根因。** 链路区分两段：

1. **技能发现（SKILL.md 扫描、命令列表展示）不依赖 ripgrep**：`skill/index.ts` 的 `scan()` 用纯 JS `glob` 包（`@opencode-ai/core/util/glob`）。所以技能仍能出现在命令列表里——这也解释了"看得到、调不动"的现象。
2. **技能调用依赖 ripgrep**：
   - 命令式（`/ICT领域PC端设计规范`）：`command/index.ts` 的 `template` getter 调 `skill.files(item)`；
   - 工具式（agent 内置 skill）：`tool/skill.ts` 同样调 `skill.files(info)`；
   - `skill.files()` → `rg.files()`（skill 目录文件注入）→ `Ripgrep` 的 `filepath` 解析。
3. `filepath` 三级解析在该用户机器上全部失败：系统 PATH 无 rg → `~/.cache/opencode/bin/rg` 缺失（desktop 预装 `deployRipgrep` copyFileSync EACCES，仅 log.warn 静默失败）→ GitHub 兜底下载 `fs.writeWithDirs(archive)` 写 `~/.cache/opencode/bin/ripgrep-*.tar.gz` EACCES，即用户控制台看到的 `PermissionDenied: FileSystem.writeFile` 报错点。

因此"权限问题 → rg 无法解析 → skill.files 失败 → 技能命令执行失败"是同一条因果链；此外 agent 的 Grep/Glob 工具同样走 `Ripgrep`，权限故障期间也一并不可用。env 注入后解析不再触碰 `~/.cache`，该链路被切断。

## 遗留说明

- `deployRipgrep` 预装失败仍静默（log.warn）——env 注入后预装仅为 `~/.cache` 路径的兼容手段，非可用性依赖。
- 前端命令失败无 toast 的问题（用户只能在控制台看到报错）本轮不修改前端，保持现状。
- 用户机器权限修复命令（供支持同学参考）：`sudo chown -R $(whoami) ~/.cache/opencode`。
