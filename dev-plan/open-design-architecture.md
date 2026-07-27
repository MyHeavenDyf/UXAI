# Open Design 架构分析

> 来源仓库：`D:/octoAI/open-design/`
> 分析日期：2026-05-25
> 版本：v0.8.0

---

## 一、项目定位

**本地优先的设计工作台** — 将自然语言需求转为可编辑、可预览的设计产物（原型、PPT、模板、设计系统）。核心定位是**集成壳层**，不拥有 agent、模型或技能目录，全部外部可插拔。

**与竞品差异：**
- vs Anthropic Claude Design：可自托管、BYO-agent、技能/设计系统作为可版本化文件
- vs Open CoDesign：Web-first（非 Electron），委托 agent 循环给已有 CLI，使用文件式 `SKILL.md` 技能

---

## 二、技术栈

| 层 | 技术 |
|---|---|
| Web 端 | Next.js 16 (App Router) + React 18 + Tailwind CSS 4 |
| Daemon | Express.js + SQLite (better-sqlite3) + Node.js 24 |
| 桌面端 | Electron 41 |
| 包管理 | pnpm 10.33.2 monorepo |
| 构建 | TypeScript 5.9, esbuild |
| 测试 | Vitest, Playwright E2E |
| 流式传输 | Server-Sent Events (SSE) |
| 部署 | Docker, Kubernetes (Helm), Vercel |

---

## 三、Monorepo 结构

### 3.1 Apps

| App | 说明 |
|-----|------|
| `daemon` | 本地守护进程 + `od` CLI。核心 API 服务、agent 调度、技能/设计系统/产物管理。Express + SQLite。272 个 TS 文件。 |
| `web` | Next.js 16 Web 界面。聊天 UI、产物树、iframe 预览、评论模式、导出。283 个文件。 |
| `desktop` | Electron 壳层，提供 `window.__od__` 宿主桥接。 |
| `packaged` | 打包版 Electron 入口，sidecar 启动，`od://` 协议胶水。 |
| `landing-page` | 营销落地页。 |
| `telemetry-worker` | 遥测收集服务。 |

### 3.2 Packages

| 包 | 说明 |
|----|------|
| `contracts` | 前后端共享契约层。API DTOs、SSE 事件、错误类型、任务形状、插件 manifest schema、prompt 组合逻辑。依赖 zod。 |
| `host` | Web/桌面宿主桥接协议。定义 `window.__od__` 全局桥接类型。零依赖。 |
| `sidecar-proto` | Sidecar IPC 消息 schema。AppKey、消息类型、Stamp 身份。零依赖。 |
| `sidecar` | Sidecar 运行时。Unix socket/Windows named pipe IPC、端口分配、原子文件写入、引导。 |
| `platform` | OS 进程原语。进程 stamp、跨平台命令构建、后台进程管理、工具链发现。 |
| `plugin-runtime` | 插件运行时。manifest 解析（Zod）、SKILL.md 适配、深度合并、SHA-256 摘要、上下文解析。 |
| `registry-protocol` | 插件注册中心协议。Backend 接口（github/http/local/db）、信任级别、搜索。 |
| `agui-adapter` | AG-UI 事件协议适配器。将 OD 内部事件映射为 CopilotKit 兼容格式。 |
| `diagnostics` | 诊断导出。日志收集、密钥脱敏、系统信息、ZIP 归档。 |
| `download` | 下载管理。断点续传、校验和、文件锁、去重、并发控制。 |

### 3.3 Tools

| 工具 | 说明 |
|------|------|
| `dev` | 本地开发控制面板。启动/停止 daemon、web、desktop。 |
| `pack` | 打包构建控制面板。更新器线束、安装器验证。 |
| `pr` | 维护者 PR 控制面板。review-lane 派生、检查清单。 |
| `serve` | 本地 fixture 服务。更新器元数据/产物。 |

---

## 四、Daemon 详细架构

### 4.1 数据库 Schema

SQLite + WAL journaling + 外键。核心表：

