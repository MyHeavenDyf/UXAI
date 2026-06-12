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
