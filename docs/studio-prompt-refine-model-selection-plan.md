# Studio Prompt Refine 模型选择改造方案

## 1. 背景

Studio 的 prompt refine 目前没有前端模型选择入口。进入 LLM refine 时，后端会在 `packages/opencode/src/studio/studio-service.ts` 中自动选择模型。

当前问题是：`packages/opencode/api.json` 只是本地 provider/model 预设文件，里面存在的模型不代表当前用户环境一定已经由后台开启。比如当前环境里：

- 设置页中 `bpit` provider 下没有展示 `Qwen3.5-27B-Claude-4.6`。
- 说明该模型当前没有被后台启用。
- 但 Studio prompt refine 自动选模型时仍可能从本地 `api.json` 命中它。
- 最终请求时 providerID 是 `bpit`，modelID/apiID 却是后台未开启的 `Qwen3.5-27B-Claude-4.6`，因此接口返回 404。

所以这不是 provider 不可用，也不是 `bpit` 整体不可用，而是 Studio 把“本地预设存在”误当成了“当前设置中可用”。

## 2. 目标

Studio prompt refine 选模型时，必须以当前设置页同源的可用模型列表为准：

```text
已连接 provider
-> 未 disabled
-> 模型存在于当前设置页同源的可用模型列表
-> 才能作为 prompt refine 候选
```

其中：

- `api.json` 只作为本地兜底配置。
- 远端 models api 存在时，远端返回的模型列表是权威来源。
- 设置页没有展示的远端 provider 模型，Studio prompt refine 不应该自动选中。
- 如果没有可用 refine 模型，prompt refine 走已有 fallback，不阻塞最终图片/视频生成流程。

## 3. 改造边界

本次尽量只修改 Studio 相关文件，不改 `packages/opencode/src/plugin/model-headers.ts`。

不改 `model-headers.ts` 的原因：

- `model-headers.ts` 是 provider/chat 请求头注入层，当前负责配置 models api headers、读取远端 api、修正 provider url、注入模型请求 headers。
- 如果在里面新增“模型是否启用”的业务判断，会把 Studio prompt refine 的选择逻辑放到共享插件层。
- provider、session、design、chat 等模块都可能间接受影响，风险比本需求需要的范围更大。

因此本方案采用：

```text
前端 Studio 使用设置页同源的 useModels() 可用模型列表
-> 发起 Studio generation 时带给后端
-> 后端 Studio prompt refine 只在这个列表内选模型
```

这样可以把改动限制在 Studio 前端请求、Studio 路由 schema、Studio service 模型选择逻辑内。

## 4. 当前相关逻辑

### 4.1 前端设置页同源模型列表

文件：

```text
packages/app/octoapp/context/models.tsx
```

当前 `useModels()` 已经维护了模型列表：

- `models.remote.api`：远端 models api 数据。
- `models.list()`：当前前端根据 provider 连接状态和 models api 得到的基础模型列表。
- `models.visible(model)`：叠加用户个性化显示/隐藏偏好后的最终可见判断。

在远端模式下，`available()` 的来源是：

```ts
modelsApiListForProviders(api, connected)
```

这意味着，远端 provider 的模型来自后台 models api，而不是单纯来自本地 `api.json`。

### 4.2 Studio 前端请求

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

当前 `createStudioGeneration()` 已经会带：

```ts
...modelsApiHeaders()
```

这可以让后端知道 models api 地址和 token。

但现在请求 body 里没有携带“当前前端设置页同源的可见模型快照”。因此后端 `studio-service.ts` 只能通过 provider runtime 自己选模型，仍可能读到本地预设中的关闭模型。

### 4.3 Studio 后端模型选择

文件：

```text
packages/opencode/src/studio/studio-service.ts
```

当前选择优先级大致是：

```text
1. session.model
2. connected provider 中的默认/第一个模型
3. provider.defaultModel()
```

问题点：