| 表 | 用途 |
|---|---|
| `projects` | 项目元数据（id, name, skill_id, design_system_id, metadata_json, custom_instructions） |
| `templates` | 用户保存的项目快照（id, name, source_project_id, files_json） |
| `conversations` | 聊天会话（id, project_id, title） |
| `messages` | 聊天消息（id, conversation_id, role, content, agent_id, events_json, produced_files_json, feedback_json） |
| `preview_comments` | 预览标注（element_id, selector, position_json, html_hint, status） |
| `tabs` | 项目文件 tab 状态 |
| `deployments` | 部署记录（provider_id, url, deployment_id, status） |
| `routines` | 定时自动化（schedule_kind, schedule_value, prompt, enabled） |
| `routine_runs` | 自动化执行历史（trigger, status, summary, error） |
| `installed_plugins` | 已安装插件 |
| `plugin_marketplaces` | 插件市场 |
| `applied_plugin_snapshots` | 冻结的插件快照（per run） |
| `genui_surfaces` | GenUI 动态界面持久化 |

### 4.2 子系统

| 子系统 | 文件数 | 职责 |
|---|---|---|
| `plugins/` | 47 | 插件安装/卸载/快照/Pipeline 执行/Atom 调度/市场管理 |
| `critique/` | 21 | 设计评审 Theater（多评委打分、轮次管理、SSE 事件广播、产物写入） |
| `runtimes/` | 35 | 各 CLI agent 运行时定义（19 种：claude, codex, gemini, cursor-agent 等） |
| `live-artifacts/` | 5 | 实时看板/报表（模板+数据绑定+刷新锁+JSONL 审计日志） |
| `connectors/` | 7 | 外部数据连接器集成 |
| `http/` | 6 | SSE 响应构建、origin 校验、路由上下文契约 |
| `prompts/` | 8 | 系统 prompt 模板 |
| `registry/` | 4 | 注册中心后端 |
| `research/` | 3 | Tavily 搜索集成 |
| `genui/` | 4 | GenUI surface 管理 |
| `storage/` | 4 | 存储工具 |
| `logging/` | 1 | 评审日志 |
| `metrics/` | 1 | Prometheus 指标 |
| `qa/` | 1 | QA 工具 |
| `tools/` | 1 | 工具定义 |
| `sidecar/` | 2 | Sidecar 服务器 |

### 4.3 API 路由（100+ 端点）

| 路由前缀 | 职责 | 关键端点 |
|---|---|---|
| `/api/health` | 健康检查 | GET |
| `/api/projects` | 项目 CRUD | 文件读写/搜索/ZIP下载/PDF导出/SSE 文件变更事件 |
| `/api/runs` | Chat 运行 | 创建/取消/SSE 流/工具结果注入/反馈 |
| `/api/proxy/*` | BYOK API 代理 | Anthropic/OpenAI/Azure/Gemini/Ollama SSE 代理 |
| `/api/design-systems` | 设计系统 | CRUD/生成任务/修订版本/预览/展示 |
| `/api/skills` | 技能 | 列表/详情/示例/资源文件 |
| `/api/plugins` | 插件系统 | 安装/卸载/升级/应用/诊断/信任/市场/事件流 |
| `/api/applied-plugins` | 已应用插件 | 快照列表/导出/修剪 |
| `/api/live-artifacts` | 实时产物 | CRUD/刷新/工具端点 |
| `/api/deploy` | 部署 | Cloudflare Pages 区域/部署/预检 |
| `/api/media` | 媒体生成 | 模型列表/生成任务/ElevenLabs 语音 |
| `/api/mcp` | MCP 协议 | 服务器配置/OAuth 流 |
| `/api/memory` | 记忆系统 | CRUD/树结构/提取/连接器建议 |
| `/api/automation-*` | 自动化 | 源数据包/摄取/提案/应用/拒绝 |
| `/api/critique` | 设计评审 | 中断/产物/合规历史 |
| `/api/codex-pets` | 桌面宠物 | 列表/同步/精灵图 |
| `/api/craft` | 工艺知识 | 列表/详情 |
| `/api/prompt-templates` | 提示模板 | 列表/按 surface+id 获取 |
| `/api/orbit` | Orbit 服务 | 状态/运行 |
| `/api/analytics` | 分析 | 配置/可观测事件 |
| `/api/templates` | 项目模板 | CRUD |
| `/api/atoms` | 原子操作 | 列表/详情 |
| `/api/marketplaces` | 市场 | CRUD/刷新/信任/插件列表 |
| `/api/import` | 导入 | Claude Design ZIP/本地文件夹 |
| `/api/upload` | 上传 | 文件上传 |
| `/api/artifacts` | 产物 | 保存/lint |
| `/api/research` | 搜索 | Tavily 搜索 |

