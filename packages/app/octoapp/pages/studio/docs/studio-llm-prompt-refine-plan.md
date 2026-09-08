# Studio 引入 LLM 进行多轮提示词润色方案

## 背景

当前 Studio 主生成链路已经从早期的 `session.prompt()` / `octo_studio` agent tool-call 模式，迁移为直接调用 `/studio/generations`：

```text
StudioPage.runGeneration()
  -> POST /studio/generations
  -> studio-service.createGeneration()
  -> createProviderTask() / executeJimengImageGenerate()
  -> internel / jimeng 图片或视频生成接口
  -> Studio message / tool part / generation record
```

这条链路的优点是生成状态、取消、轮询、失败恢复和历史持久化都更可控。问题是多轮对话目前主要依赖简单拼接：

```text
延续上一轮画面：{上一轮用户需求}。{本轮用户需求}
```

这种方式缺少真正的上下文理解，无法稳定处理“它”“保持上一张构图”“换成夜景”“风格更梦幻一点”等多轮指代，也无法根据真实生成结果调整本轮提示词。

## 目标

在不回退到旧的完整 agent tool-call 链路的前提下，引入 LLM 作为 Studio 生成前的“对话理解与提示词润色”步骤。

LLM 只负责：

- 生成自然的 `assistantText`，让对话更流畅友好。
- 根据当前用户输入、历史上下文和上一轮生成结果生成 `refinedPrompt`。

LLM 不负责：

- 选择能力 `capability`。
- 选择模型/风格 `styleModel`。
- 选择画幅比例 `aspectRatio`。
- 选择生成数量 `count`。
- 选择生图工具 `imageTool`。
- 处理生成状态、取消、轮询、失败恢复。

用户气泡必须永远显示用户原始输入，不允许被 LLM 润色结果污染。

## 能力范围

第一阶段只建议接入：

- `image.generate`

第二阶段再考虑：

- `video.generate`

第一阶段不接入：

- `image.upscale`
- `image.cutout`
- `image.inpaint`
- `image.outpaint`

原因：

- 变清晰、抠图、重绘、扩图更接近确定性编辑能力，核心输入来自原图、蒙版、扩展方向或编辑器参数。
- 这些能力的比例、风格、数量本来就不参与生成，接入 LLM 容易引入无关改写。
- 当前优先解决的是普通多轮生图场景。

## 推荐链路

```text
用户输入原文
  -> 前端仍 POST /studio/generations
  -> 后端创建 Studio generation
  -> 后端构造 LLM refine 输入
  -> LLM 返回 assistantText + refinedPrompt
  -> user message 写用户原文
  -> assistant message 写 assistantText
  -> tool input 写 prompt + refinedPrompt/effectivePrompt
  -> provider 使用 refinedPrompt
  -> 生成结果写回 tool part
```

关键原则：

```text
prompt          = 用户原始输入，用于 UI 展示、用户气泡、标题、再次生成默认输入
assistantText   = LLM 给用户看的自然回复
refinedPrompt   = LLM 生成的内容描述，用于 provider
effectivePrompt = 实际传给 provider 的 prompt，通常等于 refinedPrompt，失败时回退到 prompt
```

## 数据结构设计

### StudioGenerationRequest

保持现有字段不变：

```ts
export type StudioGenerationRequest = {
  sessionID?: string
  capability: StudioCapability
  prompt: string
  styleModel?: string
  aspectRatio?: string
  count?: number
  imageTool?: StudioProvider
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}
```

不建议把 `refinedPrompt` 放到前端请求中。它应由后端根据当前 session 状态生成，避免前端或历史 pending 状态污染。

### 新增内部类型

在 `packages/opencode/src/studio/studio-service.ts` 增加内部类型：

```ts
type StudioPromptRefineResult = {
  assistantText: string
  refinedPrompt: string
  fallback?: boolean
  raw?: unknown
}
```

最终 tool input 中保存：

```ts
state.input = {
  capability: input.request.capability,
  prompt: input.request.prompt,
  refinedPrompt,
  effectivePrompt,
  styleModel,
  aspectRatio,
  count,
  referenceImages,
  sourceImage,
  extra,
}
```

其中：

