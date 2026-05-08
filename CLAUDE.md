# octoAI

octoAI 是一个辅助设计和开发的 AI 助手，支持 20+ AI 提供商。它以 TUI（终端界面）、桌面应用（Electron）、Web 应用和 VS Code 扩展的形式运行，旨在帮助用户完成从设计到开发的全流程工作。

- **许可证**: MIT
- **默认分支**: `dev`（本地 `main` 引用可能不存在，使用 `dev` 或 `origin/dev` 进行 diff）

## 架构概览

项目采用 **Bun workspace monorepo** 架构，客户端/服务器模式：

- **核心引擎** (`packages/opencode`) 运行为 HTTP/WebSocket 服务器（Hono），暴露 REST API
- **TUI** 使用 @opentui/solid（基于 SolidJS 的终端 UI 框架）在终端中直接渲染
- **Web App** 和 **Desktop App** 作为客户端通过 HTTP/WebSocket 与服务器通信
- **VS Code 扩展** 将核心引擎嵌入为终端标签页

通信方式：HTTP REST API、WebSocket 实时事件、SSE 流式 AI 响应、Effect 服务进行进程内依赖注入、Bus/事件系统。

## 目录结构

```
packages/
  opencode/        # 核心 CLI/TUI/服务器 — 主要产品
  core/            # 共享工具库（日志、OpenTelemetry、文件匹配等）
  app/             # Web 前端 SPA（SolidJS + Vite）
  ui/              # 共享 UI 组件库（SolidJS + TailwindCSS + Shiki）
  desktop/         # Electron 桌面应用（封装 app）
  sdk/js/          # JavaScript SDK（自动生成 OpenAPI 客户端）
  plugin/          # 插件开发 SDK
  web/             # 文档网站（Astro + Starlight）
  console/         # 云平台控制台
    app/           #   Web UI（SolidStart + Cloudflare Workers）
    core/          #   后端逻辑（Drizzle ORM + PlanetScale + Stripe）
    function/      #   Cloudflare Workers 函数（认证、AI 网关）
    mail/          #   邮件模板
    resource/      #   云资源抽象
  enterprise/      # 企业/团队仪表板（SolidStart + Cloudflare）
  function/        # 公共 API Worker（含 Durable Object 同步）
  slack/           # Slack 机器人集成
  storybook/       # UI 组件 Storybook
  containers/      # Docker 容器定义
  script/          # 构建脚本工具
sdks/vscode/       # VS Code 扩展
github/            # GitHub Action（composite action）
infra/             # SST 基础设施定义（Cloudflare、Stripe、PlanetScale）
specs/             # 项目规范（v2 设计、Effect 迁移）
nix/               # Nix 打包
patches/           # 第三方依赖补丁
script/            # 顶层构建/发布/变更日志脚本
```

## 核心引擎模块 (`packages/opencode/src/`)

- **agent/** — Agent 定义（build、plan、general subagent）
- **acp/** — Agent Client Protocol 支持
- **auth/** — OAuth 认证
- **cli/** — CLI 命令、TUI 渲染、网络
- **config/** — 配置系统（agent、command、formatter、keybinds、LSP、MCP、model、permissions、plugins、providers、skills）
- **file/** — 文件操作
- **git/** — Git 集成
- **lsp/** — Language Server Protocol 客户端
- **mcp/** — Model Context Protocol 客户端/服务器
- **permission/** — 权限系统
- **provider/** — AI 提供商集成（20+ 提供商，通过 Vercel AI SDK + 自定义提供商如 OpenRouter、GitLab、Poe、Venice）
- **server/** — HTTP/WebSocket 服务器（Hono，双 Bun/Node 适配器，mdns 发现）
- **session/** — 会话管理
- **shell/** — Shell 执行
- **skill/** — Skill 系统
- **storage/** — SQLite 数据库层（Drizzle ORM）
- **tool/** — 内置工具：read、write、edit、glob、grep、shell、lsp、mcp、webfetch、websearch、task、todo、apply_patch、question、plan、skill
- **bus/** — 事件总线
- **effect/** — Effect 运行时辅助（InstanceState、makeRuntime）
- **worktree/** — Git worktree 支持
- **pty/** — 伪终端（双 Bun/Node 适配器）
- **project/** — 项目检测/引导

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript（全栈） |
| 运行时 | Bun（主要），Node.js（次要，通过条件导入 `#db`、`#pty`、`#hono`） |
| 包管理 | Bun + Turborepo monorepo |
| UI 框架 | SolidJS（TUI、Web、Desktop、Console、UI 组件） |
| TUI | @opentui/core、@opentui/solid、@opentui/keymap |
| 桌面应用 | Electron（electron-vite + electron-builder） |
| Web/文档 | Astro + Starlight |
| 后端/API | Hono + hono-openapi |
| 数据库 | SQLite（本地，Drizzle ORM）；PlanetScale/Postgres（控制台） |
| AI 集成 | Vercel AI SDK + 20+ @ai-sdk/* 提供商包 |
| Effect 系统 | Effect v4 beta（函数式服务架构、依赖注入、遥测） |
| 基础设施 | SST v3 → Cloudflare Workers + Stripe + PlanetScale + Honeycomb |
| 构建 | Vite（Web/Desktop/SDK）、Turborepo（任务编排） |
| 类型检查 | tsgo（@typescript/native-preview） |
| 代码检查 | oxlint（非 ESLint） |
| 测试 | Bun test + Playwright（E2E） |

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
