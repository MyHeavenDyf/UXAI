# octoAI

octoAI 是一个辅助设计和开发的 AI 助手，支持 20+ AI 提供商。它以 TUI（终端界面）、桌面应用（Electron）、Web 应用和 VS Code 扩展的形式运行，旨在帮助用户完成从设计到开发的全流程工作。

- **许可证**: MIT
- **默认分支**: `dev`（本地 `main` 引用可能不存在，使用 `dev` 或 `origin/dev` 进行 diff）

## 架构概览

项目采用 **Bun workspace monorepo** 架构，客户端/服务器模式：

- **核心引擎** (`packages/opencode`) 运行为 HTTP/WebSocket 服务器，暴露 REST API
- **TUI** 使用 @opentui/solid（基于 SolidJS 的终端 UI 框架）在终端中直接渲染
- **Web App** 和 **Desktop App** 作为客户端通过 HTTP/WebSocket 与服务器通信
- **VS Code 扩展** 将核心引擎嵌入为终端标签页

通信方式：HTTP REST API、WebSocket 实时事件、SSE 流式 AI 响应、Effect 服务进行进程内依赖注入、Bus/事件系统。

**双服务器后端**：通过 `OCTO_EXPERIMENTAL_HTTPAPI` 标志切换。dev/beta/local 通道默认使用新的 Effect-HttpApi 后端（`server/routes/instance/httpapi/`），稳定通道使用旧 Hono 后端（`server/routes/instance/`）。

## 目录结构

```
packages/
  opencode/        # 核心 CLI/TUI/服务器 — 主要产品
  core/            # 共享工具库（日志、OpenTelemetry、文件匹配、Flag 系统等）
  app/             # Web 前端 SPA（SolidJS + Vite + TanStack Query）
                   #   octoapp/ 子目录包含 Octo 专用页面（insight、make、skills）
  ui/              # 共享 UI 组件库（SolidJS + TailwindCSS + Shiki，100+ 组件）
  desktop/         # Electron 桌面应用（electron-vite + electron-builder，16 种语言）
                   #   IPC handlers: skills.json 读写、store 操作、文件选择器、剪贴板等
  sdk/js/          # JavaScript SDK（@hey-api/openapi-ts 自动生成 OpenAPI 客户端）
  plugin/          # 插件开发 SDK（工具注册、TUI 扩展、事件钩子）
  web/             # 文档网站（Astro + Starlight）
  console/         # 云平台控制台
    app/           #   Web UI（SolidStart + Cloudflare Workers）
    core/          #   后端逻辑（Drizzle ORM + PlanetScale + Stripe）
    function/      #   Cloudflare Workers 函数（认证、AI 网关）
    mail/          #   邮件模板（@jsx-email）
    resource/      #   云资源抽象（生产 Cloudflare / 开发 Node 条件导入）
  enterprise/      # 企业/团队仪表板（SolidStart + Cloudflare，部署在 opncd.ai）
  function/        # 公共 API Worker（含 Durable Object 同步、GitHub App 认证）
  slack/           # Slack 机器人集成
  storybook/       # UI 组件 Storybook（Storybook 10）
  containers/      # Docker 容器定义（base、bun-node、publish、rust、tauri-linux）
  script/          # 构建脚本工具（semver 管理）
  identity/        # 品牌资源（SVG/PNG 图标）
  extensions/      # 编辑器扩展（Zed）
  docs/            # Mintlify 文档（含 AI 工具指南：Cursor、Claude Code、Windsurf）
sdks/vscode/       # VS Code 扩展（esbuild 构建，cmd/ctrl+escape 快捷键）
github/            # GitHub Action（composite action）
infra/             # SST v3 基础设施定义（Cloudflare Workers、Stripe、PlanetScale、Honeycomb）
specs/             # 项目规范（v2 设计、Effect 迁移、多项目 API 设计）
nix/               # Nix 打包（opencode CLI + desktop，4 平台 node_modules）
patches/           # 第三方依赖补丁（@npmcli/agent、standard-openapi、solid-js、韩语 IME 修复）
script/            # 顶层构建/发布/变更日志脚本
```

## 核心引擎模块 (`packages/opencode/src/`)