- `prompt` 始终是用户原文。
- `refinedPrompt` 是 LLM 输出。
- `effectivePrompt` 是实际生成使用的 prompt。
- `styleModel`、`aspectRatio`、`count` 仍来自 UI 配置，不进入 LLM 决策。

## LLM 输入设计

LLM 输入应该是结构化文本或 JSON，明确禁止模型决定配置项。

建议包含：

```ts
type StudioPromptRefineInput = {
  userPrompt: string
  capability: "image.generate"
  styleModel?: string
  aspectRatio?: string
  count?: number
  hasReferenceImages: boolean
  previousTurn?: {
    userText: string
    assistantText?: string
    prompt?: string
    refinedPrompt?: string
    capability?: StudioCapability
    model?: string
    aspectRatio?: string
    imageUrls: string[]
  }
}
```

第一阶段可先只使用最后一轮成功生成结果，不累计全部历史。

`previousTurn.imageUrls` 第一阶段可以只作为文本 URL 提供。后续如果选用多模态模型，再把上一轮主图作为 image part 传给模型，让它真正理解生成结果。

## LLM 输出格式

建议强制 JSON 输出：

```json
{
  "assistantText": "好的，我会保留上一张图中的主体氛围，把场景调整成更明亮的清晨，并加强柔和光影。",
  "refinedPrompt": "保留上一轮画面中的主体、构图和氛围，将场景调整为清晨，柔和阳光穿过薄雾，画面干净明亮，电影感光影，细节丰富..."
}
```

约束：

- `assistantText` 使用中文，简短自然，不提模型、比例、数量、工具名。
- `refinedPrompt` 只描述要生成的画面内容。
- `refinedPrompt` 不写“比例 3:4”“生成 1 张”“使用千问模型”等配置项。
- `refinedPrompt` 不输出 JSON 以外的解释文本。
- 如果当前用户明确开启新主题，不强行延续上一轮。
- 如果当前用户使用“它、上一张、保持、改成、继续”等指代，需要保留上一轮核心主体、构图、氛围或风格。

## LLM 系统提示建议

新增文件：

```text
packages/opencode/src/studio/prompt-refine.txt
```

建议内容：

```text
你是 Octo Studio 的创意提示词润色助手。

你的任务是根据用户当前输入、最近一次成功生成结果和上下文，生成：
1. assistantText：给用户看的自然中文回复。
2. refinedPrompt：给图片生成接口使用的画面描述。

严格规则：
- 只负责画面内容描述，不决定能力、模型、工具、比例、数量。
- 不要在 refinedPrompt 中写模型名称、画幅比例、生成数量、工具名称。
- 用户气泡会显示用户原文，因此不要把用户输入改写成对话消息。
- 如果用户当前输入是延续上一轮，请保留上一轮主体、构图、氛围、风格中仍相关的部分。
- 如果用户当前输入明确是全新主题，请以当前输入为主。
- assistantText 要简短、自然、友好，不要暴露内部参数。
- 只输出 JSON。
```

## 后端实现方案

### 1. 新增 refine helper

在 `packages/opencode/src/studio/studio-service.ts` 新增：

```ts
async function refineStudioPrompt(input: StudioGenerationRequest): Promise<StudioPromptRefineResult>
```

职责：

1. 判断当前能力是否需要 LLM。
2. 读取当前 session 的最后一轮成功 Studio turn。
3. 构造 LLM 输入。
4. 调用 LLM。
5. 解析 JSON。
6. 失败时返回 fallback。