- `Provider.defaultModelIDs(providers)` 会按 provider 内的模型集合排序。
- provider 内的模型集合可能包含本地 `api.json` 预设模型。
- 所以它可能选中后台已关闭、设置页不展示的模型。
- `provider.getModel()` 只能验证“本地 provider 对象里是否存在该模型”，不能验证“后台是否启用该模型”。

## 5. 具体修改方案

## 5.1 修改 `packages/app/octoapp/pages/studio-page.tsx`

### 5.1.1 引入 `useModels`

在 Studio 页面中引入：

```ts
import { useModels } from "@/context/models"
```

在组件内部获取：

```ts
const models = useModels()
```

具体放置位置应跟当前页面里 `useProviders()`、`useGlobalSDK()`、`useServer()` 等 context hook 保持一致。

### 5.1.2 构造 Studio prompt refine 可见模型快照

新增局部 helper：

```ts
function studioPromptRefineModels() {
  return models
    .list()
    .filter((model) =>
      models.visible({
        providerID: model.provider.id,
        modelID: model.id,
      }),
    )
    .map((model) => ({
      providerID: model.provider.id,
      modelID: model.id,
    }))
}
```

说明：

- 这里使用 `models.visible()` 过滤，而不是直接使用 `models.list()`。
- `models.list()` 只代表“当前 provider 连接状态 + models api 后台启用列表”得到的基础模型集合。
- `models.visible()` 会继续叠加用户在本系统里的个性化显示/隐藏偏好。
- Design 等有模型选择 UI 的模块，其可选模型列表也应该遵循用户偏好；Studio 虽然没有模型选择 UI，但它的隐式 LLM 调用也不应该绕过用户设置。
- 因此 Studio prompt refine 的候选模型语义应是：

```text
后台启用
+ provider 已连接
+ 用户设置中可见
= Studio prompt refine 可选模型
```

### 5.1.3 在 Studio generation 请求体里增加字段

在 `createStudioGeneration()` 的 `fetch()` body 中增加：

```ts
promptRefineModels: studioPromptRefineModels(),
```

修改后请求体包含：

```ts
body: JSON.stringify({
  sessionID: input.sessionID,
  capability: input.capability,
  prompt: input.text,
  displayPrompt: input.displayPrompt,
  detailPrompt: input.detailPrompt,
  refinedPrompt: input.refinedPrompt,
  effectivePrompt: input.effectivePrompt,
  promptRefineModels: studioPromptRefineModels(),
  ...
})
```

该字段只用于 Studio prompt refine 的 LLM 选型，不参与最终图片/视频生成接口参数。

## 5.2 修改 `packages/opencode/src/server/routes/instance/studio.ts`

### 5.2.1 扩展 Hono route schema

在 `StudioGenerationInput` 中增加：

```ts
promptRefineModels: z
  .array(
    z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
  )
  .optional(),
```

### 5.2.2 保持 headers 配置逻辑

当前该 route 已经有：

```ts
configureModelsApiHeaders(Object.fromEntries(c.req.raw.headers.entries()))
```

保留这段逻辑。

虽然本方案主要依赖前端传入的 `promptRefineModels`，但 headers 仍然需要保留，因为：

- LLM 请求过程中 `ModelHeadersPlugin` 仍需要根据当前模型和远端 api 注入模型 headers。
- `modelsApiProviderUrl()` 仍可能需要根据远端 api 修正 provider url。

## 5.3 修改 `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

在 `StudioGenerationPayload` schema 中增加：

```ts
promptRefineModels: Schema.optional(
  Schema.Array(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
),
```

这样 HttpApi 调用 Studio generation 时也支持同样字段。

## 5.4 修改 `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

在调用 `createGeneration()` 时透传：

```ts
promptRefineModels: ctx.payload.promptRefineModels
  ? [...ctx.payload.promptRefineModels]
  : undefined,
```

同时保留已有：

```ts
configureModelsApiHeaders((yield* HttpServerRequest.HttpServerRequest).headers)
```

