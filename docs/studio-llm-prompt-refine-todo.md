# Studio LLM 提示词润色待办与实施记录

## 背景

Studio 现在的主生成链路以 `/studio/generations` 为中心，前端提交能力、风格、比例、数量、工具等配置，后端创建 `studio_generation` 记录并驱动 Jimeng 或内部生图服务。

前面讨论的目标不是把 Studio 立即改回旧的 agent tool-call 模式，而是在当前生成链路中增加一个轻量 LLM 步骤，让 LLM 只负责：

- 生成更自然的 assistant 对话文案。
- 根据当前用户输入和最近一次成功生成结果，生成用于生图接口的 `refinedPrompt`。

LLM 不负责：

- 选择生成能力。
- 选择模型或风格。
- 选择比例。
- 选择数量。
- 选择生图工具。
- 处理抠图、变清晰、重绘、扩图等编辑能力。

用户气泡必须始终展示用户原始输入，不能展示 LLM 润色后的 prompt，也不能展示内部拼接用语，例如“延续上一轮画面”。

## 第一阶段目标

第一阶段只处理 `image.generate`。

不处理：

- `image.upscale`
- `image.cutout`
- `image.inpaint`
- `image.outpaint`
- 暂不强制纳入 `video.generate`

原因：

- 编辑类能力输入更确定，主要依赖源图、蒙版、扩图参数或编辑器状态。
- 编辑类能力不需要模型、比例、数量参与提示词润色。
- 当前最需要提升的是普通文生图的多轮理解能力。

## 已实施过的方案要点

> 本节记录前面已经设计并尝试实施过的内容，后续如代码被分支覆盖，可按此恢复。

### 1. 增加 prompt refine 内部结果

后端新增内部结构：

```ts
type StudioPromptRefineResult = {
  assistantText: string
  refinedPrompt: string
  effectivePrompt: string
  fallback?: boolean
  raw?: unknown
}
```

同时在内部请求中保存：

```ts
type StudioGenerationPromptInput = StudioGenerationRequest & {
  refinedPrompt?: string
  effectivePrompt?: string
  promptRefineFallback?: boolean
}
```

字段语义：

- `prompt`：用户原始输入，用于用户气泡、前端展示、结果卡标题、再次生成默认文案。
- `assistantText`：给用户看的自然回复。
- `refinedPrompt`：LLM 润色后的画面描述。
- `effectivePrompt`：实际传给生图 provider 的 prompt，通常等于 `refinedPrompt`，失败时回退到旧逻辑。

### 2. 只让 `image.generate` 调用 LLM

判断逻辑：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate") return false
  return input.extra?.skipPromptRefine !== true
}
```

非 `image.generate` 能力直接走 fallback，不调用 LLM。

### 3. LLM 输入只保留画面相关上下文

为了避免 LLM 把模型、比例、数量等配置写进最终 prompt，传给 LLM 的输入应避免包含这些配置字段。

建议输入：

```ts
{
  userPrompt: string
  hasReferenceImages: boolean
  previousTurn?: {
    userText: string
    refinedPrompt?: string
    imageUrls: string[]
  }
}
```

注意：

- `styleModel`、`aspectRatio`、`count`、`imageTool` 不交给 LLM 决策。
- 如果后续需要让 LLM 感知 UI 选择，可以作为只读上下文传入，但必须继续要求不得写入 `refinedPrompt`。

### 4. LLM 输出使用结构化 JSON

期望输出：

```json
{
  "assistantText": "好的，我会保留上一张图的主体氛围，把场景调整成更明亮的清晨。",
  "refinedPrompt": "保留上一轮画面中的主体、构图和氛围，将场景调整为清晨，柔和阳光穿过薄雾，画面干净明亮，电影感光影，细节丰富"
}
```

约束：

- `assistantText` 使用中文，简短自然。
- `assistantText` 不暴露模型、比例、数量、工具名。
- `refinedPrompt` 只描述画面内容。
- `refinedPrompt` 不写模型名、比例、数量、工具名。
- 如果当前用户明确提出全新主题，以当前输入为主。
- 如果当前用户有“它、上一张、保持、继续、改成、换成”等指代，结合上一轮结果延续。

### 5. 实际生成接口使用 `effectivePrompt`

新增 helper：

```ts
function generationPrompt(input: StudioGenerationRequest) {
  const effectivePrompt = (input as StudioGenerationPromptInput).effectivePrompt
  return typeof effectivePrompt === "string" && effectivePrompt.trim().length > 0
    ? effectivePrompt.trim()
    : buildEffectivePrompt(input)
}
```

provider 调用处使用 `generationPrompt(input)`，而不是直接使用 `input.prompt` 或 `buildEffectivePrompt(input)`。

### 6. 前端展示仍使用用户原文

`generationSnapshot` 和最终 `StudioGenerationResult.prompt` 应保持：

```ts
prompt: input.prompt
```

不要把 `refinedPrompt` 或 `effectivePrompt` 回填到前端展示用的 `prompt` 字段。

`displayInput` 合并 provider task input 时，也要保留用户原始 prompt：

```ts
function displayInput(input: StudioGenerationRequest, task?: ImageGenerationTask) {
  if (!task?.input) return input
  return {
    ...input,
    ...task.input,
    prompt: input.prompt,
  }
}
```

## 已发现的问题与原因

### 问题 1：LLM timeout 后没有取消真实请求

原因：

使用 `Promise.race([LLM 调用, timeout])` 只能让外层 await 提前结束，不能中止已经发出的 `generateObject` 请求。

影响：

- 用户侧已经 fallback 并继续生图，但后台 LLM 请求仍可能继续运行。
- 连续生成时可能堆积不可见请求。
- 可能增加 sidecar 压力和模型调用成本。

修改方案：

- 使用 `AbortController`。
- 将 `abortSignal` 传给 `generateObject`。
- timeout 时调用 `controller.abort()`。
- 在 `finally` 中清理 timer。

建议实现方向：

```ts
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 12_000)