### 4.4 SSE 流类型

1. **项目文件事件** (`/api/projects/:id/events`) — Chokidar 文件监听，引用计数订阅
2. **运行事件** (`/api/runs/:id/events`) — Agent 输出（start, text_delta, tool_use, tool_result, usage, error, end）
3. **评审事件** — critique.run_started, critique.panelist_scored, critique.shipped 等
4. **插件事件** — 插件生命周期事件
5. **记忆事件** — 提取事件流

事件格式：
```
event: <type>
data: <JSON payload>
id: <event-id>
```

### 4.5 认证/安全

| 机制 | 说明 |
|------|------|
| Desktop Auth | HMAC 签名 + nonce 防重放 + 60s TTL |
| API Token | `OD_API_TOKEN` 环境变量，非回环地址必须 Bearer token |
| Origin 校验 | 同源策略 + 白名单 + 跨域拒绝 |
| Tool Token | 限定 API token 绑定项目/运行 ID |

---

## 五、Web 端详细架构

### 5.1 页面路由

| 路由 | 组件 | 功能 |
|---|---|---|
| `/` | `EntryView` | 首页 Hero |
| `/projects` | `EntryView` | 项目列表 |
| `/automations` | `EntryView` | 自动化任务 |
| `/plugins` | `EntryView` | 插件市场 |
| `/design-systems` | `EntryView` | 设计系统 |
| `/integrations` | `EntryView` | 集成管理 |
| `/projects/:id` | `ProjectView` | 项目工作区（分栏布局） |
| `/projects/:id/conversations/:cid` | `ProjectView` | 对话视图 |
| `/marketplace` | `MarketplaceView` | 插件市场详情 |
| `/design-systems/create` | `DesignSystemCreationFlow` | 设计系统创建 |
| `/design-systems/:id` | `DesignSystemDetailView` | 设计系统详情 |

### 5.2 核心组件

| 组件 | 职责 |
|---|---|
| `App.tsx` | 根编排器。Bootstrap（daemon 检测/配置加载）、路由分发、全局状态（项目/Agent/技能/配置）、设置弹窗 |
| `EntryView` | 左侧导航 + Hero 布局，Tab 切换（Home/Projects/Tasks/Plugins/DesignSystems/Integrations） |
| `ProjectView` | 分栏布局：左 ChatPane + 右 FileWorkspace，SSE 消息流、设计系统活动 |
| `ChatPane` | 对话历史、Starter prompts、消息渲染、Todo 卡片、反馈按钮 |
| `ChatComposer` | 消息输入（@-mention 技能/插件/文件/连接器、/命令、文件拖拽上传） |
| `AssistantMessage` | Markdown 渲染 + ToolCard（每个 tool_use/tool_result 对） |
| `ToolCard` | 工具调用卡片（Write/Edit/Read/Bash/Glob/Grep/WebFetch 等专用视图） |
| `FileWorkspace` | 文件树、实时产物 tab、拖拽排序、Cmd+K 快速切换 |
| `FileViewer` | 沙箱 iframe（srcdoc）、Deck 导航（postMessage 桥）、导出菜单、评论叠加、手动编辑、调色板、部署 |
| `DesignSystemFlow` | 从 GitHub/本地导入、生成任务轮询、审计修复 |
| `TheaterStage` | 设计评审 Theater（多评委 lane、轮次分隔、打分器、中断按钮） |
| `SketchEditor` | 画布编辑器（画笔/文字/矩形/箭头/橡皮擦/选择、颜色/粗细） |
| `PreviewModal` | 插件/技能/示例预览（HTML/源码/自定义多 tab） |
| `ManualEditPanel` | 可视化样式编辑面板 |

### 5.3 产物系统