原因同 Hono route：prompt refine 的模型请求仍需要 models api headers 注入能力。

## 5.5 修改 `packages/opencode/src/studio/studio-service.ts`

### 5.5.1 扩展请求类型

给 `StudioGenerationRequest` 增加字段：

```ts
promptRefineModels?: Array<{
  providerID: string
  modelID: string
}>
```

该字段不需要持久化到 tool input，也不需要传给最终图片/视频生成接口。

### 5.5.2 新增模型 key helper

新增 Studio 局部 helper：

```ts
function studioPromptRefineModelKey(input: { providerID: string; modelID: string }) {
  return `${input.providerID}:${input.modelID}`
}
```

### 5.5.3 新增 enabled set helper

新增：

```ts
function studioPromptRefineEnabledModels(input: StudioGenerationRequest) {
  if (!input.promptRefineModels?.length) return
  return new Set(input.promptRefineModels.map(studioPromptRefineModelKey))
}
```

说明：

- 返回 `undefined` 表示前端没有提供可见模型快照，此时保持旧的兼容 fallback 逻辑。
- 返回 `Set` 表示前端提供了权威候选列表，后端选模型必须受它约束。

### 5.5.4 新增 enabled 判断 helper

新增：

```ts
function isStudioPromptRefineModelEnabled(
  providerID: string,
  modelID: string,
  enabledModels?: Set<string>,
) {
  if (!enabledModels) return true
  return enabledModels.has(studioPromptRefineModelKey({ providerID, modelID }))
}
```

### 5.5.5 修改 session.model 选择

当前 `sessionPromptRefineModel(session)` 只要 session 里有 model 就返回。

修改成：

```ts
function sessionPromptRefineModel(
  session: typeof SessionTable.$inferSelect,
  enabledModels?: Set<string>,
): StudioPromptRefineModelCandidate | undefined {
  if (!session.model) return
  if (
    !isStudioPromptRefineModelEnabled(
      session.model.providerID,
      session.model.id,
      enabledModels,
    )
  ) {
    return
  }
  return {
    providerID: ProviderID.make(session.model.providerID),
    modelID: ModelID.make(session.model.id),
    source: "session",
  }
}
```

这样可以避免 session 中残留一个后台已关闭模型时继续误用。

### 5.5.6 修改 connected provider 模型选择

当前：

```ts
function firstStudioPromptConnectedModel(
  providers: Record<string, Provider.Info>,
  disabledProviders: Set<string>,
)
```

修改成：

```ts
function firstStudioPromptConnectedModel(
  providers: Record<string, Provider.Info>,
  disabledProviders: Set<string>,
  enabledModels?: Set<string>,
)
```

内部选择模型时，每个候选都必须先经过：

```ts
isStudioPromptRefineModelEnabled(provider.id, model.id, enabledModels)
```

关键点：

- `Provider.defaultModelIDs(providers)` 可以保留，但只能作为 provider 内候选顺序参考。
- 如果 default model 不在 `enabledModels` 中，必须跳过。
- 然后再找该 provider 下第一个在 `enabledModels` 中的模型。
- 如果 `enabledModels` 存在且该 provider 下没有任何 enabled model，则继续下一个 provider。

示例逻辑：

```ts
const configured = defaults[provider.id]
if (
  configured &&
  provider.models[configured] &&
  isStudioPromptRefineModelEnabled(provider.id, provider.models[configured].id, enabledModels)
) {
  return {
    providerID: ProviderID.make(provider.id),
    modelID: provider.models[configured].id,
  }
}

const model = Object.values(provider.models)
  .sort((left, right) => left.id.localeCompare(right.id))
  .find((item) => isStudioPromptRefineModelEnabled(provider.id, item.id, enabledModels))

if (!model) continue

return {
  providerID: ProviderID.make(provider.id),
  modelID: model.id,
}
```

### 5.5.7 修改 `selectStudioPromptRefineModel`

当前：

