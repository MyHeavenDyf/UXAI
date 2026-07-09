# Studio 视频生成接入 Prompt Refine 改造方案

## 背景

当前 Studio 的 LLM prompt refine 只实际作用于 `image.generate`。虽然 `createGeneration()` 对所有能力都会调用 `refineStudioPrompt(input, session)`，但 `shouldRefineWithLLM()` 会把非图片生成直接排除：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate") return false
  return input.extra?.skipPromptRefine !== true
}
```

因此 `video.generate` 当前不会走 LLM 润色，只会走 fallback：

```ts
return promptRefineFallback(input)
```

视频生成链路本身已经能接收 refined prompt：

- `createGeneration()` 会把 `promptRefine.refinedPrompt/effectivePrompt` 写入 `generationInput`。
- `createProviderTask()` 会通过 `generationPrompt(input)` 把最终 prompt 传给 `createInternalGeneration()`。
- `buildVideoRequestBody()` 使用 `input.prompt` 写入视频生成接口的 `args.prompt`。

也就是说，底层数据链路已经能承接视频 prompt refine；缺的是 capability-aware 的 LLM 润色规则。

## 结论

不能把图片 prompt refine 原样套到视频生成，但可以复用同一套调用框架。

可以复用：

- `streamText`
- `parsePromptRefineText`
- `promptRefineSchema`
- `promptRefineFallback`
- `chat.params` / `chat.headers`
- `ProviderTransform.options(...)`
- `chatParams.maxOutputTokens`
- 失败后 fallback 的整体机制

不能直接复用：

- 当前图片生成的 system prompt
- 当前 `promptRefineInput()` 只偏向图片上下文的输入结构
- 当前 `shouldRefineWithLLM()` 只允许 `image.generate`

视频 prompt 需要描述时间维度、动作、镜头、节奏，而不是只描述静态画面。

## 目标

- 让 `video.generate` 也可以进入 LLM prompt refine。
- 保持 prompt refine 是 best-effort，失败不阻断视频创建。
- 复用现有模型无关调用链路，不引入视频专属 provider/model 特化逻辑。
- 图片和视频使用不同 system prompt，但返回相同 schema。
- 不改变视频结构化参数，例如比例、时长、数量、质量模式、首帧/尾帧。

## 非目标

- 不调整视频生成接口 `buildVideoRequestBody()` 的协议。
- 不把 `duration`、`mode`、`aspectRatio`、`count` 交给 LLM 决策。
- 不让 LLM 选择文生视频/图生视频能力。
- 不使用 `generateObject`。
- 不使用 `Output.json()` / JSON mode。
- 不新增 DeepSeek 或任意 provider 特化逻辑。

## 需要修改的文件

主要修改：

- `packages/opencode/src/studio/studio-service.ts`

建议补充测试：

- `packages/app/octoapp/pages/studio/turns.test.ts`
- 如已有 opencode studio service 单测，可补充 `packages/opencode` 侧测试；当前重点可以先做类型检查和手动链路验证。

## 具体改造步骤

### 1. 扩展 `shouldRefineWithLLM()`

当前只允许图片：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate") return false
  return input.extra?.skipPromptRefine !== true
}
```