### Agent 系统
- **agent/** — Agent 定义与动态生成
  - 内置 Agent：`octo_ai`（默认主 agent）、`plan`（规划模式，隐藏）、`general`（通用子 agent）、`explore`（快速代码探索子 agent）
  - 专业 Agent：`octo_insight`（访谈分析）、`octo_make`（HTML 原型）、`octo_design`（UI 设计）、`octo_canva`（创意素材）
  - 隐藏 Agent：`compaction`（上下文压缩）、`title`（标题生成）、`summary`（摘要生成）
  - `agent/prompt/` — 各 agent 的系统提示（compaction、explore、octo_insight、octo_make、octo_design、octo_canva、summary、title）
  - `agent/skills/` — 按 agent 组织的内置 Skill 定义（每个包含 SKILL.md）
    - `octo_insight/interview-analysis/SKILL.md`
    - `octo_make/html-prototype/SKILL.md`
    - `octo_design/design-basics/SKILL.md`
    - `octo_canva/creative-assets/SKILL.md`
- **acp/** — Agent Client Protocol 支持（外部 agent 管理）

### Session 系统
- **session/** — 会话管理（22 个模块）
  - `session.ts` — Session CRUD、状态管理
  - `prompt.ts` — 主提示构建器（系统提示、上下文注入、工具定义）
  - `llm.ts` — LLM 交互循环
  - `message.ts` / `message-v2.ts` — 消息数据模型（v2 为新格式）
  - `processor.ts` — 消息处理管道
  - `compaction.ts` — 上下文压缩
  - `projectors.ts` / `projectors-next.ts` — 数据投影（不同 API 格式适配）
  - `session-category.ts` / `session-category.sql.ts` — Session 分类系统（按 agent 类型自动归类：dev/design/prototype/analysis/creative/planning）
  - `retry.ts` — LLM 重试逻辑
  - `revert.ts` — 会话状态回退（基于 git）
  - `run-state.ts` — 运行状态机
  - `todo.ts` — Todo 跟踪
  - `instruction.ts` — 项目指令
  - `system.ts` — 系统消息生成
  - `overflow.ts` — 上下文溢出处理
  - `session/prompt/` — 提供商特定系统提示（anthropic、gpt、gemini、codex、copilot-gpt-5、beast、trinity、kimi、default）+ plan/plan-reminder/max-steps/build-switch

### V2 API 层
- **v2/** — 新一代数据模型（逐步替代原始结构）
  - `session.ts` — V2 Session 服务
  - `session-message.ts` / `session-message-updater.ts` — V2 消息模型
  - `session-event.ts` — V2 事件追踪
  - `session-prompt.ts` — V2 提示处理
  - `auth.ts` / `model.ts` / `event.ts` / `tool-output.ts` / `schema.ts`

### 配置系统
- **config/** — 配置系统（22 个模块）
  - `config.ts` — 主配置解析器（多来源读取）
  - `agent.ts` — Agent 配置 Schema（含 skills 字段）
  - `command.ts` / `keybinds.ts` / `formatter.ts` — 命令/快捷键/格式化
  - `mcp.ts` / `lsp.ts` — MCP/LSP 配置
  - `permission.ts` — 权限配置
  - `plugin.ts` — 插件配置
  - `provider.ts` / `model-id.ts` — 提供商/模型配置
  - `skills.ts` — Skill 路径/URL 配置
  - `managed.ts` — 托管/远程配置
  - `paths.ts` / `parse.ts` — 路径解析/配置解析
  - `server.ts` / `layout.ts` — 服务器/UI 布局配置
  - `variable.ts` — 变量/模板
  - `markdown.ts` — Markdown 渲染配置
  - `console-state.ts` — 控制台连接状态

### 工具系统
- **tool/** — 内置工具
  - `shell` (bash) — Shell 命令执行
  - `read` / `write` / `edit` — 文件读/写/编辑
  - `glob` / `grep` — 文件搜索/内容搜索
  - `webfetch` / `websearch` — 网页获取/搜索
  - `task` — 子 agent 任务管理
  - `todo` — Todo 列表管理
  - `lsp` — LSP 诊断
  - `apply_patch` — 补丁应用
  - `plan` — 规划模式退出
  - `question` — 用户提问
  - `skill` — Skill 调用
  - `invalid` / `external-directory` — 无效工具处理/外部目录访问
  - `media_transcribe` — 音视频转录
  - `registry.ts` — 工具注册中心

### 服务器
- **server/** — HTTP/WebSocket 服务器（双 Bun/Node 适配器，mdns 发现）
  - 旧 Hono 后端：`server/routes/instance/`（17 个路由文件）
  - 新 Effect-HttpApi 后端：`server/routes/instance/httpapi/`（18 个路由组 + 中间件）
  - 路由涵盖：session、config、mcp、provider、file、pty、tui、sync、permission、project、question、trace、experimental、event、workspace、v2
  - `server/shared/` — 共享工具（fence、pty-ticket、ui、workspace-routing）

### 其他核心模块
- **auth/** — OAuth 认证
- **bus/** — 事件总线（pub/sub）
- **cli/** — CLI 框架 + 20+ 命令（run、serve、session、agent、acp、mcp、providers、models、github、pr、stats、export/import、debug、upgrade、uninstall、account、plug、db、web、generate）+ TUI 子系统（组件、主题 34 种、上下文管理）
- **control-plane/** — 工作区/团队管理（workspace 生命周期、同步、会话 warp、事件流）
- **effect/** — Effect 运行时辅助（AppRuntime、BootstrapRuntime、bridge、InstanceState、InstanceRegistry、RunService）
- **file/** — 文件操作（ripgrep 集成、文件监听、忽略规则、保护文件）
- **format/** — 代码格式化（Prettier 集成）
- **git/** — Git 操作
- **ide/** — IDE 检测与集成
- **installation/** — 安装管理（通道、版本控制）
- **lsp/** — Language Server Protocol 客户端（TypeScript server、诊断）
- **mcp/** — Model Context Protocol 客户端/服务器（OAuth 认证）
- **permission/** — 权限系统（allow/deny/ask 规则）
- **plugin/** — 插件系统（加载、安装、元数据、GitHub Copilot 集成）
- **project/** — 项目管理（VCS、实例生命周期、实例层）
- **provider/** — AI 提供商集成（20+ 提供商，含 GitHub Copilot SDK）
- **pty/** — 伪终端（双 Bun/Node 适配器）
- **share/** — 会话分享
- **shell/** — Shell 执行
- **skill/** — Skill 发现与管理（支持 .opencode/skill/、.claude/skills/、.agents/skills/、内置 agent skills、远程 URL）
- **snapshot/** — 状态快照
- **storage/** — SQLite 数据库层（Drizzle ORM、JSON 迁移、双 Bun/Node 适配器）
- **sync/** — 事件同步系统
- **worktree/** — Git worktree 支持
- **account/** — 用户账户管理（控制台组织集成）
- **command/** — 命令模板（初始化、审查）
- **env/** — 环境配置
- **id/** — ID 生成
- **patch/** — 补丁系统
- **question/** — 用户提问系统
- **util/** — 共享工具（34 个文件：effect-zod、filesystem、schema、process、wildcard、rpc、lock、queue、locale 等）

### 数据库 Schema
Schema 文件与各模块同目录（`src/**/*.sql.ts`）：
- `session/session.sql.ts` — SessionTable、PartTable
- `session/session-category.sql.ts` — SessionCategoryTable
- `project/project.sql.ts` — ProjectTable
- `account/account.sql.ts` — AccountTable
- `control-plane/workspace.sql.ts` — WorkspaceTable
- `share/share.sql.ts` — ShareTable
- `sync/event.sql.ts` — EventSequenceTable、EventTable

迁移使用 `bun run db generate --name <slug>` 生成。

## Flag 系统 (`packages/core/src/flag/flag.ts`)

所有环境变量标志统一使用 `OCTO_` 前缀。关键标志：

| 标志 | 类型 | 说明 |
|------|------|------|
| `OCTO_CONFIG` | string | 配置文件路径 |
| `OCTO_CONFIG_CONTENT` | string | 配置内容覆盖 |
| `OCTO_CLIENT` | getter | 客户端类型（默认 "cli"） |
| `OCTO_DB` | string | 数据库路径覆盖 |
| `OCTO_PERMISSION` | string | 权限覆盖 |
| `OCTO_DISABLE_AUTOUPDATE` | boolean | 禁用自动更新 |
| `OCTO_DISABLE_EXTERNAL_SKILLS` | boolean | 禁用外部 skills |
| `OCTO_DISABLE_CLAUDE_CODE_SKILLS` | boolean | 禁用 Claude Code skills |
| `OCTO_ENABLE_QUESTION_TOOL` | boolean | 启用 question 工具 |
| `OCTO_ENABLE_EXA` | boolean | 启用 Exa 搜索 |
| `OCTO_EXPERIMENTAL_HTTPAPI` | boolean | 使用新 HttpApi 后端 |
| `OCTO_EXPERIMENTAL_WORKSPACES` | boolean | 工作区功能 |
| `OCTO_EXPERIMENTAL_PLAN_MODE` | boolean | 规划模式 |
| `OCTO_EXPERIMENTAL_MARKDOWN` | boolean | Markdown 渲染（默认 true） |
| `OCTO_EXPERIMENTAL_LSP_TOOL` | boolean | LSP 工具 |
| `OCTO_EXPERIMENTAL_EVENT_SYSTEM` | boolean | 事件系统 |
| `OCTO_SKIP_MIGRATIONS` | boolean | 跳过数据库迁移 |
| `OCTO_STRICT_CONFIG_DEPS` | boolean | 严格配置依赖检查 |
| `OCTO_PURE` | getter | 纯净模式（无插件） |
| `OCTO_WORKSPACE_ID` | string | 工作区 ID 覆盖 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | OpenTelemetry 端点 |

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript（全栈） |
| 运行时 | Bun（主要），Node.js（次要，通过条件导入 `#db`、`#pty`、`#hono`、`#httpapi-server`） |
| 包管理 | Bun 1.3.13 + Turborepo 2.8.13 monorepo（catalog 统一版本管理） |
| UI 框架 | SolidJS（TUI、Web、Desktop、Console、Enterprise、UI 组件） |
| TUI | @opentui/core、@opentui/solid、@opentui/keymap |
| 桌面应用 | Electron 42（electron-vite + electron-builder） |
| Web/文档 | Astro + Starlight + SolidJS |
| 后端/API | Hono + hono-openapi（旧）/ Effect-HttpApi（新） |
| 数据库 | SQLite（本地，Drizzle ORM）；PlanetScale/Postgres（控制台） |
| AI 集成 | Vercel AI SDK + 20+ @ai-sdk/* 提供商（anthropic、openai、google、azure、bedrock、groq、mistral、xai、cohere、deepinfra、togetherai、cerebras、perplexity、alibaba、vercel、gateway 等）+ 自定义提供商（OpenRouter、GitLab、Poe、Venice、GitHub Copilot SDK） |
| Effect 系统 | Effect v4 beta（函数式服务架构、依赖注入、遥测、@effect/opentelemetry） |
| 基础设施 | SST v3 → Cloudflare Workers + Stripe + PlanetScale + Honeycomb + R2 |
| 构建 | Vite（Web/Desktop/SDK）、Turborepo（任务编排） |
| 类型检查 | tsgo（@typescript/native-preview） |
| 代码检查 | oxlint（非 ESLint） |
| 测试 | Bun test + Playwright（E2E） |
| 国际化 | 桌面端 16 种语言（ar、br、bs、da、de、en、es、fr、ja、ko、no、pl、ru、zh、zht） |

## 开发命令

```bash
bun dev              # 启动 TUI 开发服务器
bun dev:desktop      # 启动桌面应用开发
bun dev:web          # 启动 Web 应用开发
bun dev:console      # 启动控制台开发
bun dev:storybook    # 启动 Storybook
bun lint             # 运行 oxlint
bun typecheck        # 跨所有包运行 Turborepo 类型检查
```

类型检查和测试必须从包目录运行（如 `packages/opencode`），不能从仓库根目录运行。

## 代码风格

- 保持单函数原则，除非需要组合或复用
- 避免 `try`/`catch`；避免 `any` 类型
- 使用 Bun API（如 `Bun.file()`）而非 Node.js 等价物
- 依赖类型推断，仅在导出或必要时添加显式类型注解
- 优先使用函数式数组方法（flatMap、filter、map）而非 for 循环
- 使用类型守卫（type guards）在 filter 上保持类型推断
- 减少变量数量，仅使用一次的值应内联
- 避免不必要的解构，使用点表示法保留上下文
- 优先使用 `const`，用三元表达式或提前返回代替 `let` 重赋值
- 避免 `else` 语句，优先提前返回

### 配置模块模式

在 `src/config` 中，遵循文件顶部的自导出模式：

```ts
export * as ConfigAgent from "./agent"
```

### Drizzle Schema 规范

使用 snake_case 命名字段，避免重复定义列名字符串：

```ts
// 好
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
})

// 差
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
})
```

数据库 schema 位于 `src/**/*.sql.ts`，迁移使用 `bun run db generate --name <slug>` 生成。

## Effect 规范

- 使用 `Effect.gen(function* () { ... })` 组合
- 使用 `Effect.fn("Domain.method")` 命名/追踪效果
- 使用 `Effect.void` 而非 `Effect.succeed(undefined)`
- 使用 `Schema.Class` 处理多字段数据
- 使用 `Schema.TaggedErrorClass` 处理类型化错误
- 使用 `makeRuntime` 创建所有服务
- 使用 `InstanceState` 管理每目录/每项目状态
- 使用 `Instance.bind(fn)` 为原生插件回调捕获 AsyncLocalStorage 上下文
- v4 beta 中无 `Effect.fork`/`Effect.forkDaemon`，使用 `Effect.forkIn(scope)`

### 模块组织

不使用 `export namespace Foo { ... }`，使用扁平顶层导出 + 自重导出：

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export * as Foo from "./foo"  // 自重导出

// 消费者
import { Foo } from "@/foo/foo"
```