```ts
const selectStudioPromptRefineModel = Effect.fn(...)(function* (
  provider,
  session,
  disabledProviders,
) {
  ...
})
```

修改成：

```ts
const selectStudioPromptRefineModel = Effect.fn(...)(function* (
  provider,
  session,
  disabledProviders,
  enabledModels?: Set<string>,
) {
  ...
})
```

内部：

```ts
const sessionModel = sessionPromptRefineModel(session, enabledModels)
```

以及：

```ts
const connectedModel = firstStudioPromptConnectedModel(
  yield* provider.list(),
  disabledProviders,
  enabledModels,
)
```

### 5.5.8 约束 `provider.defaultModel()`

这是最关键的一点。

如果 `enabledModels` 存在，说明前端已经提供了当前设置页同源的可用模型列表，此时不能再无条件 fallback 到 `provider.defaultModel()`。

修改逻辑：

```ts
if (enabledModels) {
  return yield* Effect.fail(
    new Error("No Studio prompt refine model is enabled."),
  )
}

return {
  ...(yield* provider.defaultModel()),
  source: "default",
}
```

外层 `refineStudioPrompt()` 已经有 `try/catch`，失败后会进入 `promptRefineFallback(input, previous)`，不会阻塞最终生成。

这样可以避免：

```text
前端明明传了可用模型列表
-> 后端没有选到
-> 又回到 provider.defaultModel()
-> 再次命中 api.json 中后台关闭的模型
```

### 5.5.9 修改 `refineStudioPrompt()` 调用点

在 `refineStudioPrompt()` 中构造：

```ts
const enabledModels = studioPromptRefineEnabledModels(input)
```

调用：

```ts
const selected = yield* selectStudioPromptRefineModel(
  provider,
  session,
  disabledProviders,
  enabledModels,
)
```

### 5.5.10 日志增强

在 `[studio.service] prompt refine model` 中增加：

```ts
enabledModelCount: enabledModels?.size,
```

如果最终因为没有 enabled model 进入 fallback，日志会表现为：

```text
[studio.service] prompt refine failed {
  error: Error: No Studio prompt refine model is enabled.
}
```

这类失败是可接受的，因为它只影响 prompt refine，不影响最终生成。

可选增加跳过日志：

```ts
console.log("[studio.service] prompt refine skip model", {
  providerID: provider.id,
  modelID: model.id,
  reason: "not in studio prompt refine enabled model list",
})
```

但为了避免日志过多，第一版可以只打 `enabledModelCount` 和最终选择结果。

## 6. 选择优先级

改造后选择优先级：

```text
1. session.model
   - 如果前端传了 promptRefineModels，必须在该列表内
   - 且 provider.getModel() 能解析成功

2. connected provider 中的候选模型
   - provider 未 disabled
   - provider 已连接
   - 如果前端传了 promptRefineModels，model 必须在该列表内
   - 优先 provider default model，但 default model 不在 enabled list 时跳过
   - 再选择该 provider 下第一个 enabled model

3. provider.defaultModel()
   - 只有前端没有传 promptRefineModels 时才允许使用

4. promptRefineFallback
   - 前端传了 promptRefineModels，但没有任何可用模型
   - 或模型解析/调用失败
```

## 7. 为什么不用 `model-headers.ts` 做 enabled 判断

可以做，但本次不推荐。

如果在 `model-headers.ts` 中导出类似：

```ts
isModelsApiModelEnabled(providerID, modelID)
```

确实可以让后端直接根据远端 api 判断模型是否开启。但这会带来几个问题：

- 需要暴露当前模块内部的 `loadApi()` 或缓存数据。
- 共享插件层开始承担 Studio 的模型选择业务语义。
- 其他模块未来也可能误用这个 helper，导致 provider/chat/design 行为被间接耦合。
- 如果远端 api 请求失败，helper 的 fallback 语义会变得复杂。

相比之下，Studio 前端已经有设置页同源的模型列表，直接把快照传给 Studio 后端，影响范围最小。