判断逻辑：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate") return false
  if (input.extra?.skipPromptRefine === true) return false
  return true
}
```

### 2. 获取上一轮成功结果

后端不要依赖前端拼好的 `studioContext` 字符串。建议在后端基于 session message/part 自己提取，避免前后端展示字段和生成字段混淆。

第一阶段可以简单读取当前 session 的最近 generation result：

- 从 `StudioGenerationTable` 按 `session_id`、`status = succeeded`、`completed_at desc` 找最后一条。
- 读取其 `request.input.prompt`、`request.input.refinedPrompt`、`result.images`、`result.model`、`result.aspectRatio`。

如果当前 generation 还没写入 result，则跳过当前 id，只取已完成的旧记录。

### 3. 调用 LLM 的方式

推荐优先复用已有 provider / LLM service，而不是走 `SessionPrompt.prompt()`：

- `SessionPrompt.prompt()` 会创建真实用户/assistant消息，容易污染 Studio 对话历史。
- 本需求需要的是隐藏 refine，不应该产生额外用户轮次。

实现上可以在 `studio-service.ts` 中引入低层 LLM 能力，或新增 `studio-prompt-refiner.ts`，由应用层注入：

```text
packages/opencode/src/studio/studio-prompt-refiner.ts
```

如果直接使用现有 Effect service 成本较高，第一阶段也可以做一个小型服务函数，使用当前 session model 或默认模型调用 provider。

模型选择：

- 优先使用当前 session 的 `session.model`。
- 如果没有 session model，使用默认配置模型。
- 超时建议 8-12 秒。

失败策略：

```ts
return {
  assistantText: buildAssistantText(input),
  refinedPrompt: buildFallbackPrompt(input),
  fallback: true,
}
```

### 4. 修改 createGeneration 流程

当前大致流程：

```ts
createGeneration(input)
  -> persistStudioSession({ request: input })
  -> createProviderTask(input, provider)
```

建议改为：

```ts
createGeneration(input)
  -> const promptPlan = await refineStudioPrompt(input)
  -> persistStudioSession({
       request: input,
       assistantText: promptPlan.assistantText,
       refinedPrompt: promptPlan.refinedPrompt,
     })
  -> createProviderTask(input, provider, promptPlan.refinedPrompt)
