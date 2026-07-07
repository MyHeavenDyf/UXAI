# Skill 系统

## 概述

内置 agent skill 自动发现、skills.json 配置文件控制启用/禁用、统一 skill 目录、刷新 API。

## 提交记录

### `c3b80dc0e` 基础修改 — Skill 发现扩展

- `src/skill/index.ts`：添加 `getMany` 方法，使用 `import.meta.dir` / `__dirname` 自动发现 `src/agent/skills/` 中的内置 agent skill

### `0eb3e11d3` 内置 skills 扫描添加 scope 参数防止打包后 ENOENT 崩溃

- `src/skill/index.ts`：`scan()` 添加 `{ scope: "builtin" }` 参数，打包版本中 `import.meta.dir` 指向不存在路径时优雅降级而非崩溃

### `e41534485` skills.json 配置/部署

- `script/build-node.ts`：构建时自动生成 `skills.json`，读取所有 `SKILL.md` 提取 description 和 import 字段
- `src/skill/index.ts`：读取 `~/.config/octo/skills.json`，过滤 `import` 为 `false` 的 skill
- Electron：`skills.json` 作为 extraResource 打包，首次运行部署到 `~/.config/octo/`

### `826bd5475` 统一 Skill 目录 + skill 刷新 API

- `script/build-node.ts`：`skills.json` 添加 `type` 字段（从路径提取 agent 名称）
- `src/skill/index.ts`：skill 发现已从打包路径改为统一 `octoConfig/skill/` 目录，添加 `refresh()` 方法使缓存失效
- `src/server/routes/instance/httpapi/groups/instance.ts` 和 handlers：添加 `POST /skill/refresh` 端点
- `src/server/routes/instance/index.ts`：Hono 后端添加 `POST /skill/refresh` 路由

### `e8ee2dc0a` 预制 skill 默认关闭

- `script/build-node.ts`：`skills.json` 中默认 `import` 值从 `true` → `false`（预构建 skill 默认禁用）

### `dev_dyf` skills.json 修改后全局即时生效（方案 B）

**背景**：用户在技能库 UI 切换 skill 的 import 开关后，新建 session 仍然使用旧 skill 列表，必须重启才能生效。

**根因**：
- 前端 `fetch(${url}/skill/refresh)` 不带 `x-opencode-directory` header（`packages/app/octoapp/components/skills-content.tsx:135,168`）
- 后端 middleware `directory` 回落链 `query → header → process.cwd()`（`packages/opencode/src/server/routes/instance/middleware.ts:9`），最终解析为 Electron 启动 CWD，**不是用户实际工作的项目目录**
- `Skill.refresh` → `InstanceState.invalidate(discovered/state)` 只 invalidate 当前 directory 这一个 key（`packages/opencode/src/effect/instance-state.ts:78-81`）
- 用户项目目录的 Skill 缓存从未被清，`SystemPrompt.skills`（`packages/opencode/src/session/system.ts:65-77`）拿到的仍是旧 `skill.available(agent)` 结果
- 同样 `Command.state` 也缓存了 skill（`packages/opencode/src/command/index.ts:147-158`），且 `Skill.refresh` 完全不通知 Command 失效

**修改**（让 `/skill/refresh` 成为"全局生效"语义，因为 skills.json 本身就是全局配置）：
- `packages/opencode/src/effect/instance-state.ts`：新增 `invalidateAll`，包装 `ScopedCache.invalidateAll`，一次清掉所有已缓存 directory 的 entry
- `packages/opencode/src/skill/index.ts`：`Skill.refresh` 改用 `InstanceState.invalidateAll(discovered)` + `invalidateAll(state)`，替代单 key `invalidate`
- `packages/opencode/src/command/index.ts`：`Command` Interface 新增 `refresh()` 方法，实现用 `InstanceState.invalidateAll(state)`；Command.state 派生自 `skill.all()`，必须同步刷新否则 slash command 残留 / 缺失
- `packages/opencode/src/server/routes/instance/index.ts` 和 `httpapi/handlers/instance.ts`：`/skill/refresh` 两个处理器在 `skill.refresh()` 后追加 `command.refresh()`

**为什么不走前端传 directory 的方案 A**：skills.json 是 `~/.config/octo/skills.json` 全局配置，影响所有 instance。即便前端正确传了当前项目目录，用户切换到另一个项目目录时缓存仍会读到旧值。方案 B 一处 refresh 全部 directory 生效，符合配置语义。

### `dev_dyf` 修复 skill 目录递归扫描导致 type 丢失

**问题**：用户自定义 skill 目录下存在 `dist/semiconductor-component-skill/SKILL.md` 副本时，`discoverSkills()` 用 `**/SKILL.md` 递归扫描会同时命中两个文件。由于 `add()` 并发执行，dist 下的文件可能先被处理，其 `skillDir`（`semiconductor-component-skill`）在 `typeMap` 中查不到 type，导致 skill.type 为 `undefined`，被 `available()` 过滤掉，系统提示词中不注入。

**根因**：
- `discoverSkills()` 对 `octoConfig/skill/` 使用 `**/SKILL.md` 扫描，会递归进入 `dist/`、`node_modules/` 等子目录
- `add()` 并发执行（`concurrency: "unbounded"`），两个同名 SKILL.md 谁先到不确定
- 先到的路径的 `skillDir` 决定了最终的 `type`，如果 typeMap 中不存在则为 undefined
- `available()` 中 `!skill.type` 硬过滤，没有 type 的 skill 不注入任何 agent 的系统提示词
- `add()` 去重时只打印 warn 不覆盖，即使后到的路径能正确匹配 type 也无济于事

**修改**：
- `packages/opencode/src/skill/index.ts`：`octoConfig/skill/` 扫描 pattern 从 `**/SKILL.md` 改为 `*/SKILL.md`，只匹配一层子目录（skill-name/SKILL.md）
- `packages/opencode/src/skill/index.ts`：`add()` 去重时，如果已有 entry 缺少 type，从新匹配的路径补充 type 字段
