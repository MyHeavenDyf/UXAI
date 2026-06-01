# Studio 变清晰实现方案

## 目标

在 Studio 右侧生图信息中，为“变清晰”按钮接入实际生成逻辑：

- 点击后仍然走现有 Studio 生图对话流程。
- 左侧生图对话中需要出现本轮“生成中”的 pending 效果。
- 后端调用内部生图接口时，针对“变清晰”构造专用 requestBody。
- 方案要便于后续扩展抠图、局部重绘、扩图等其它能力。

## 前端改动

### 1. 右侧按钮接入事件

位置：

`packages/app/octoapp/pages/studio/index.tsx`

当前 `StudioDetails` 中“变清晰”按钮只是静态按钮，需要新增 `onUpscale` prop，并在按钮点击时调用。

`StudioPage` 中新增函数，例如：

```ts
function upscaleCurrentImage() {
  const image = selectedImage()
  if (!image) return
  void runGeneration({
    capability: "image.upscale",
    sourceImage: image.remoteUrl ?? image.url,
    prompt: "将当前图片变清晰，提升分辨率和细节",
  })
}
```

然后传给 `StudioDetails`：

```tsx
<StudioDetails
  ...
  onUpscale={upscaleCurrentImage}
/>
```

这样点击“变清晰”后仍复用现有 `runGeneration()`，会自动触发：

- `setStatus("submitting")`
- `setPendingResult(...)`
- 左侧对话 pending turn
- 中间画布生成中状态
- session 完成后刷新消息

### 2. 工具参数中携带 capability

位置：

`packages/app/octoapp/pages/studio/index.tsx`

在 `buildStudioPromptText()` 的 `toolSettings` 中加入 `capability`：

```ts
const toolSettings = JSON.stringify({
  capability: input.capability,
  styleModel: styleModelLabel(styleModel()),
  aspectRatio: aspectRatio(),
  count: count(),
  imageTool: imageTool() === "internel" ? "internel_image_generate" : "jimeng_image_generate",
})
```

这样后端工具可以稳定识别本轮是 `image.upscale`，后续其它能力也可以通过同一字段分发。

### 3. 优化左侧 pending 文案

现有 `buildStudioThinkingText()` 会基于 `capabilityLabel(input.capability)` 生成文案。

如果直接传 `image.upscale`，可能显示为类似：

```txt
好的，我将为您生成一张 3:4 比例的变清晰。
```

建议改为按能力生成更自然的文案：

- `image.generate`：生成图片
- `image.upscale`：提升当前图片清晰度
- `image.outpaint`：扩展当前图片画面
- 其它能力后续补充

这只影响左侧对话展示，不影响接口调用。

## 后端改动

### 1. 工具 schema 支持 capability

位置：

`packages/opencode/src/tool/internel_image_generate.ts`

当前 `InternelImageGenerateTool.execute()` 内部写死：

```ts
capability: "image.generate"
```

需要让工具参数正式支持 `capability`：

```ts
const Parameters = Schema.Struct({
  capability: Schema.optional(Schema.String),
  prompt: Schema.String,
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Number),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
```

执行时传入：

```ts
capability: params.capability ?? "image.generate"
```

同时建议保留从 `工具参数JSON` 或 prompt 中解析 capability 的兜底逻辑，避免模型没有显式传工具参数时丢失能力信息。

### 2. 当前图片转 base64

“变清晰”接口需要当前查看图片的 base64 数据。

建议后端根据 `input.sourceImage` 处理，而不是把大段 base64 塞进 prompt。

新增工具函数：

- 如果是 `data:image/...;base64,...`，直接取逗号后的 base64。
- 如果是 `http(s)://...`，后端 fetch 图片，再转为 base64。
- 如果没有当前图片，抛出明确错误。

示意：

```ts
async function getSourceImageBase64(input: ImageGenerateInput) {
  const sourceImage = input.sourceImage ?? input.referenceImages?.[0]
  if (!sourceImage) throw new Error("Upscale requires a source image.")
  if (sourceImage.startsWith("data:image/")) return sourceImage.split(",")[1] ?? ""
  const response = await fetch(sourceImage)
  if (!response.ok) throw new Error(`Failed to fetch source image: ${response.status}`)
  return Buffer.from(await response.arrayBuffer()).toString("base64")
}
```

