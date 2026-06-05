# 5月11日 Provider 替换为自建 Octo Agent

**日期**: 2026-05-11
**分支**: dev

---

## 一、目标

将 opencode Provider 的默认免费模型替换为自建 Octo Agent 模型服务，要求：

- 只显示 4 个预配置模型：GLM-5、MiniMax-M2.5、MiniMax-M2.5-W8A8、Qwen3.5-27B-Claude-4.6
- 所有模型 API 请求发往 `http://octoai-llm.ucd.huawei.com/v1`
- 用户需填写 API Key 后才能使用，Key 保存到全局配置文件持久化
- 桌面端设置页可配置/修改/断开 Octo Agent 的 API Key
- 不影响用户自行添加自定义 Provider 的能力

---

## 二、修改文件清单

### `packages/opencode/src/provider/provider.ts`

**修改点 A — opencode custom loader（约 line 160-216）**

替换 opencode provider 的 custom loader 逻辑：

- 旧逻辑：无 Key 时保留免费模型（cost.input === 0），设置 `apiKey: "public"`
- 新逻辑：固定替换为 4 个自建模型，使用 `createModel()` 辅助函数构建完整的 Model 对象

```typescript
// 关键改动：
input.name = "Octo Agent"

const createModel = (id: string, name: string): Model => ({
  id: ModelID.make(id),
  providerID: ProviderID.make("opencode"),
  name,
  api: {
    id,
    url: "http://octoai-llm.ucd.huawei.com/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  status: "active",
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 4096 },
  capabilities: { temperature: true, reasoning: false, attachment: true, toolcall: true, ... },
  // ... 其他必填字段
})

input.models = {
  "GLM-5": createModel("GLM-5", "GLM-5"),
  "MiniMax-M2.5": createModel("MiniMax-M2.5", "MiniMax M2.5"),
  "MiniMax-M2.5-W8A8": createModel("MiniMax-M2.5-W8A8", "MiniMax M2.5 W8A8"),
  "Qwen3.5-27B-Claude-4.6": createModel("Qwen3.5-27B-Claude-4.6", "Qwen3.5 27B Claude 4.6"),
}

return { autoload: true, options: {} }
```

关键设计决策：
- 始终 `autoload: true`，无论是否有 Key，Provider 都显示
- 无 Key 时 `options: {}`（不设置 `apiKey`），resolveSDK 会因缺少 key 而失败，引导用户输入
- 有 Key 时同样 `options: {}`，由 resolveSDK 从 `provider.key`（auth store）或 `provider.options.apiKey`（config）获取

**修改点 B — 默认模型优先级（约 line 1763）**

```typescript
// 旧：
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

// 新：只保留 Octo Agent 的 4 个模型，排序适配 sortBy "desc" 方向（索引越大优先级越高）
const priority = ["MiniMax-M2.5-W", "Qwen3.5", "GLM-5", "MiniMax-M2.5"]
```

`sort()` 使用 remeda `sortBy` 配合 `"desc"` 方向，索引高的排在前面。因此最高优先级的 `MiniMax-M2.5` 放在最后（index 3）。`"MiniMax-M2.5-W"` 用于区分 `MiniMax-M2.5-W8A8`（匹配 W 后缀变体）与 `MiniMax-M2.5`（精确匹配基础版）。

---

### `packages/opencode/src/server/routes/instance/provider.ts`（Hono 后端）

简化 `/provider` API handler，只返回已连接的 provider，不再从 ModelsDev 加载全量 118 个 provider。

---

### `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`（HttpApi 后端）

同上简化，与 Hono 后端保持一致。

---

### `packages/app/octoapp/components/settings-providers.tsx`

**移除 opencode 过滤器：**

```typescript
// 旧：过滤掉没有付费模型的 opencode
.filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))

// 新：直接返回所有已连接的 provider
const connected = createMemo(() => providers.connected())
```

**新增 Octo Agent 配置 UI：**

- `hasApiKey(providerID)` — 检查全局配置中是否已有 API Key
- `disconnectOpencode()` — 断开时同时清除 auth store 和全局配置中的 apiKey
- 已连接区域针对 opencode 显示：
  - 无 Key → 显示"连接"按钮
  - 有 Key → 显示"编辑"和"断开连接"按钮
  - 点击按钮打开 `DialogConnectProvider`

---

### `packages/app/octoapp/components/dialog-connect-provider.tsx`

**修改 `ApiAuthView.handleSubmit`：**

```typescript
// opencode provider 保存 API Key 到全局配置文件而非 auth store
if (props.provider === "opencode") {
  await globalSync.updateConfig({
    provider: { opencode: { options: { apiKey } } },
  })
} else {
  // 其他 provider 保持原逻辑（auth store）
  await globalSDK.client.auth.set({ providerID, auth: { type: "api", key } })
}
```

**替换 opencode 描述文字：**

```typescript
// 旧：显示 OpenCode Zen 相关说明和链接
// 新：显示 Octo Agent 自建服务说明
<Match when={provider().id === "opencode"}>
  <div>{language.t("provider.connect.octoAi.description")}</div>
</Match>
```

---

### `packages/app/octoapp/i18n/zh.ts` / `en.ts`

新增 i18n key：

| Key | 中文 | English |
|-----|------|---------|
| `provider.connect.octoAi.description` | Octo Agent 提供自建的高性能 AI 模型服务，输入你的 API 密钥即可开始使用。 | Octo Agent provides self-hosted high-performance AI model services. Enter your API key to get started. |

---

## 三、不需要修改的文件

| 文件 | 原因 |
|------|------|
| `config/provider.ts` | Schema 已支持 `options.apiKey` |
| `provider/transform.ts` | OpenAI-compatible 走默认逻辑 |
| `provider/auth.ts` | 已支持 API Key 认证 |
| `auth/index.ts` | 已支持 key 存储 |
| `session/llm.ts` | 通用调用逻辑 |
| 用户全局配置 `~/.config/opencode/opencode.json` | 用户配置文件，代码不直接修改 |

---

## 四、API Key 持久化流程

```
用户首次使用（无 Key）:
  1. Octo Agent 显示在"已连接"provider 列表
  2. 用户点击"连接" → DialogConnectProvider 弹出 API Key 输入框
  3. 输入 Key → globalSync.updateConfig() 保存到 ~/.config/opencode/opencode.json
  4. 保存格式: { "provider": { "opencode": { "options": { "apiKey": "sk-xxx" } } } }
  5. 服务端重载 → custom loader 检测到 config.apiKey → ok=true → provider 正常加载
  6. resolveSDK 使用 config 中的 apiKey 发起请求

用户修改 Key:
  1. 设置 → Providers → Octo Agent → 点击"编辑"
  2. DialogConnectProvider 弹出，输入新 Key
  3. updateConfig() 覆盖旧值

用户断开:
  1. 设置 → Providers → Octo Agent → 点击"断开连接"
  2. 清除 auth store + 清除 config 中的 apiKey
  3. 服务端重载 → 无 Key → provider 显示但模型不可用
```

---

## 五、验证结果

- 类型检查: `bunx tsgo --noEmit` opencode + app 包均通过
- 构建: `bun script/build-node.ts` 成功
- API 验证: `/provider` 端点返回 Octo Agent + 4 个模型，API URL 均为 `http://octoai-llm.ucd.huawei.com/v1`
- 用户自定义 provider（zhipu/myprovider 等）不受影响
- 桌面端测试: Octo Agent 显示在"已连接"区域，可配置 API Key