**Artifact 类型**：`html | deck | react-component | markdown-document | svg | diagram | code-snippet | mini-app | design-system`

**渲染管线**：

1. `parser.ts` — 流式解析 `<artifact identifier="..." type="..." title="...">` 标签
2. `manifest.ts` — JSON manifest（version/kind/title/entry/renderer/status/exports/provenance）
3. `renderer-registry.ts` — 注册渲染器（HtmlRenderer, DeckHtmlRenderer, ReactComponentRenderer, MarkdownRenderer, SvgRenderer）
4. `srcdoc.ts` — 沙箱 iframe 构建，注入 deck 导航/评论选择/编辑模式/调色板桥
5. `exports.ts` — 导出函数：`exportAsHtml()`, `exportAsPdf()`, `exportAsZip()`, `exportAsJsx()`, `exportAsMd()`

### 5.4 状态管理

**无全局 Store**，React 本地状态 + localStorage + Daemon API 混合：

- `App.tsx` 持有全局状态（项目/Agent/技能/配置），通过 props 下发
- `state/config.ts` — `loadConfig()`/`saveConfig()` + `syncConfigToDaemon()` 双向同步
- `state/projects.ts` — 项目 CRUD + tab 状态持久化
- localStorage 持久化用户偏好；daemon SQLite 持久化项目/会话

### 5.5 Daemon 通信

| 方式 | 模块 | 说明 |
|------|------|------|
| SSE | `providers/daemon.ts` | `streamViaDaemon()` → POST `/api/runs` + GET `/api/runs/:id/events`，含重连（5 次） |
| SSE | `providers/project-events.ts` | `/api/projects/:id/events`（file-changed, live_artifact, conversation-created），指数退避重连 |
| SSE | `Theater/state/sse.ts` | critique 评审事件 |
| REST | `providers/registry.ts` | 全套 API client（项目/技能/设计系统/连接器/部署） |
| iframe postMessage | `runtime/srcdoc.ts` | 预览桥接（deck 导航/评论/编辑/调色板） |

### 5.6 评论系统

1. 用户点击预览 iframe 中的元素
2. postMessage 发送元素信息
3. `PreviewDrawOverlay` 显示标注 UI
4. 评论保存 via `upsertPreviewComment()`
5. 评论渲染为 overlay

### 5.7 编辑模式

- `edit-mode/bridge.ts` — 注入 JS 实现元素选择，计算稳定 DOM 路径
- `edit-mode/source-patches.ts` — 将可视化编辑应用回源 HTML
- `ManualEditPanel.tsx` — UI 面板（字体/颜色/间距/边框等属性编辑）

---

## 六、桌面端架构

Electron 41 壳层，通过 `window.__od__` 宿主桥接提供：

| 能力 | 方法 |
|------|------|
| PDF 打印 | `host.pdf.print()` |
| 文件选择 | `host.project.pickAndImport()`, `host.project.pickAndReplaceWorkingDir()` |
| Shell 操作 | `host.shell.openExternal()`, `host.shell.openPath()` |
| 桌面宠物 | `host.pet.setVisible()` |
| 自动更新 | `host.updater.{check, download, install, quit, status, subscribe}()` |

发布渠道：`beta`(每日) → `nightly`(内部) → `preview`(早鸟) → `stable`
平台：macOS DMG, Windows NSIS, Linux AppImage

---

## 七、共享 Packages 详解

### 7.1 `packages/contracts` — 前后端契约

核心类型定义，zod schema 验证。

