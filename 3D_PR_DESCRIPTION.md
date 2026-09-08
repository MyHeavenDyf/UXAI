# PR：3D 场景 AI 生成（direct codegen + 预览/打包全链路）

## 一、这个分支做了什么

引入 Three.js 3D 场景的 AI 生成能力：用户用自然语言描述场景（「生成一个机房」），LLM 直接输出 Three.js 组件 handler 代码 + 场景配置，物化到独立 vite workspace 预览渲染。支持 create / modify / patch（edit_code 精准改行）/ 编辑态拖拽改色 / 切历史版本 / 导出工程 zip / 打进 exe 分发。

核心是 **direct codegen** 流：triage（路由分流）→ 单次 codegen（LLM 一次性写全部 type 的 handler + group + scene-config.json）→ host 确定性合并 index/live-data → 门控验证。单次直出 30-60s，替代旧的 plan + 并行 per-type + 全量 + 自愈循环（32-50min）。

---

## 二、为什么改了 `packages/desktop/`（6 文件，+608/-13）

3D 预览/打包**绕不开 main 进程**——Electron renderer（nodeIntegration:false）没有文件系统 / spawn 权限，3D 要做的事全在 main 进程做，经 IPC 暴露给 renderer。**无法移到 `app/pages/3d/` 目录**。

| 文件 | 改动 | 为什么必须改 |
|---|---|---|
| `src/main/ipc.ts` | +7 个 IPC handler：get-3d-src-dirs / materializeWorkspace / overlayWorkspaceFiles / startWorkspaceDev / stopWorkspaceDev / deletePathRecursive / export-project-zip；+ 端口探测辅助（probePort / waitForPortFree / killPortOccupant） | 3D 预览靠独立 vite dev server 跑在 workspace 副本目录，renderer 无法 spawn / 读写文件系统，**必须经 main 进程 IPC**。端口探测是修 startDev 假 ready 崩溃（残留 vite 占端口推 stale bundle）。这是 3D 预览能跑起来的底层前提。 |
| `src/preload/types.ts` | +`ElectronAPI` 的 3D 接口类型声明 | ipc.ts handler 必须有 preload 类型声明，否则 renderer 调 `window.api.xxx` 无类型 / tsgo 报错。Electron IPC 三件套缺一不可。 |
| `src/preload/index.ts` | +`contextBridge.exposeInWorld` 暴露 3D 接口 | ipc.ts handler 不经 contextBridge 暴露，renderer `window.api` 拿不到方法。 |
| `electron-builder.config.ts` | +3D 资源 extraResources（template / template-node-modules / 3d-components / bin staging 进 `.3d-dist`）；+ mac/win 签名 CI/本地分叉 | 3D 打进 exe 的核心配置——不打资源进包，exe 里 3D 全链路白屏。签名分叉是修**本地打不出包**（mac notarize 无凭据硬错误 + win rcedit 在无开发者模式下载炸），3D 顺带修了，2D 也受益。 |
| `scripts/copy-3d-resources.ts`（新） | 3D 资源 staging 脚本（拷 3d-templete / 3d-components / bun.exe 进 `.3d-dist`） | electron-builder.config.ts 的 extraResources 指向 `.3d-dist`，本脚本负责生成它，prebuild 自动跑。 |
| `scripts/prebuild.ts` | +1 行调 `copy-3d-resources.ts` | 让 staging 在 prebuild 自动跑，否则 `.3d-dist` 不会生成。 |
| `package.json` | +`@a3d/a3d-components` file: 依赖 | copy-3d-resources / 导出工程 vendor 需要 @a3d 包，desktop 得有依赖才能解析。 |
| `.gitignore` | +`.3d-dist/` | staging 产物（数百 MB）不入库。 |

**结论**：全是 3D 预览/打包的硬性前提（Electron 架构 + 打包配置只能在 desktop 包），无一可移到 3d 目录。

**已回退删除**：曾加 `src/main/check-handler-types.ts` + IPC handler `check-handler-types` + preload 暴露做物化前 tsc 类型检查（P7-1），实测 61 个 TS2307 假阳性（内存 CodeFile[] 缺工程上下文，相对路径 import 解析不到）把好代码拦下来，已全删回退到 `checkHandlerSyntax`（transpileModule 自包含零假阳性）+ 门控渲染时抓运行时错。

---

## 三、为什么改了 `packages/opencode/`（12 文件，+1113/-23）

3D 的 triage / codegen 是 opencode agent，**必须在 agent.ts 注册 + prompt 经 proto/index.ts 聚合**——这是 opencode 的架构，注册表/聚合入口只有这两处。**无法移到 `app/pages/3d/` 目录**。

