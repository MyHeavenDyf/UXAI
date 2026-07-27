# 数据库路径从 opencode 切换到 octo — 完整修改清单

## 概述

将数据库路径从 `opencode/opencode.db` 切换到 `octo/octo.db`，涉及 **5 大类、50+ 处修改**。

## 第一类：数据目录（核心，1 处改全部生效）

| 文件 | 行 | 当前 | 改为 | 影响 |
|------|---|------|------|------|
| `packages/core/src/global.ts` | 9 | `const app = "opencode"` | `const app = "octo"` | XDG data/config/cache/state 全部从 `opencode` 变为 `octo` |

改此一处，以下路径自动跟随变化：
- `~/.local/share/opencode` → `~/.local/share/octo`
- `~/.config/opencode` → `~/.config/octo`
- `~/.cache/opencode` → `~/.cache/octo`
- `~/.local/state/opencode` → `~/.local/state/octo`

## 第二类：数据库文件名（3 处）

| 文件 | 行 | 当前 | 改为 |
|------|---|------|------|
| `packages/opencode/src/storage/db.ts` | 30 | `"opencode.db"` | `"octo.db"` |
| `packages/opencode/src/storage/db.ts` | 32 | `` `opencode-${safe}.db` `` | `` `octo-${safe}.db` `` |
| `packages/opencode/src/index.ts` | 118 | `"opencode.db"` (marker) | `"octo.db"` |

## 第三类：Desktop 包（15 处）

| 文件 | 行 | 内容 | 类型 |
|------|---|------|------|
| `src/main/index.ts` | 402 | `join(base, "opencode", "opencode.db")` | DB 存在检测 |
| `src/main/index.ts` | 86 | `` `opencode-onboarding-${randomUUID()}` `` | 临时目录 |
| `src/main/index.ts` | 121 | `"opencode://"` | 深度链接 scheme |
| `src/main/index.ts` | 156 | `app.setAsDefaultProtocolClient("opencode")` | URL scheme 注册 |
| `src/main/index.ts` | 238 | `username: "opencode"` | 服务器认证 |
| `src/main/sidecar.ts` | 81 | `username: "opencode"` | 服务器认证 |
| `src/main/sidecar.ts` | 104 | `OCTO_SERVER_USERNAME: "opencode"` | 环境变量 |
| `src/main/migrate.ts` | 147 | `"opencode", "dist", "node", "skills.json"` | 资源路径 |
| `src/main/migrate.ts` | 189 | `"opencode", "dist", "node", "skill"` | 资源路径 |
| `src/main/constants.ts` | 7 | `"opencode.settings"` | Store 名称 |
| `src/main/migrate.ts` | 27-29, 37-39 | `"ai.opencode.desktop.*"` | 旧 App ID |
| `src/main/migrate.ts` | 96, 99 | `"opencode.settings.dat"` | 迁移映射 |
| `electron-builder.config.ts` | 68, 108, 120 | `schemes: ["opencode"]` | URL scheme |
| `electron-builder.config.ts` | 45-47 | `"../opencode/dist/node/"` | 构建资源 |
| `electron-builder.config.ts` | 100, 112, 122 | `packageName: "opencode*"` | RPM 包名 |

## 第四类：环境变量（50+ 处）

`packages/core/src/flag/flag.ts` 中所有 `OPENCODE_*` 环境变量名。如果改名，所有消费者都需要更新。

关键 DB 相关变量：

| 变量名 | 消费者 |
|--------|--------|
| `OPENCODE_DB` | db.ts, preload.ts, httpapi-exercise.ts |
| `OPENCODE_DISABLE_CHANNEL_DB` | db.ts |
| `OPENCODE_SKIP_MIGRATIONS` | db.ts |
| `OPENCODE_SERVER_PASSWORD` | sidecar.ts |
| `OPENCODE_SERVER_USERNAME` | sidecar.ts |

注：Desktop 包已局部使用 `OCTO_DB`（`src/main/index.ts:91`）而非 `OPENCODE_DB`。