多同级目录不使用 barrel `index.ts`，消费者直接导入具体同级模块。

## 测试

- 尽量避免 mock，测试实际实现
- 不要在测试中复制逻辑
- 测试不能从仓库根目录运行（有 guard），需从包目录运行
- SDK 重新生成：`./packages/sdk/js/script/build.ts`

## 生成代码

- `packages/sdk/js/src/gen/` — 由 @hey-api/openapi-ts 自动生成
- `packages/sdk/js/src/v2/gen/` — v2 版本自动生成
- 推送到 `dev` 时 CI 自动运行 `./script/generate.ts` 并提交

## CI/CD

- **测试**: push 到 `dev` 和 PR 时运行（Linux + Windows）
- **类型检查**: push 到 `dev` 和 PR 到 `dev` 时运行
- **发布**: push 到 `dev`/`beta`/`ci` 分支时构建全平台二进制、桌面应用、NPM 包
- **部署**: SST 部署到 Cloudflare（dev/production 阶段）

## 基础设施 (`infra/`)

| 文件 | 说明 |
|------|------|
| `stage.ts` | 域名配置：`opencode.ai`（生产）、`dev.opencode.ai`（开发）、短域名 `opncd.ai` |
| `app.ts` | 公共 API Worker（`api.{domain}`，Durable Object SyncServer）、文档站、Web 应用 |
| `console.ts` | PlanetScale、Auth Worker（GitHub/Google OAuth）、Stripe（Zen Lite $10/月、Zen Black $20-200/月）、Console 应用、Honeycomb 日志、EmailOctopus、AWS SES、Salesforce |
| `enterprise.ts` | 企业/团队应用（`opncd.ai`，R2 存储） |
| `monitoring.ts` | Honeycomb 告警（模型/提供商 HTTP 错误、免费层请求激增、Discord webhook） |
| `secret.ts` | 共享密钥（R2 访问密钥、Honeycomb webhook secret） |