## requestBody 构建方案

不要在 `executeInternelImageGenerate()` 中使用 `isUpscale ? A : B` 这种三目分支。

考虑后续还会扩展抠图、局部重绘、扩图等能力，应把不同能力的 requestBody 构建拆成独立 builder。

### 1. 统一构建入口

```ts
type InternalRequestContext = {
  userIdx: string
  styleConfig: InternalStyleConfig
  targetSize: {
    width: number
    height: number
  }
  taskType: string
}

async function buildInternalRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  if (input.capability === "image.upscale") return buildUpscaleRequestBody(input, context)
  return buildTextToImageRequestBody(input, context)
}
```

`executeInternelImageGenerate()` 只负责准备上下文并调用：

```ts
const requestBody = await buildInternalRequestBody(input, {
  userIdx,
  styleConfig,
  targetSize,
  taskType,
})
```

后续能力增加时，只需要继续补分发：

```ts
if (input.capability === "image.cutout") return buildCutoutRequestBody(input, context)
if (input.capability === "image.inpaint") return buildInpaintRequestBody(input, context)
if (input.capability === "image.outpaint") return buildOutpaintRequestBody(input, context)
return buildTextToImageRequestBody(input, context)
```

如果能力继续增多，可以再升级成 builder map。

### 2. 普通生图 builder

把现有普通生图 requestBody 挪到独立函数：

```ts
function buildTextToImageRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  return {
    user: { idx: context.userIdx },
    task_type: context.taskType,
    args: {
      tag_name:
        input.extra && typeof input.extra.tagName === "string"
          ? input.extra.tagName
          : context.styleConfig.tagName,
      num_image: getStudioCount(input),
      target: input.extra && typeof input.extra.target === "string" ? input.extra.target : context.styleConfig.target,
      target_size: context.targetSize,
      loras: context.styleConfig.loras,
      mode: input.extra && typeof input.extra.mode === "string" ? input.extra.mode : context.styleConfig.mode,
      ref_img_list: [],
      customer_prompt: input.prompt,
      prompt: buildPrompt(input),
    },
  }
}
```

### 3. 变清晰 builder

新增专用 requestBody 构建函数：

```ts
async function buildUpscaleRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  return {
    user: { idx: context.userIdx },
    task_type: "magnify",
    args: {
      mode: "super_resolution",
      image_base64: await getSourceImageBase64(input),
    },
  }
}
```

其中：

- `user` 保持现有逻辑。
- `task_type` 固定为 `"magnify"`。
- `args` 只包含 `mode` 和 `image_base64`。
- `mode` 固定为 `"super_resolution"`。
- `image_base64` 来自当前查看图片。

## 完成后的预期流程

1. 用户在右侧生图信息中点击“变清晰”。
2. 前端读取当前选中图片。
3. 前端调用 `runGeneration({ capability: "image.upscale", sourceImage, prompt })`。
4. 左侧生图对话出现一轮新的 pending 生成效果。
5. 模型调用 `internel_image_generate` 工具。
6. 后端工具识别 `image.upscale`。
7. 后端把当前图片转换成 base64。
8. 后端构造 magnify requestBody：

```json
{
  "user": {
    "idx": "..."
  },
  "task_type": "magnify",
  "args": {
    "mode": "super_resolution",
    "image_base64": "..."
  }
}
```

9. 后端复用现有 create task、query task、结果解析逻辑。
10. 工具返回图片附件后，Studio 左侧对话、中间画布、右侧详情继续走现有结果展示逻辑。

## 需要避免的实现

- 不要让“变清晰”按钮直接调用后端接口，否则左侧生图对话不会自然出现 pending 和结果。
- 不要把大段 base64 写进 prompt 或 `工具参数JSON`。
- 不要在 `executeInternelImageGenerate()` 中用三目表达式直接拼两种 requestBody。
- 不要把 magnify 的 args 细节散落在主执行流程里，应封装到独立 builder 中。