改为允许图片和视频：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate" && input.capability !== "video.generate") return false
  return input.extra?.skipPromptRefine !== true
}
```

这样 `video.generate` 会进入 `refineStudioPrompt()` 的 LLM 调用，但仍然可以用 `extra.skipPromptRefine === true` 跳过。

### 2. 拆分图片和视频 system prompt

把现有 `PROMPT_REFINE_SYSTEM` 改名为图片专用：

```ts
const IMAGE_PROMPT_REFINE_SYSTEM = [
  "你是 Octo Studio 的图片提示词润色助手。",
  ...
].join("\n")
```

新增视频专用：

```ts
const VIDEO_PROMPT_REFINE_SYSTEM = [
  "你是 Octo Studio 的视频提示词润色助手。",
  "你的任务是根据用户当前输入、最近一次成功生成结果和上下文，生成 assistantText 和 refinedPrompt。",
  "严格规则：",
  "- 只负责视频内容、动作、镜头、节奏、氛围描述。",
  "- 不决定能力、模型、比例、数量、时长、质量模式、工具。",
  "- 不要在 refinedPrompt 中写模型名称、画幅比例、生成数量、视频时长、质量模式或工具名称。",
  "- 如果是文生视频，refinedPrompt 应描述主体、动作、镜头运动、场景、节奏和氛围。",
  "- 如果是图生视频或有参考图/首帧/尾帧，请保留图中主体与画面关系，只补充合理运动和镜头变化。",
  "- 如果用户当前输入是延续上一轮，请保留上一轮主体、动作、场景、风格中仍相关的部分。",
  "- 如果用户当前输入明确是全新主题，请以当前输入为主。",
  "- assistantText 使用中文，简短、自然、友好，不要暴露内部参数。",
  "- assistantText 不超过 40 个中文字。",
  "- refinedPrompt 只描述要生成的视频内容。",
  "- refinedPrompt 不超过 300 个中文字。",
  "- 输出必须是单个 JSON object，不要 markdown，不要代码块，不要解释文字。",
  "- 只输出 JSON。",
].join("\n")
```

新增选择函数：

```ts
function promptRefineSystem(input: StudioGenerationRequest) {
  if (input.capability === "video.generate") return VIDEO_PROMPT_REFINE_SYSTEM
  return IMAGE_PROMPT_REFINE_SYSTEM
}
```

然后把 `refineStudioPrompt()` 中：

```ts
const system = [PROMPT_REFINE_SYSTEM]
```

改为：

```ts
const system = [promptRefineSystem(input)]
```

### 3. 扩展 `promptRefineInput()`

当前输入只包含：

```ts
return {
  userPrompt: input.prompt,
  hasReferenceImages: (input.referenceImages?.length ?? 0) > 0,
  previousTurn: ...
}
```

建议扩展为 capability-aware，但保持结构简单：

```ts
function promptRefineInput(input: StudioGenerationRequest, previous?: StudioGenerationRecord) {
  const previousRequest = previous ? generationRequest(previous).input as StudioGenerationPromptInput : undefined
  return {
    capability: input.capability,
    userPrompt: input.prompt,
    hasReferenceImages: (input.referenceImages?.length ?? 0) > 0,
    ...(input.capability === "video.generate"
      ? {
          video: {
            mode: videoMode(input),
            duration: videoDuration(input),
            qualityMode: videoQualityMode(input),
            hasFirstFrame: Boolean(input.extra?.firstFrame) || (input.referenceImages?.length ?? 0) > 0,
            hasLastFrame: Boolean(input.extra?.lastFrame),
          },
        }
      : undefined),
    previousTurn: previous && previousRequest
      ? {
          capability: previous.capability,
          userText: previousRequest.prompt,
          refinedPrompt: previousRequest.refinedPrompt ?? previousRequest.effectivePrompt,
          imageUrls: imageUrls(previous.result),
        }
      : undefined,
  }
}
```

注意：

- `video.mode` 只是上下文，LLM 不允许修改能力。
- `duration`、`qualityMode` 只是上下文，LLM 不允许改参数。
- `hasFirstFrame/hasLastFrame` 用来帮助 LLM 判断是否应描述图生视频运动。

### 4. schema 继续共用

继续使用现有 schema：

```ts
const promptRefineSchema = z.object({
  assistantText: z.string().min(1),
  refinedPrompt: z.string().min(1),
})
```

不新增视频专属字段。

原因：

- `assistantText` 继续用于会话气泡展示。
- `refinedPrompt/effectivePrompt` 继续进入 `generationPrompt(input)`。
- 视频结构化参数已经由 Studio UI/API 提供，不应该由 LLM 输出。

### 5. `promptRefineFallback()` 保持可用

现有 fallback 已经能处理视频，因为 `shouldRefineWithLLM(input)` 为 false 时会走 `buildAssistantText(input)`，而 `buildAssistantText()` 已经有 `video.generate` 分支。

启用视频 refine 后，视频 LLM 失败时会进入：

```ts
shouldRefineWithLLM(input)
  ? input.sourceImage
    ? "好的，我会基于当前画面继续创作。"
    : "好的，我会根据你的描述创作画面。"
  : buildAssistantText(input)
```

这里建议顺手优化一下文案，避免视频失败 fallback 说“创作画面”：

```ts
function promptRefineFallback(input: StudioGenerationRequest): StudioPromptRefineResult {
  const restoredPrompt = input.effectivePrompt?.trim() || input.refinedPrompt?.trim()
  const effectivePrompt = restoredPrompt || buildEffectivePrompt(input)
  const regenerateText = input.displayPrompt?.trim() === "再次生成"
  return {
    assistantText: regenerateText
      ? "好的，我会按当前结果的配置重新生成。"
      : shouldRefineWithLLM(input)
      ? input.capability === "video.generate"
        ? "好的，我会根据你的描述创作视频。"
        : input.sourceImage
          ? "好的，我会基于当前画面继续创作。"
          : "好的，我会根据你的描述创作画面。"
      : buildAssistantText(input),
    refinedPrompt: effectivePrompt,
    effectivePrompt,
    fallback: true,
  }
}
```

这样视频 prompt refine 失败时也不会出现图片文案。

### 6. `createProviderTask()` 不需要改

当前逻辑：

```ts
return createInternalGeneration({
  capability: input.capability,
  prompt: generationPrompt(input),
  ...
})
```

视频生成会自然拿到 `generationPrompt(input)`，不需要修改。

### 7. `buildVideoRequestBody()` 不需要改

当前逻辑：

```ts
const baseArgs = {
  prompt: input.prompt,
  aspect_ratio: getVideoAspectRatio(input),
  duration: getVideoDuration(input),
  count: getStudioCount(input),
  mode: getVideoMode(input),
}
```

`input.prompt` 已经是 `createProviderTask()` 传入的 `generationPrompt(input)`，所以视频接口会收到 refined prompt。

不建议在这里再拼接上下文或再次润色，避免同一个 prompt 被重复改写。

## 推荐代码结构

关键结构如下：

```ts
const IMAGE_PROMPT_REFINE_SYSTEM = [...]
const VIDEO_PROMPT_REFINE_SYSTEM = [...]