## Octo App 前端 (`packages/app/octoapp/`)

桌面端和 Web 端共用的 SolidJS 前端应用，双入口文件架构。

### 双入口文件

| 文件 | 用途 |
|------|------|
| `app.tsx` | Web 端入口 |
| `octo.tsx` | **桌面端入口**（Electron） |

**重要**: 路由、lazy import、`isOctoPage()` 判断必须**同时在两个文件中更新**。

### 页面路由

| 路由 | 组件 | 说明 |
|------|------|------|
| `/` | `HomeRoute` | 首页 |
| `/insight/:id?` | `InsightPage` | Octo Insight 对话页（`octo_insight` agent） |
| `/make/:id?` | `MakePage` | Octo Make 原型页（`octo_make` agent） |
| `/skills` | `SkillsPage` | 技能库管理页 |
| `/:dir/chat/:id?` | `ChatPage` | 目录级聊天页 |
| `/:dir/studio` | `StudioPage` | 目录级 Studio 页 |

### 关键页面结构

#### Insight/Make 页面（双栏布局）

- **左栏**: 对话面板（可拖拽宽度 240px~45%），显示 `InsightTurn` 组件
- **右栏**: `ResultViewer` — 根据 tab 类型渲染不同内容
- **`isOctoPage()`**: `/insight`、`/make`、`/skills` 页面使用 Octo 侧边栏布局