## 8. 兼容性

### 8.1 远端 models api 模式

前端会传 `promptRefineModels`。

后端只在该列表中选择 prompt refine 模型。

关闭模型即使存在于本地 `api.json`，也不会被选中。

### 8.2 本地 models api 模式

`models.list()` 会来自本地 provider 列表。

此时 `promptRefineModels` 仍然会被传入，行为等价于“当前本地可用模型列表”。

### 8.3 旧客户端或异常场景

如果请求里没有 `promptRefineModels`：

- 后端保持旧逻辑。
- 允许 fallback 到 `provider.defaultModel()`。
- 避免旧客户端直接失效。

### 8.4 没有可用 LLM

如果前端传了 `promptRefineModels`，但列表为空，或后端没有选到模型：

- prompt refine 失败。
- 进入 `promptRefineFallback()`。
- 最终图片/视频生成继续执行。

## 9. 不影响的能力

本方案只影响 Studio prompt refine 的 LLM 选型，不影响：

- 图片生成最终接口。
- 视频生成最终接口。
- 图片编辑、抠图、扩图、融合等不走 LLM 的能力。
- Design 模块模型选择。
- Chat/session 常规 LLM 调用。
- provider 设置页展示逻辑。
- `model-headers.ts` 的请求头注入逻辑。

## 10. 验证点

### 10.1 bpit 远端关闭模型不再被选中

环境：

- provider 有 `bpit`。
- 本地 `api.json` 中存在 `Qwen3.5-27B-Claude-4.6`。
- 远端 models api / 设置页中 `bpit` 不展示 `Qwen3.5-27B-Claude-4.6`。

期望：

- Studio prompt refine 不再选择 `Qwen3.5-27B-Claude-4.6`。
- 日志中 `[studio.service] prompt refine model` 的 `selectedModelID` 应该是设置页中 `bpit` 下可见的模型，例如 `Qwen-V35-27B-VL`。
- 不再因为关闭模型出现 404。

### 10.2 前端候选列表为空

期望：

- prompt refine 走 fallback。
- 最终生成继续。
- 不调用关闭模型。

### 10.3 旧客户端没有传 `promptRefineModels`

期望：

- 保持旧逻辑。
- 不破坏已有调用。

### 10.4 session.model 是关闭模型

期望：

- 如果 `session.model` 不在 `promptRefineModels` 中，跳过。
- 继续尝试 connected provider 中的 enabled model。

### 10.5 provider default model 是关闭模型

期望：

- 如果 default model 不在 `promptRefineModels` 中，跳过。
- 不回退到 `provider.defaultModel()`。
- 如果没有其他候选，则 prompt refine fallback。

## 11. 实施顺序

1. 修改 `packages/app/octoapp/pages/studio-page.tsx`，引入 `useModels()` 并在 Studio generation 请求体里传 `promptRefineModels`。
2. 修改 `packages/opencode/src/server/routes/instance/studio.ts`，扩展 Hono schema。
3. 修改 `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`，扩展 HttpApi schema。
4. 修改 `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`，透传字段。
5. 修改 `packages/opencode/src/studio/studio-service.ts`，增加 enabled model 过滤并约束 `defaultModel()` fallback。
6. 在 `packages/app` 运行 `bun typecheck`。
7. 在 `packages/opencode` 运行 `bun typecheck`。

## 12. 风险与注意事项

- `promptRefineModels` 只作为一次请求的快照，不持久化到数据库。
- 不要把该字段写入 `studioToolInput()`，否则会污染历史消息和重新编辑逻辑。
- 不要传给图片/视频最终生成接口。
- 如果后续 Studio 增加 LLM 模型选择 UI，可以在这个字段基础上增加“显式指定模型”优先级。
- 如果后续希望所有模块统一判断“后台启用模型”，再单独设计 `model-headers.ts` 或 provider 层公共能力，不能在这次 Studio 修复里顺手重构。
