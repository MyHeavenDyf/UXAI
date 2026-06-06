# 配置路径与品牌更新

## 概述

添加 `.octo/` 配置目录支持，禁用 Cloudflare 依赖功能，品牌从 OpenCode 更新为 Octo AI。

## 提交记录

### `e41534485` skills.json 配置/部署、octo 配置优先级

- `src/config/config.ts`：`globalConfigFile()` 优先查找 `Global.Path.octoConfig`；`loadGlobal()` 从两个目录加载（opencode 低优先级、octo 高优先级）
- `src/config/paths.ts`：添加 `Global.Path.octoConfig`，`.octo` 添加到 `AppFileSystem.up()` 目标
- `src/config/agent.ts`：pattern 数组添加 `/.octo/agent/` 和 `/.octo/agents/`

### `c2a3b457a` 禁用 Cloudflare 连接、Octo AI 品牌更新

- `src/server/routes/ui.ts`：禁用 Cloudflare Web UI 代理
- `src/server/shared/ui.ts`：禁用 Cloudflare 连接检查
- `src/share/share-next.ts`：禁用分享功能
- `src/cli/upgrade.ts`：禁用自动更新
- `src/command/template/initialize.txt`：品牌 "OpenCode" → "Octo AI"
- `src/session/prompt/` 下所有 provider 提示词（anthropic、beast、codex、copilot-gpt-5、default、gemini、gpt、kimi、trinity）：品牌更新
- `src/tool/lsp.txt`：品牌更新

### `2a8b36090` 基础修改plus — 修复配置优先级

- `src/config/config.ts`：恢复 `opencode.json` 优先于 `octo.json`
- `src/config/agent.ts`：从 agent pattern schema 移除 `octo`