| 模块 | 关键导出 |
|---|---|
| `common.ts` | `JsonValue`（约束: maxDepth:8, maxKeys:100, maxArray:500, maxString:16KB, maxBytes:256KB） |
| `errors.ts` | `API_ERROR_CODES`（70+ 错误码），`ApiError`，`createApiError()` |
| `tasks.ts` | `TaskState`（queued/starting/running/succeeded/failed/cancelled），`TaskStatus` |
| `api/chat.ts` | `ChatRequest`, `ChatRunCreateRequest/Response`, `ChatMessage`, `PersistedAgentEvent` |
| `api/artifacts.ts` | `ArtifactKind`（9 种），`ArtifactManifest`，`ArtifactProvenance*` |
| `api/projects.ts` | `Project`, `ProjectMetadata`（kind/fidelity/platform/designSystemReview/linkedDirs...） |
| `api/automations.ts` | 自动化管线（ingest→canonicalize→redact→compress→classify→propose→apply→notify） |
| `api/live-artifacts.ts` | `LiveArtifact`（html_template_v1 + 数据绑定 + 源配置 + 刷新审计） |
| `api/connectors.ts` | `ConnectorDetail`（tools[], safety ratings, auth） |
| `api/memory.ts` | `MemoryType`（user/feedback/project/reference），提取配置 |
| `api/host-tools.ts` | `HostEditorId`（cursor/vscode/windsurf/zed/webstorm/xcode/finder/terminal/warp） |
| `plugins/manifest.ts` | `PluginManifestSchema`（Zod），Pipeline/GenUI/Input/Capability/Context schema |
| `critique.ts` | `CritiqueConfigSchema`，`PanelEvent` 判别联合（20+ 事件类型） |
| `analytics/events.ts` | 30+ 分析事件 + 50+ 点击属性 |
| `prompts/system.ts` | `composeSystemPrompt()` — 核心提示词组合器（叠加：API 模式/设计哲学/设计系统/技能/插件块/元数据/Deck 框架/媒体合约） |

### 7.2 `packages/host` — 宿主桥接

`window.__od__` 全局桥接，Result 类型模式 `ActionResult = { ok: true } | Failure`，含测试 mock 工厂。

### 7.3 `packages/sidecar-proto` — IPC 协议

- `SidecarStamp`：`{ app, ipc, mode, namespace, source }` 身份元组
- `SIDECAR_MESSAGES`：click/console/eval/export-pdf/register-desktop-auth/screenshot/shutdown/status/update
- 每种 app 有专属消息 normalizer

### 7.4 `packages/sidecar` — 运行时

- 路径解析：base/namespace/runtime/ipc/pointer/manifest/log
- `createJsonIpcServer()` — 换行分隔 JSON IPC（Unix socket 或 Windows named pipe）
- `allocatePort()` — 动态端口分配 + 冲突检测
- 原子文件写入（tmp + rename）

### 7.5 `packages/plugin-runtime` — 插件运行时

| 函数 | 说明 |
|---|---|
| `parseManifest(raw)` | Zod 解析 open-design.json |
| `adaptAgentSkill(SKILLMd)` | 从 SKILL.md 合成 manifest（适配 `od:` frontmatter） |
| `mergeManifests(inputs)` | 深度合并，Sidecar > adapter 优先级 |
| `manifestSourceDigest(input)` | SHA-256 内容寻址摘要 |
| `validateManifest(value)` | 跨字段验证（pipeline repeat+until、capability 词汇检查） |
| `resolveContext(manifest, registry)` | 解析 `od.context.*` 引用为类型化 chips |

### 7.6 `packages/registry-protocol` — 注册中心

- `RegistryBackendKind`：`github | http | local | db`
- `RegistryTrust`：`official | trusted | restricted`
- `RegistryBackend` 接口：list/search/resolve/manifest/doctor/publish/yank

### 7.7 `packages/agui-adapter` — AG-UI 适配

映射 OD 内部事件 → AG-UI canonical 事件：

| OD 事件 | AG-UI 事件 |
|---|---|
| message_chunk | agent.message |
| tool_call | tool_call |
| state_update | state_update |
| genui_surface_request | ui.surface_requested |
| genui_surface_responded | ui.surface_responded |
| run_started / end | run.lifecycle |

### 7.8 `packages/platform` — 平台抽象

进程 stamp、跨平台命令（Windows .bat shim `%` 转义）、后台进程管理（SIGTERM→SIGKILL）、HTTP 健康检查轮询、工具链发现（npm/pnpm/bun/volta/asdf/mise/fnm/nvm/cargo/homebrew/opencode）。

### 7.9 `packages/diagnostics` — 诊断

日志收集 + 密钥脱敏（tokens/passwords/API keys/Bearer/Basic/home 路径）+ 系统信息（hostname/platform/arch/memory/Node version）+ ZIP 归档。