#### ResultViewer 类型渲染

| Tab 类型 | 渲染器 | 说明 |
|----------|--------|------|
| `table` | `TableRenderer` | Markdown 表格解析为 HTML 表格 |
| `markdown` | `MarkdownRenderer` | 复用 `<Markdown>` 组件 |
| `mindmap` | `MermaidPlaceholder` | 显示源码（Phase 2 将实现 SVG） |
| `json` | `JsonRenderer` | JSON 格式化显示 |
| `html` | `HtmlRenderer` | iframe 预览 + textarea 编辑模式切换 |

#### 输出卡片检测（`insight-turn.tsx`）

对 assistant parts 按优先级扫描：
1. `state.attachments` — HTML 附件（mime `text/html`）
2. `state.input` — **write tool 的输入**（包含实际 HTML 内容，`input.content`/`input.text`/`input.data`）
3. `state.output` — 工具输出文本
4. 兜底：text parts

#### 技能库页面（`/skills`）

- 按 4 个 agent 分组（`AGENT_GROUPS` 硬编码映射）
- 手风琴折叠，Toggle 开关控制 `~/.config/octo/skills.json` 的 `import` 字段
- 数据流：`window.api.getSkillsConfig()` IPC → 渲染 → toggle → `window.api.setSkillsConfig()` 写入

