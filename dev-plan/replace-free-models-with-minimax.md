# 替换免费模型为自建 MiniMax Provider

## 背景

将 opencode Provider 中的免费模型替换为自建模型服务，用户需填写 API Key 后才能使用。不改动现有用户自定义配置能力。

目标配置：
```json
{
  "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "http://octoai-llm.ucd.huawei.com/v1", "apiKey": "" },
  "name": "MiniMax",
  "models": {
    "GLM-5": { "name": "GLM-5" },
    "MiniMax-M2.5": { "name": "MiniMax M2.5" },
    "MiniMax-M2.5-W8A8": { "name": "MiniMax-M2.5-W8A8" },
    "Qwen3.5-27B-Claude-4.6": { "name": "Qwen3.5-27B-Claude-4.6" }
  }
}
```

无 Key 时不加载、引导输入。默认模型优先级：MiniMax-M2.5 最优先。

---

## 现有机制分析

### 免费/无 Key 模式的触发逻辑

**文件**: `packages/opencode/src/provider/provider.ts:160-182`

```typescript
opencode: Effect.fnUntraced(function* (input: Info) {
  // 检查 3 种 Key 来源
  const ok = hasKey || hasAuth || hasConfigKey

  if (!ok) {
    // 无 Key：删除所有付费模型，只留免费模型（cost.input === 0）
    for (const [key, value] of Object.entries(input.models)) {
      if (value.cost.input === 0) continue  // 保留免费的
      delete input.models[key]
    }
  }

  return {
    autoload: Object.keys(input.models).length > 0,
    options: ok ? {} : { apiKey: "public" },
  }
})
```

### 现有免费模型（16个，来自 models-snapshot.js）

```
glm-4.7-free, kimi-k2.5-free, minimax-m2.5-free, ring-2.6-1t-free,
big-pickle, trinity-large-preview-free, glm-5-free, minimax-m2.1-free,
qwen3.6-plus-free, ling-2.6-flash-free, grok-code, mimo-v2-flash-free,
hy3-preview-free, mimo-v2-pro-free, nemotron-3-super-free, mimo-v2-omni-free
```

### 默认模型排序优先级（line 1728）

```typescript
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
```

### Provider 自动加载流程

```
custom loaders 执行:
  │
  ├── autoload: true → Provider 加入活跃列表
  └── autoload: false → 跳过

完整激活管线（按顺序）:
  1. Models database loaded (models.dev snapshot/fetch)
  2. Plugins modify models
  3. Config providers merged (用户 opencode.json)
  4. Environment detection (env vars → provider.key)
  5. Auth store detection (auth.json → provider.key)
  6. Plugin auth loaders
  7. Custom loaders (autoload 评估)        ← 我们修改这里
  8. Config re-applied
  9. Filtering (空模型/黑白名单/alpha/deprecated)
```

### SDK 创建流程 (resolveSDK, line 1413-1554)

```
resolveSDK():
  │
  ├── 合并 provider options + apiKey
  ├── 解析 baseURL
  ├── 查找 BUNDLED_PROVIDERS 中的 @ai-sdk/openai-compatible
  └── createOpenAICompatible({ name, baseURL, apiKey, fetch, headers })
```

---

## 需要修改的文件

### `packages/opencode/src/provider/provider.ts`

**修改点 A — opencode custom loader（line 160-182）**

替换现有 opencode provider 的 custom loader 逻辑：

```typescript
// 现有逻辑（将被替换）：
// - 无Key时保留免费模型 (cost.input === 0)
// - 设置 apiKey: "public" 允许免费使用

// 新逻辑：
opencode: Effect.fnUntraced(function* (input: Info) {
  const env = yield* dep.env()
  const hasKey = iife(() => {
    if (input.env.some((item) => env[item])) return true
    return false
  })
  const ok =
    hasKey ||
    Boolean(yield* dep.auth(input.id)) ||
    Boolean((yield* dep.config()).provider?.["opencode"]?.options?.apiKey)

  // 替换为自建模型
  input.models = {
    "GLM-5": {
      id: "GLM-5",
      name: "GLM-5",
    },
    "MiniMax-M2.5": {
      id: "MiniMax-M2.5",
      name: "MiniMax M2.5",
    },
    "MiniMax-M2.5-W8A8": {
      id: "MiniMax-M2.5-W8A8",
      name: "MiniMax-M2.5-W8A8",
    },
    "Qwen3.5-27B-Claude-4.6": {
      id: "Qwen3.5-27B-Claude-4.6",
      name: "Qwen3.5-27B-Claude-4.6",
    },
  }

  // 覆盖 API 地址
  input.api = { url: "http://octoai-llm.ucd.huawei.com/v1" }

  if (!ok) {
    return {
      autoload: false,  // 无 Key 不加载
      options: {},
    }
  }

  return {
    autoload: true,
    options: {},
  }
}),
```

**修改点 B — 默认模型优先级（line 1728）**

```typescript
// 现有：
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

// 改为：
const priority = ["MiniMax-M2.5", "GLM-5", "Qwen3.5", "gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
```

---

## 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `config/provider.ts` | Schema 已足够通用，支持 options.apiKey |
| `provider/transform.ts` | OpenAI-compatible 走默认逻辑 |
| `provider/error.ts` | 已有通用错误处理 |
| `provider/auth.ts` | 已支持 API Key 认证 |
| `auth/index.ts` | 已支持 key 存储 |
| `session/llm.ts` | 通用调用逻辑 |
| `models-snapshot.js` | custom loader 会覆盖 snapshot 数据 |

---

## 验证步骤

1. **无 Key 测试**: 不设 `OPENCODE_API_KEY`，运行 `bun dev`，确认 opencode Provider 不加载
2. **有 Key 测试**: 设置 `OPENCODE_API_KEY=<key>`，运行 `bun dev`，确认显示 4 个模型
3. **模型调用**: 选择 MiniMax-M2.5 发送消息，确认请求发往 `http://octoai-llm.ucd.huawei.com/v1`
4. **默认模型**: 不选模型直接发消息，确认默认使用 MiniMax-M2.5
5. **配置文件**: 在 `.opencode/opencode.json` 中设置 `provider.opencode.options.apiKey`，确认生效
6. **用户自定义**: 用户配置其他 provider（如 anthropic）不受影响