### 7.10 `packages/download` — 下载管理

HTTP Range 断点续传、checksum 校验、文件锁、并发去重（in-memory activeTasks map）、copy lease 系统。

---

## 八、资源目录

### 8.1 `design-systems/`（130+ 套）

**文件格式**：

| 文件 | 内容 |
|------|------|
| `DESIGN.md` | 9 段结构（视觉主题/色彩/排版/组件/布局/层级/Do's & Don'ts/响应式/Agent Prompt 指南） |
| `tokens.css` | CSS 自定义属性（色板/字体/间距） |
| `components.html` | 组件展示 HTML |
| `manifest.json` | schema `od-design-system-project/v1`（id/name/category/source/files/craft/preview） |
| `preview/` | 预览页面（colors/typography/spacing/buttons/inputs/app） |
| `USAGE.md` | 使用说明 |

**分类**：品牌系统（stripe/figma/apple/github/discord/tesla/bmw）、AI 平台（claude/ollama/replicate）、开发工具（cursor/raycast/vercel/warp）、风格系统（brutalism/glassmorphism/neobrutalism/editorial）。

### 8.2 `craft/`（12 份）

品牌无关的通用设计法则：

| 文件 | 主题 |
|------|------|
| `typography.md` | 字间距规则、ALL CAPS 要求 |
| `color.md` | 配色纪律（neutrals 70-90%, accent <10%, semantic <5%, effect <1%） |
| `anti-ai-slop.md` | 反 AI 痕迹（避免 Tailwind-indigo accent 等） |
| `animation-discipline.md` | 动画/过渡最佳实践 |
| `accessibility-baseline.md` | 焦点/标签/键盘路径 |
| `form-validation.md` | 表单 UX 模式 |
| `laws-of-ux.md` | 认知极限（Hick's/Fitts's 法则） |
| `rtl-and-bidi.md` | RTL 本地化支持 |
| `state-coverage.md` | 状态覆盖 |
| `typography-hierarchy.md` | 排版层级 |
| `typography-hierarchy-editorial.md` | 编辑排版层级 |

### 8.3 `design-templates/`（130+）

| 类别 | 示例 |
|------|------|
| HTML PPT | `html-ppt-pitch-deck`, 40+ zhangzara 变体, `kami-deck` |
| 原型 | `saas-landing`, `dashboard`, `login-flow`, `mobile-app` |
| 文档 | `blog-post`, `docs-page`, `finance-report`, `meeting-notes`, `pm-spec` |
| 社交媒体 | `social-carousel`, `card-twitter`, `card-xiaohongshu` |
| 视频/动效 | `motion-frames`, `video-shortform`, `sprite-animation` |
| 特殊 | `live-dashboard`, `orbit-*`（GitHub/Gmail/Linear/Notion 集成） |

### 8.4 `skills/`（130+）

| 类型 | 示例 |
|------|------|
| 图片生成 | `fal-generate`, `fal-image-edit`, `imagen`, `venice-image-generate` |
| 视频生成 | `fal-video-edit`, `sora`, `venice-video`, `video-hyperframes` |
| 音频 | `venice-audio-speech`, `venice-audio-music`, `speech` |
| 文档 | `pdf`, `docx`, `pptx`, `minimax-docx` |
| 前端 | `frontend-dev`, `frontend-design`, `shadcn-ui`, `threejs` |
| Figma | `figma-generate-design`, `figma-implement-design` |
| 设计 | `design-review`, `design-brief`, `design-consultation` |
| 特殊 | `mockup-device-3d`, `shader-dev`, `gsap-*`, `d3-visualization` |

技能使用 `SKILL.md` 格式（Claude Code 兼容），支持 OD 扩展字段（`od.mode`, `od.inputs`, `od.parameters`, `od.design_system.requires`, `od.craft.requires`）。

### 8.5 `plugins/`