function promptRefineSystem(input: StudioGenerationRequest) {
  if (input.capability === "video.generate") return VIDEO_PROMPT_REFINE_SYSTEM
  return IMAGE_PROMPT_REFINE_SYSTEM
}

function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate" && input.capability !== "video.generate") return false
  return input.extra?.skipPromptRefine !== true
}

function promptRefineInput(input: StudioGenerationRequest, previous?: StudioGenerationRecord) {
  ...
}

async function refineStudioPrompt(input: StudioGenerationRequest, session: typeof SessionTable.$inferSelect) {
  if (!shouldRefineWithLLM(input)) return promptRefineFallback(input)
  ...
  const system = [promptRefineSystem(input)]
  const userContent = JSON.stringify(promptRefineInput(input, lastSuccessfulGeneration(...)), null, 2)
  ...
}
```

## 风险点

### 1. 视频 prompt 被 LLM 改得过度

视频 prompt refine 必须强调不改变结构化参数，不改变参考图主体，只补充运动、镜头和节奏。

### 2. 图生视频和文生视频需求不同

文生视频可以更自由地补主体、动作和镜头。

图生视频必须围绕首帧/尾帧，不能凭空换主体或换场景。

### 3. 多轮上下文可能来自图片生成

上一轮可能是 `image.generate`，这一轮是 `video.generate`。这种情况是合理的：用户可能想“让这张图动起来”。因此 `previousTurn.capability` 应传给 LLM，system prompt 应要求如果参考上一轮图片，则保留主体和画面关系，只描述运动。

### 4. prompt refine 仍然必须可失败

任何视频 prompt refine 失败都必须 fallback，不能阻断视频创建。

## 验证方式

运行类型检查：

```bash
cd packages/opencode
bun typecheck
```

建议手动验证：

1. 文生视频
   - 输入：“一只金毛在海边奔跑”
   - 期望：LLM 输出的视频 prompt 包含动作、镜头、氛围。

2. 图生视频
   - 带 reference image 或 firstFrame。
   - 输入：“让它慢慢转头看向镜头”
   - 期望：prompt 保留主体，只补运动和镜头，不换场景。

3. 首尾帧视频
   - 带 firstFrame/lastFrame。
   - 期望：prompt 描述从首帧到尾帧的过渡，不改变结构化参数。

4. 多轮：图片转视频
   - 上一轮生成图片。
   - 下一轮切换 `video.generate`，输入：“让这张图动起来”。
   - 期望：previousTurn 被用于保留主体，视频 prompt 描述运动。

5. prompt refine 失败
   - 模拟无效 JSON 或设置 `extra.skipPromptRefine=true`。
   - 期望：视频生成仍然进入 create task，fallback 文案不说“创作画面”。

## 建议的实施顺序

1. 先加 `VIDEO_PROMPT_REFINE_SYSTEM` 和 `promptRefineSystem(input)`。
2. 修改 `shouldRefineWithLLM()` 支持 `video.generate`。
3. 扩展 `promptRefineInput()` 的 capability 和 video 上下文。
4. 优化 `promptRefineFallback()` 的视频文案。
5. 跑 `bun typecheck`。
6. 做文生视频、图生视频、多轮图片转视频的手动验证。

## 总结

视频生成可以接入当前 prompt refine 框架，但必须是 capability-aware 的接入方式。

正确方向是复用调用机制，不复用图片 prompt 规则：

- 图片 refine 负责静态画面描述。
- 视频 refine 负责动作、镜头、节奏和时间变化描述。
- 两者共用 JSON schema、streaming parser、fallback 和 provider 参数链路。

这样既能扩展视频生成体验，又不会把图片提示词逻辑误套到视频场景。