try {
  return await generateObject({
    ...params,
    abortSignal: controller.signal,
  })
} finally {
  clearTimeout(timeout)
}
```

### 问题 2：创建对话和生成卡片前先等待 LLM

原因：

`createGeneration()` 中先执行：

```ts
const promptRefine = await refineStudioPrompt(input, session)
```

然后才持久化 user/assistant/tool turn 和 `studio_generation` 记录。

影响：

- LLM 慢时，用户点击生成后前端可能长时间没有响应。
- 最坏情况下等待 timeout 后才显示生成卡片。
- Studio 的即时反馈体验变差。

修改方案：

短期方案：

- 将 LLM timeout 降低到 3 到 5 秒。
- 保持当前同步流程，但减少用户等待。

中期方案：

- 先创建用户消息、assistant 占位文案和 running 工具卡片。
- 再异步执行 LLM refine。
- LLM 成功后更新 tool input 中的 `refinedPrompt/effectivePrompt`。
- 再创建真实 provider task。

中期方案需要额外处理：

- LLM 阶段取消生成。
- LLM 失败后 fallback 并继续创建 provider task。
- provider task 创建失败如何更新同一个 tool part。
- 前端如何展示“理解中/准备中”状态。

### 问题 3：多轮上下文没有真正理解上一轮图像内容

原因：

当前传给 LLM 的上一轮信息主要是：

```ts
previousTurn: {
  userText,
  refinedPrompt,
  imageUrls
}
```

但 `imageUrls` 只是 JSON 文本中的字符串。大多数文本模型不会读取 URL 对应图片内容。

影响：

- 用户说“把它换成夜晚”“保留构图”“让人物看向镜头”等依赖真实生成图像的需求时，LLM 只能根据上一轮文字猜。
- 多轮效果更像文字续写，不是真正基于生成结果续改。

修改方案：

方案 A：文本增强。

- 保存上一轮 `refinedPrompt`。
- 保存上一轮用户原文。
- 保存生成结果 metadata。
- 提示 LLM 优先使用这些文本上下文。

方案 B：多模态输入。

- 如果当前模型支持图片输入，将上一轮主图作为 image content part 传入 LLM。
- 如果模型不支持图片输入，fallback 到文本上下文。

方案 C：生成结果摘要。

- 每次生成成功后，用视觉模型生成 `visualSummary`。
- 后续多轮只传 `visualSummary`，避免每次都传图。

建议顺序：

1. 先做文本增强，保证稳定。
2. 再按模型 capability 增加图片输入。
3. 最后考虑持久化 `visualSummary`。

### 问题 4：LLM 返回空白字符串时可能出现空 assistant 文案

原因：

`z.string().min(1)` 会接受 `" "`，但 `.trim()` 后变成空字符串。

影响：

- assistant 气泡可能为空。
- `refinedPrompt` 为空时 provider prompt 会 fallback，但 assistant 文案可能已经不自然。

修改方案：

- schema 使用 trim 后校验。
- 或在返回后进行二次校验。

建议实现：

```ts
const assistantText = result.assistantText.trim()
const refinedPrompt = result.refinedPrompt.trim()