| 文件 | 改动 | 为什么必须改 |
|---|---|---|
| `src/agent/agent.ts` | +2 个 agent 注册（scene_3d_triage / scene_3d_codegen_direct）+ import 对应 prompt | opencode 唯一的 agent 注册表，3D agent 不注册就无法调度。其余是 prettier 格式化（空格/括号），非逻辑。 |
| `src/agent/proto/index.ts` | +import 3D prompt + 静态契约片段（HANDLER_CONTRACT / COMPONENT_CATALOG）+ 注册到 `_staticData` / `RAW_TEMPLATES` | prompt 文件得经 proto/index.ts 导出，agent.ts 才能引用。 |
| `prompt/scene_3d/*.txt`（4 文件：triage / codegen_direct / HANDLER_CONTRACT / COMPONENT_CATALOG） | 3D agent 的 prompt 本体 + 静态契约片段 | agent 的系统提示词和组件契约，agent 的核心。 |
| `src/tool/proto_tool/3d_components_docs.ts`（新，已清理） | 纯数据加载 + `formatCatalog` 函数（读 @a3d docs JSON → 拼精简目录 .txt） | 供烘焙脚本 `gen-component-catalog.ts` 调用产 `COMPONENT_CATALOG.txt`。**已清理死代码**：原含 `list_3d_components` / `get_3d_component_doc` 两个运行时 tool，direct 落地后改用预烘 catalog 注入 prompt，这俩 tool 成死代码（prompt 无指令 + agent permission 全 deny + app 零引用），已删 tool 定义 + Schema，只留 `formatCatalog`。 |
| `script/gen-component-catalog.ts`（新） | 从 @a3d docs 烘焙 `COMPONENT_CATALOG.txt` | 预烘 catalog 避运行时循环依赖 TDZ + 省 LLM 往返。 |
| `src/provider/provider.ts` | ① LOCAL_PROVIDER_TIMEOUT_MS 5min→10min ② chunkTimeout 默认 180s 注入（原死代码） | **修长生成误杀**：3D codegen 单次 30-60s、输出 13 个 handler，5min 墙钟误杀（GLM-V5 实测 300s 仍在吐字被掐）。chunkTimeout 注入修 SSE 静默断流假死。**通用修复，2D 长生成同样受益**，非 3D 专属。 |
| `src/provider/transform.ts` | OUTPUT_TOKEN_MAX 32K→64K | 3D codegen 单次直出超 32K 被截断。**通用修复**，2D 大输出也受益。 |
| `package.json` | +`gen:component-catalog` script + `@a3d/a3d-components` 依赖 | 烘焙脚本入口 + 依赖解析。 |

**结论**：12 文件里 10 个是 3D agent 接入的硬性前提（agent 注册表 / prompt 聚合 / 烘焙脚本），2 个是通用 provider 长生成修复（2D 也受益）。`3d_components_docs.ts` 的死代码 tool 已清理干净（298 行→123 行，`registry.ts` 6 处引用全删）。

---

## 四、committer 可能关心的问题

**Q: 为什么不改在 `app/pages/3d/` 里就够了？**
A: 改不了。3D 预览需要 main 进程权限（spawn vite / 读写文件系统 / 端口探测）——Electron renderer 没这些权限；3D codegen 需要 opencode agent 注册——agent.ts 是唯一注册表。这两处是架构瓶颈点，3D 特性必须穿过它们。

**Q: 签名分叉（mac/win）和 3D 无关，为什么夹在这分支？**
A: 3D 打包验证（打进 exe 验全链路）时发现本地打不出包——mac notarize 无凭据硬错误、win rcedit 在无开发者模式 Windows 下载炸。这是本地打包链的既有坑，3D 顺带修了让本地能打 exe 验证。CI 路径（GH Actions）不受影响，照常真签名。

**Q: `3d_components_docs.ts` 的 tool 删了，文件为什么还留？**
A: `formatCatalog` 函数还活着——被 `gen-component-catalog.ts` 烘焙脚本调用产 `COMPONENT_CATALOG.txt`。删了 tool 定义 + Schema + 辅助函数（scanDocIndex / findDoc / filterIndex / formatDoc），只留纯数据加载 + formatCatalog（123 行）。

---

## 五、验证状态

- tsgo（app + desktop + opencode 三包）0 error
- oxlint 0 error
- bun test 12 pass（app parse-check：syntax + formatSyntax）
- e2e 待跑（生成场景 → 渲染时报错能看到 → 失败卡片「修复」按钮 → triage edit_code → 验证通过）