```

注意：

- `persistStudioSession()` 当前内部调用 `buildAssistantText(input.request)`，需要改为可传入 `assistantText`。
- `createProviderTask()` 当前内部调用 `buildEffectivePrompt(input)`，需要改为接收 `effectivePrompt`。
- `generationRequest(record).input.prompt` 仍保持原始用户输入。
- `generationRequest(record).input.refinedPrompt` 如果放入 request，需要注意只作为内部字段，不返回成用户 prompt。

### 5. provider 调用

当前：

```ts
createInternalGeneration({
  capability: input.capability,
  prompt: buildEffectivePrompt(input),
  styleModel: ...,
  aspectRatio: ...,
  count: ...,
})
```

改为：

```ts
createInternalGeneration({
  capability: input.capability,
  prompt: effectivePrompt,
  styleModel: input.styleModel,
  aspectRatio: input.aspectRatio,
  count: input.count,
})
```

`effectivePrompt` 来源：

```ts
const effectivePrompt = promptPlan.refinedPrompt || input.prompt
```

禁止把 `styleModel`、`aspectRatio`、`count` 拼入 prompt。

### 6. 持久化字段

`persistStudioSession()` 写入：

```ts
userTextPart.text = input.request.prompt
assistantTextPart.text = promptPlan.assistantText
toolPart.state.input.prompt = input.request.prompt
toolPart.state.input.refinedPrompt = promptPlan.refinedPrompt
toolPart.state.input.effectivePrompt = promptPlan.refinedPrompt
```

完成结果 `StudioGenerationResult.prompt` 继续使用用户原始输入。

如果需要排查，可在 `toolPart.state.metadata.studio` 中增加：

```ts
promptRefined: true,
promptRefineFallback: promptPlan.fallback === true,
```

## 前端实现方案

前端不负责 LLM prompt refine。

需要确认以下原则：

- `StudioConversation` 用户气泡继续读取 `turn.userText`。
- `turn.userText` 来自 user message text part，即用户原文。
- `StudioDetails` 中 `result.prompt` 继续显示用户原文。
- 不从 `effectivePrompt` 或 `refinedPrompt` 作为用户气泡内容。
- 如果要展示 LLM 润色后的生成提示词，只能放在调试区或隐藏详情中，第一阶段不建议展示。

前端仍然提交：

```ts
prompt: input.text
styleModel
aspectRatio
count
capability
imageTool
referenceImages
sourceImage
extra
```

前端可以保留 `extra.studioContext` 一段时间以兼容当前逻辑，但 LLM 接入后建议逐步废弃前端拼接上下文，改由后端读取 session/generation 历史。

## 失败与降级策略

LLM refine 失败不能导致生成失败。

失败场景包括：

- LLM 超时。
- LLM 返回非 JSON。
- JSON 缺少 `refinedPrompt`。
- provider/model 不可用。

降级规则：

```ts
assistantText = buildAssistantText(input)
refinedPrompt = input.prompt
```

如果仍需要弱多轮连续，可以临时降级为当前简单上下文拼接：

```ts
refinedPrompt = buildEffectivePrompt(input)
```

但长期建议避免把固定中文前缀作为生成 prompt 的主方案。

## 多模态增强路线

第一阶段只做文本上下文：

- 上一轮用户原文。
- 上一轮 refinedPrompt。
- 上一轮生成结果 URL。

第二阶段引入视觉理解：

1. 如果模型支持 image input，把上一轮主图传给 LLM。
2. 如果不支持，增加图片 caption 步骤：

```text
上一轮主图 -> vision caption -> prompt refine
```

将 caption 缓存在 generation result metadata 中，避免每轮重复识图。

## 测试计划

### 单元测试

新增 `packages/opencode/test/studio/prompt-refine.test.ts`：

- `image.generate` 会调用 refine。
- `image.upscale` / `image.cutout` / `image.inpaint` / `image.outpaint` 不调用 refine。
- LLM 返回 JSON 时，provider 使用 `refinedPrompt`。
- `styleModel`、`aspectRatio`、`count` 不进入 `refinedPrompt` 拼接逻辑。
- LLM 失败时 fallback 到用户原 prompt。
- `StudioGenerationResult.prompt` 始终等于用户原始输入。

### 前端/turn 测试

扩展 `packages/app/octoapp/pages/studio/turns.test.ts`：

- user bubble 使用 user text part，不读取 `effectivePrompt`。
- result prompt 使用原始用户输入。
- tool input 中存在 `refinedPrompt` 时，不影响 `turn.userText`。

### 手工验证

1. 新建 Studio 会话，输入“生成一只小猫坐在窗边”。
2. 第二轮输入“把它改成夜晚，下雨”。
3. 对话气泡显示：

```text
把它改成夜晚，下雨
```

4. assistant 文案自然承接上一轮。
5. tool input 中 `refinedPrompt` 包含小猫、窗边、夜晚、雨等完整描述。
6. 结果详情 prompt 仍显示用户原文。
7. 比例、风格、数量仍按 UI 配置生效。
8. 抠图、变清晰、扩图不触发 LLM refine。

## 风险点

- LLM refine 增加生成前延迟。
- LLM 可能过度发挥，导致与用户当前输入不一致。
- 如果没有多模态输入，LLM 仍只能基于历史文本和 URL，不能真正理解图片内容。
- 需要严格隔离 `prompt` 和 `refinedPrompt`，避免再次污染用户气泡。
- 如果后端低层 LLM 调用复用成本高，第一阶段实现会涉及 Effect service 注入调整。

## 推荐实施顺序

1. 定义 `StudioPromptRefineResult` 和 `refineStudioPrompt()`，先用 fallback 实现打通字段。
2. 调整 `persistStudioSession()` 支持外部传入 `assistantText`、`refinedPrompt`、`effectivePrompt`。
3. 调整 `createProviderTask()` 接收 `effectivePrompt`，不再内部拼接上下文。
4. 接入真实 LLM JSON 输出。
5. 只对 `image.generate` 开启。
6. 补单元测试和 turn 测试。
7. 手工验证多轮对话和 UI 展示。
8. 评估是否扩展到 `video.generate` 和多模态图像理解。

## 最终目标形态

```text
用户看到：
用户：把它改成夜晚，下雨
助手：好的，我会保留上一张图中小猫坐在窗边的主体氛围，把场景调整为雨夜，并加强窗外灯光和室内暖光的对比。

生成接口收到：
保留上一轮画面中一只小猫坐在窗边的主体、构图和安静氛围，将场景调整为夜晚雨景，窗外有细密雨线和柔和街灯反光，室内保持温暖灯光，小猫轮廓清晰，画面有电影感光影和细腻毛发质感。

UI 配置仍单独生效：
styleModel = 千问
aspectRatio = 3:4
count = 1
capability = image.generate
```

这样 Studio 同时具备：

- 自然友好的对话体验。
- LLM 驱动的多轮理解和提示词润色。
- 稳定可控的工具参数和生成状态。
- 干净的数据边界，避免用户原文、assistant 文案和生成 prompt 混在一起。