## 第五类：配置文件名（8 处）

| 文件 | 行 | 当前 | 说明 |
|------|---|------|------|
| `src/config/config.ts` | 433-434 | `"opencode.json"` / `"opencode.jsonc"` | 全局配置文件名 |
| `src/config/config.ts` | 439-440 | `"opencode.json"` / `"opencode.jsonc"` | octoConfig 目录下也查找 |
| `src/config/config.ts` | 612 | `"opencode.json", "opencode.jsonc"` | 目录级配置 |
| `src/config/config.ts` | 709 | `"opencode.json", "opencode.jsonc"` | 全局写入 |
| `src/config/config.ts` | 336 | `"opencode.json"` | 配置查找优先级 |
| `src/cli/cmd/mcp.ts` | 404-407 | `"opencode.json"` | MCP 配置路径 |

## 第六类：项目目录 `.opencode`（12 处）

| 文件 | 内容 |
|------|------|
| `src/config/paths.ts:30,36` | `targets: [".octo", ".opencode"]` |
| `src/config/agent.ts:137` | `"/.opencode/agent/"` |
| `src/config/command.ts:46` | `"/.opencode/command/"` |
| `src/config/config.ts:611` | `dir.endsWith(".opencode")` |
| `src/agent/agent.ts:150` | `".opencode", "plans"` |
| `src/session/session.ts:349` | `".opencode", "plans"` |
| `src/plugin/install.ts:337` | `".opencode"` |
| `src/installation/index.ts:174` | `".opencode", "bin"` |
| `src/cli/cmd/tui/config/tui.ts:174,177,492` | `.opencode` 检测 |
| `src/cli/cmd/tui/plugin/runtime.ts:212,214,796` | `.opencode` 路径 |
| `src/file/ripgrep.ts:440` | `.opencode` 忽略 |
| `bin/opencode:29` | `.opencode` 缓存 |

## 第七类：Provider ID "opencode"（15 处）

`"opencode"` 作为 provider 标识符，涉及：
- `src/provider/schema.ts` — ProviderID schema
- `src/provider/provider.ts` — 8 处条件判断
- `src/provider/transform.ts` — 2 处
- `src/session/llm.ts` — 2 处
- `src/v2/model.ts` — 1 处
- `src/tool/registry.ts` — 1 处

**不建议修改**：改名会破坏现有用户配置兼容性。

## 不需要改的（排除项）

| 类型 | 原因 |
|------|------|
| `https://opencode.ai` URLs | 外部网站 |
| `@opencode-ai/*` npm scope | 包名 |
| `anomalyco/opencode` GitHub repo | 仓库名 |
| `ai.opencode.desktop.*` 旧 App ID | 仅用于迁移检测 |
| `OPENCODE_API_KEY` env var | 外部 API key |
| `opencode.ai` 品牌域名 | 不属于数据路径 |
| `bin/opencode` CLI 入口 | 独立于数据路径 |
| i18n 中的 "opencode" 文字 | 品牌名 |

## 修改方案总结

| 方案 | 修改数量 | 影响范围 |
|------|---------|---------|
| **最小改动**（仅数据路径 + DB 文件名） | 19 处 | 数据目录 `octo/`，DB 文件 `octo.db` |
| **中等改动**（+ 配置文件名） | 27 处 | 新增 `octo.json` 配置文件 |
| **全量改名**（+ 环境变量 + 目录 + Provider ID） | 100+ 处 | 破坏向后兼容性 |

## 数据迁移风险

改动后新路径下没有旧数据，现有用户的：
- `opencode.db` 数据库
- `auth.json` 认证信息
- `mcp-auth.json` MCP 认证
- `snapshot/` 快照
- `skills.json` 技能配置

全部需要迁移。建议方案：
1. 启动时检测旧目录 `opencode/` 存在但新目录 `octo/` 不存在
2. 自动 `fs.rename("opencode", "octo")` 或提示用户确认迁移