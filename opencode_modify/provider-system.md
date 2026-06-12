# Provider 系统

## 概述

替换开源免费模型为自建 Octo AI Provider，后续添加 BPIT Provider，更新模型列表，添加 provider 认证状态过滤。

## 提交记录

### `005415b48` 替换免费模型为自建 Octo AI Provider

- `src/provider/provider.ts`：用 `createModel()` 硬编码 4 个自托管模型（GLM-5、MiniMax-M2.5、MiniMax-M2.5-W8A8、Qwen3.5-27B-Claude-4.6），指向 `http://octoai-llm.ucd.huawei.com/v1`
- Provider 名称设为 "Octo AI"，始终 autoload
- 默认模型优先级：`["MiniMax-M2.5-W", "Qwen3.5", "GLM-5", "MiniMax-M2.5"]`
- `src/server/routes/instance/httpapi/handlers/provider.ts` 和 `provider.ts`（Hono）：简化为只返回已连接 providers

### `8a9101421` 确保预制 opencode provider 在新机器上始终可用

- 新增 `api.json`（51 行）：预置 4 个模型定义作为数据源
- `script/generate.ts`：优先读取本地 `api.json`，再回退到网络
- `src/provider/models.ts`：添加 `ensureOpencode()` 保证 opencode provider 始终存在
- `src/provider/provider.ts`：允许 opencode 在无数据库条目时运行

### `c2a3b457a` 禁用 Cloudflare 连接、修复 provider 断开链接刷新

- `src/provider/models.ts`：添加 `api.json` 回退
- `src/provider/provider.ts`：添加 `api.json` 回退
- 禁用 Cloudflare 依赖功能（分享、代理、自动更新）
- 所有 provider 提示词品牌从 "OpenCode" → "Octo AI"

### `6cc266a50` 更新 opencode 预置模型列表

- `api.json`：移除 GLM-5 和 MiniMax-M2.5-W8A8，新增 DeepSeek-V4-Flash

### `a341ac4e2` 预制 bpit 供应商 + provider connected 状态过滤

- `api.json`：添加 bpit provider（GLM-V5、Qwen-V3-VL-30B-A3B-Instruct、Qwen-V3-VL-32B-Instruct）
- `src/provider/provider.ts`：添加 bpit custom loader（与 opencode 模式相同）
- `src/server/routes/instance/httpapi/handlers/provider.ts` 和 `provider.ts`（Hono）：添加 `hasAuth` 过滤，无 API key 的 provider 不显示为"已连接"

### `5ca0babb0` Octo AI provider 无 API Key 时抛出友好认证错误

- `src/provider/provider.ts`：`resolveSDK` 中添加守卫检查，opencode provider 无 API key 时抛出中文友好 `AuthError`

### `acb2a9c87` 输出限制修改

- `api.json`：所有模型 output token 限制从 4096 → 128000

### `15f55675e` 弱模型输出优化 + output token 上限调至 128k

- `src/provider/transform.ts`：`OUTPUT_TOKEN_MAX` 从 32,000 → 128,000

### `f34dfda3a` 恢复 OUTPUT_TOKEN_MAX 为 32000

- `src/provider/transform.ts`：`OUTPUT_TOKEN_MAX` 从 128,000 → 32,000（128K 导致频繁触发 compaction）

### `b179aea4e` 修复 octo-file-write 类型错误

- `src/server/routes/instance/octo-file-write.ts`：通过 Effect Service 注入调用 `writeWithDirs` 替代直接静态调用