if (!assistantText || !refinedPrompt) {
  return promptRefineFallback(input)
}
```

### 问题 5：获取最后一轮成功结果时拉全量记录再排序

原因：

当前 helper 可能会查询当前 session 所有 succeeded generation，然后在 JS 里排序取第一条。

影响：

- 短会话影响不大。
- 长会话中每轮生成都会扫描并排序越来越多历史记录。

修改方案：

- 在 SQL 层完成排序和限制。
- 按 `time_updated desc` 或 `completed_at desc` 取 `limit(1)`。

建议：

- 如果 Drizzle 表达 `coalesce(completed_at, time_updated)` 不方便，可以先用 `time_updated desc`。
- 成功生成时 `time_updated` 通常就是完成时间。

### 问题 6：结构化 LLM 调用没有复用其它模块的 provider 兼容逻辑

原因：

当前 Studio prompt refine 是独立调用 `generateObject`，而仓库里其它 LLM 链路已经有 provider 兼容逻辑：

- 普通对话和 agent tool-call：走 `SessionPrompt` + `LLM.run`。
- 一次性结构化生成：`Agent.generate` 中局部处理 `generateObject` / `streamObject`。

`Agent.generate` 对 OpenAI OAuth 做了特殊处理：

- 普通模型走 `generateObject`。
- OpenAI OAuth 走 `streamObject`。
- 系统提示通过 `ProviderTransform.providerOptions(..., { instructions })` 传入。

影响：

- 如果 Studio prompt refine 使用 OpenAI OAuth 类型模型，可能出现系统提示不生效、结构化输出失败或请求兼容问题。
- 其它 provider transform 逻辑也可能和主 LLM 链路不一致。

修改方案：

- 不建议为了 prompt refine 直接回到完整 `SessionPrompt + LLM.run`。
- 建议抽一个轻量的结构化生成 helper。

建议 helper：

```ts
generateStructuredObject({
  model,
  schema,
  system,
  messages,
  temperature,
  abortSignal,
})
```

helper 内部统一处理：

- provider/model/language 获取。
- auth 信息获取。
- OpenAI OAuth 判断。
- 普通模型使用 `generateObject`。
- OpenAI OAuth 使用 `streamObject + ProviderTransform.providerOptions`。
- `abortSignal`。
- 输出 trim 和校验。

可选位置：

- `packages/opencode/src/provider/generate-object.ts`
- `packages/opencode/src/llm/structured.ts`
- `packages/opencode/src/agent/structured-generate.ts`

## 关于旧 Studio agent 模式的结论

旧 Studio LLM 模式是：

```text
octo_studio agent
  -> SessionPrompt
  -> LLM.run
  -> toolChoice: required
  -> Studio image tool call
```

它的优点：

- provider 兼容完整。
- assistant 文案自然。
- 多轮对话自然。
- tool call 由通用 agent 链路处理。

它的缺点：

- 会重新引入完整 session processor、权限、工具调用、step、tool repair 等复杂链路。
- 与当前 `/studio/generations` 的状态管理、取消、轮询、失败恢复存在工程边界冲突。
- 需要重新桥接 generation record 和 result card 状态。

当前决定：

- 暂缓“只让生成能力回到 agent tool-call”的改造。
- 先保留当前 `/studio/generations` 主链路。
- 优先补齐轻量 LLM prompt refine 的稳定性和 provider 兼容。

## 待办事项

### 必做

- [ ] 为 prompt refine 的 LLM 调用增加 `AbortController` 和 `abortSignal`。
- [ ] 对 `assistantText` 和 `refinedPrompt` 做 trim 后二次校验，空值走 fallback。
- [ ] 将 LLM timeout 调整到更适合交互的范围，建议 3 到 5 秒。
- [ ] 优化最后一轮成功结果查询，SQL 层排序并 `limit(1)`。
- [ ] 确保前端 user bubble、generation snapshot、result prompt 都只展示用户原始输入。
- [ ] 确保编辑能力不调用 LLM。

### 应做

- [ ] 抽通用结构化 LLM helper，复用 `Agent.generate` 中的 provider 兼容逻辑。
- [ ] 兼容 OpenAI OAuth 的 `streamObject + providerOptions.instructions` 路径。
- [ ] 在 prompt refine 失败日志中区分 timeout、provider 错误、schema 错误、空输出错误。
- [ ] 将 LLM 系统提示移动到独立 prompt 文件，避免大段字符串堆在 service 中。

### 后续增强

- [ ] 对支持图片输入的模型，将上一轮主图作为 image content part 传给 LLM。
- [ ] 对不支持图片输入的模型，继续使用上一轮 `refinedPrompt` 和用户原文。
- [ ] 生成成功后可考虑持久化 `visualSummary`，供后续多轮使用。
- [ ] 评估 `video.generate` 是否纳入 LLM prompt refine。
- [ ] 暂缓评估：是否只让 `image.generate` 回到 `octo_studio` agent tool-call 模式。

## 建议实施顺序

1. 修 `abortSignal`、空白校验、timeout。
2. 优化最后成功记录查询。
3. 抽结构化 LLM helper，处理 OpenAI OAuth 兼容。
4. 将 Studio prompt refine 切到 helper。
5. 增加多模态上一轮图片输入。
6. 再讨论是否恢复 `image.generate` 的 agent tool-call 模式。