| 目录 | 内容 |
|------|------|
| `_official/atoms/`（13 个） | 原子操作：discovery-question-form, direction-picker, critique-theater, design-extract, diff-review, code-import, figma-extract, handoff, patch-edit, rewrite-plan, token-map, build-test, auto-surfaces |
| `_official/scenarios/`（11 个） | 场景编排：od-new-generation（discovery→plan→generate→critique）, od-code-migration, od-figma-migration, od-tune-collab, od-media-generation, od-design-refine, od-default 等 |
| `_official/design-systems/` | 设计系统插件封装 |
| `_official/examples/` | 示例 |
| `_official/image-templates/`, `_official/video-templates/` | 模板 |
| `community/` | 社区插件 |
| `registry/` | 注册基础设施 |
| `spec/` | 插件规范文档 |

**Plugin manifest（open-design.json）结构**：

```json
{
  "specVersion": "1.0.0",
  "name": "kebab-case",
  "title": "Human Readable",
  "version": "1.0.0",
  "od": {
    "kind": "skill | scenario | atom | bundle",
    "taskKind": "new-generation | code-migration | figma-migration | tune-collab",
    "pipeline": {
      "stages": [
        { "id": "discovery", "atoms": ["discovery-question-form"] },
        { "id": "plan", "atoms": ["direction-picker", "todo-write"] },
        { "id": "generate", "atoms": ["file-write", "live-artifact"] },
        { "id": "critique", "atoms": ["critique-theater"], "repeat": true, "until": "score>=4 || iterations>=3" }
      ]
    },
    "genui": { "surfaces": [...] },
    "connectors": { ... },
    "inputs": [...],
    "capabilities": ["prompt:inject", "fs:read", "fs:write", "mcp", "subprocess"],
    "context": { "skills": [], "designSystems": [], "craft": [], "assets": [] }
  }
}
```

---

## 九、部署架构

### 9.1 三种拓扑

| 拓扑 | 说明 |
|------|------|
| A: 全本地 | 浏览器 → Next.js dev server → Daemon → Agent CLIs（默认 `pnpm tools-dev`） |
| B: Web 上 Vercel + Daemon 本地 | 浏览器 → Vercel → Tunnel → 本地 Daemon（密钥留在本地） |
| C: 纯 API（无 Daemon） | 浏览器 → Vercel → Anthropic API（密钥在 localStorage，降级体验） |

### 9.2 Docker

- `deploy/Dockerfile` — Alpine 单运行时镜像
- `deploy/docker-compose.yml` — 单容器，绑定 `127.0.0.1:7456`
- 健康检查：`/api/health`
- 内存限制：384m
- 安全：`no-new-privileges`, read-only filesystem, tmpfs for /tmp

### 9.3 Kubernetes/Helm

- `charts/open-design/` — Helm chart v0.1.0, appVersion 0.7.0
- `replicaCount: 1`（SQLite 一致性约束，**不支持 HPA**）
- Ingress + nginx annotations（SSE proxy-buffering off）
- PV 10Gi
- 可选 auth-proxy sidecar

### 9.4 数据存储路径

| 路径 | 内容 |
|------|------|
| `.od/app.sqlite` | SQLite 数据库 |
| `.od/projects/<id>/` | 项目工作目录 |
| `.od/artifacts/` | 保存的渲染产物 |
| `.od/media-config.json` | 媒体 API 凭证 |
| `history.jsonl` | 追加式操作日志（git 友好） |

---

## 十、跨包依赖图

```
contracts (zod) ──┬── plugin-runtime
                  ├── agui-adapter
                  │
sidecar-proto ──── sidecar
                  │
host (零依赖)     │
                  │
platform (零依赖) ── download
                  ├── diagnostics
                  │
registry-protocol (zod)

daemon 依赖: contracts, diagnostics, platform, plugin-runtime, registry-protocol, sidecar, sidecar-proto, agui-adapter
web 依赖: contracts, host, platform, sidecar, sidecar-proto
```

---

## 十一、与 octoAI 的关系

Open Design 是独立的设计工具项目，与 octoAI 没有代码层面的直接依赖。设计理念相似：都是 agent shell + 可插拔技能 + 本地优先。

潜在集成点：
- octoAI 的 opencode 后端可作为 Open Design 的 agent adapter 之一
- Open Design 的设计系统/工艺知识/技能可被 octoAI 的设计类 agent（octo_design, octo_studio）复用
- 两者的 SKILL.md 格式兼容