### 侧边栏（`pages/_shell/sidebar.tsx`）

- **Octo Insight**: session 列表，使用 `globalSync.data.path.home`，按 `agent === "octo_insight"` 过滤
- **Octo Make**: session 列表，使用 `server.projects.last()`，按 `agent === "octo_make"` 过滤
- **技能库/资产库**: 底部固定导航，技能库跳转 `/skills`

## CLI 命令

`octo` CLI 入口（`packages/opencode/bin/octo`、`packages/opencode/bin/opencode`）暴露以下命令：

| 命令 | 说明 |
|------|------|
| `run` | 运行提示（主命令） |
| `serve` | 启动 HTTP 服务器 |
| `web` | 打开 Web UI |
| `session` | 会话管理 |
| `agent` | Agent 管理 |
| `acp` | Agent Control Protocol |
| `mcp` | MCP 服务器管理 |
| `providers` | 提供商管理 |
| `models` | 模型列表 |
| `github` | GitHub 集成 |
| `pr` | Pull Request 工作流 |
| `stats` | 使用统计 |
| `export` / `import` | 数据导出/导入 |
| `debug` | 调试子命令（agent、config、file、lsp、ripgrep、skill、snapshot、startup） |
| `upgrade` / `uninstall` | 生命周期管理 |
| `account` | 账户/控制台管理 |
| `plug` | 插件管理 |
| `db` | 数据库操作 |
| `generate` | 动态生成 agent 配置 |

## 已知问题（待修复）

### Agent Skills 未按 agent 限定范围

**状态**: 待修复
**涉及文件**: `src/skill/index.ts`、`src/session/system.ts`、`src/agent/agent.ts`

`agent.skills` 字段（如 `octo_insight: ["interview-analysis"]`）已在 agent 定义中声明，但当前未被使用：

- `Skill.available()` 只按 permission 过滤，不读取 `agent.skills` 过滤可见 skill
- `SystemPrompt.skills()` 列出所有 skill，未按 agent 限定
- 结果：所有 agent 能看到并调用全部 4 个 skill（interview-analysis、html-prototype、design-basics、creative-assets），而非仅自己配置的

**预期行为**: 每个 agent 只能看到 `agent.skills` 中配置的 skill（或默认全部可见）。

### CLI dev 模式下预置 provider 无模型

**状态**: 待修复
**涉及文件**: `packages/opencode/package.json`、`src/provider/models.ts`、`src/provider/provider.ts`

**问题**: `bun dev`（CLI 模式）不运行 `generate.ts`，导致 `models-snapshot.js` 不存在。此时 `models.ts` 的 `populate()` 和 `provider.ts` 的 opencode custom loader 都无法加载快照，opencode provider 有 0 个模型。只有 `bun dev:desktop` 会通过 `packages/desktop/scripts/predev.ts` → `build-node.ts` → `generate.ts` 生成快照。

**修复计划**:
1. 在 `packages/opencode/package.json` 添加 `"predev": "bun script/generate.ts"`，确保 CLI dev 也先生成快照
2. 在 `models.ts` `populate()` 和 `provider.ts` opencode custom loader 中添加 `api.json` 兜底：当快照不可用时直接 `import("../../api.json")` 读取模型定义

**数据源**: `packages/opencode/api.json` 是 Octo AI provider 的唯一模型数据源（4 个模型），不再从网络获取。
