# Studio 5170 工程迁移实现方案

## 目标

将 `/Users/ljc/Documents/workspace/image-agent-studio-vite-express` 中的 Studio 能力迁入 UXAI 现有 Studio 页面，而不是在 `packages/app/octoapp/pages/studio` 中长期 iframe 嵌入 `http://localhost:5170/`。

迁移后的 Studio 需要继续使用 UXAI 的现有产品底座：

- `/:dir/studio/:id?` 路由。
- `octo_studio` session。
- `globalSDK.client.session.promptAsync()` 发送用户请求。
- `globalSDK.event.listen()` 接收 message / part / status 事件。
- 后端 tool part 持久化图片结果。
- 现有会话列表、项目目录、设置、权限、模型上下文。

5170 工程中的价值主要作为交互和能力参考迁入：

- 图片 Agent 状态模型。
- 普通生图、变清晰、抠图、扩图工具动作。
- 扩图编辑器交互。
- 更完整的图片详情、缩略图、工具操作体验。

## 非目标

- 不在正式实现中依赖 `http://localhost:5170/`。
- 不让 5170 的 `localStorage` 成为正式会话存储。
- 不让 5170 的 Express `MemorySessionStore` 成为正式后端状态。
- 不引入 Vue 运行时到 UXAI Studio 页面。
- 不把 UXAI Studio 拆成两个并行的会话体系。

## 现状对比

### UXAI 当前 Studio

关键文件：

- `packages/app/octoapp/pages/studio/index.tsx`
- `packages/app/octoapp/pages/studio/types.ts`
- `packages/app/octoapp/pages/studio/data.ts`
- `packages/app/octoapp/pages/studio/turns.ts`
- `packages/opencode/src/studio/studio-service.ts`
- `packages/opencode/src/tool/internel_image_generate.ts`
- `packages/opencode/src/tool/jimeng_image_generate.ts`

特点：

- 已接入 UXAI session 和事件流。
- 已能从 tool part 还原 Studio 历史。
- 已有 `image.generate`、`image.upscale`、`image.outpaint` 等 capability 类型。
- 前端页面是 Solid。
- 后端工具已经在 `opencode` 包内。

### 5170 工程

关键文件：

- `frontend/src/components/ImageStudio.vue`
- `frontend/src/components/ComposerPanel.vue`
- `frontend/src/components/studioEnlarging/StudioEnlarging.vue`
- `backend/src/agent/image-generation-agent.ts`
- `backend/src/tools/generate-image-service.ts`

特点：

- 前端页面是 Vue。
- 会话存在浏览器 `localStorage`。
- 后端状态存在 Express 内存 store。
- 前端通过 `/api/agent/image` 请求 Express。
- 已有 `generate_image`、`super_resolution`、`cutout`、`outpainting` 工具动作。
- 对扩图、抠图、变清晰的 payload builder 更完整。

## 总体架构

迁移后保持单一数据流：

```txt
Studio UI (Solid)
  -> globalSDK.client.session.promptAsync()
  -> octo_studio agent
  -> internel_image_generate / jimeng_image_generate
  -> tool part attachments / output
  -> globalSDK event stream
  -> buildStudioTurns()
  -> Studio UI render
```

5170 的后端能力迁入后，不再由前端直接请求独立 Express，而是进入 UXAI tool 层：

```txt
5170 generate-image-service
  -> packages/opencode/src/tool/internel_image_generate.ts
  -> packages/opencode/src/studio/*
```

## 生图接口调用方案

### 调用原则

目的：

明确迁移后生图接口由 UXAI 后端工具统一调用，前端不直接请求内部生图服务，也不请求 5170 Express。

方案：

- Studio 前端只请求 UXAI 后端，不直接请求内部生图服务。
- 普通文本生图优先通过 `globalSDK.client.session.promptAsync()` 进入 `octo_studio` agent。
- 变清晰、抠图、扩图这类确定性操作允许走 `/studio/generations` 直接接口，避免能力参数被 LLM 改写或漏传。
- 无论 agent 链路还是直接接口，最终都必须写出同一种 Studio tool part 历史格式。
- 图片工具在 `packages/opencode/src/tool/internel_image_generate.ts` 或 `packages/opencode/src/tool/jimeng_image_generate.ts` 内调用真实生图接口。
- 工具执行结果写入 tool part 的 `state.output`、`state.attachments`、`state.metadata`。
- Studio 前端通过 SDK event 回流更新 UI。

普通文本生图链路：

```txt
用户点击生成
  -> StudioPage.runGeneration()
  -> globalSDK.client.session.promptAsync({
       agent: "octo_studio",
       tools: { internel_image_generate: true },
       parts: [...]
     })
  -> session loop
  -> internel_image_generate.execute()
  -> create_task
  -> query_task polling
  -> tool part completed
  -> globalSDK.event.listen()
  -> buildStudioTurns()
  -> 渲染图片结果
```

确定性图片操作链路：

```txt
用户点击变清晰 / 抠图 / 扩图
  -> StudioPage.runGeneration()
  -> POST /studio/generations
  -> createGeneration()
  -> internel_image_generate shared executor
  -> create_task
  -> query_task polling
  -> persistStudioSession()
  -> loadSessionMessages() 或 SDK event
  -> buildStudioTurns()
  -> 渲染图片结果
```

两条链路的硬性约束：

- tool part `state.input`、`state.output`、`state.attachments`、`state.metadata` 结构必须一致。
- `turns.ts` 只能实现一套解析逻辑。
- 如果直接接口不能产生和 agent 工具链一致的消息结构，不允许启用直接接口。

### 内部生图服务调用

目的：

复用 5170 `backend/src/tools/generate-image-service.ts` 的 create / query / polling 逻辑，但落到 UXAI 的 tool 层。

方案：

在 `internel_image_generate.ts` 中统一封装：

1. 根据 capability 构造 `createPayload`。
2. 调用 `IMAGE_CREATE_TASK_URL` 创建任务。
3. 从 create response 中提取 `taskId`。
4. 按固定间隔调用 `IMAGE_QUERY_TASK_BASE_URL?task_id=...` 查询任务。
5. 查询到成功状态后从 response 中提取图片 URL。
6. 返回 `ImageGenerateOutput`。

环境变量：

| 变量 | 用途 | 默认/说明 |
|---|---|---|
| `IMAGE_CREATE_TASK_URL` | 内部生图 create_task 地址 | 必须在运行环境配置，5170 当前 fallback 是占位 URL |
| `IMAGE_QUERY_TASK_BASE_URL` | 内部生图 query_task 地址 | 用于拼接 `?task_id=` |
| `IMAGE_USER_IDX` | 调用用户标识 | 默认可沿用当前工具里的值 |
| `IMAGE_TXT2IMG_TASK_TYPE` | 普通文生图默认 task type | 例如 `txt2img_qwen` |
| `IMAGE_IMG2IMG_TASK_TYPE` | 图生图默认 task type | 第一阶段可不启用 |

调用 create task：

```ts
const response = await fetch(createTaskUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(createPayload),
  signal,
})
```

调用 query task：

```ts
const response = await fetch(`${queryTaskBaseUrl}?task_id=${encodeURIComponent(taskId)}`, {
  method: "GET",
  headers: {
    accept: "application/json, text/plain, */*",
  },
})
```

轮询策略：

| 参数 | 建议值 | 说明 |
|---|---:|---|
| `pollIntervalMs` | `2000` | 每 2 秒查询一次 |
| `maxPollCount` | `60` | 最长约 120 秒 |
| `maxCreateRetries` | `3` | create task 失败最多重试 3 次 |
| `createTimeoutMs` | `30000` | create task 单次 30 秒超时 |

成功判定沿用 5170：

- `resp_code === 200`
- `status === 2`
- `progress >= 100`

失败判定：

- `resp_code` 存在且不是 `200`
- `status` 是 `3`、`4`、`-1`
- 轮询超时
- 成功响应中没有可渲染图片 URL

### 图片 URL 提取

目的：

兼容普通生图、抠图和后续接口返回结构差异。

方案：

从 query response 中按优先级提取：

1. `response.result.results`
2. `response.result.results_clean_bg`
3. `response.result.results_v2[].output.clean_bg`
4. `response.result.results_v2[].output.image`

提取结果需要过滤空字符串，并返回：

```ts
{
  provider: "internel",
  model,
  images: images.map((url) => ({ url })),
  request: createPayload,
  raw: queryJson,
  statusCode,
  rawBody,
}
```

### 普通生图调用

目的：

让 `image.generate` 继续调用内部文生图 create_task。

方案：

当 capability 是 `image.generate` 或未识别能力时，构造普通生图 payload：

```ts
{
  user: {
    idx: userIdx,
  },
  task_type: taskType,
  args: {
    tag_name,
    num_image,
    target,
    target_size,
    loras,
    mode,
    ref_img_list: [],
    customer_prompt,
    prompt,
  },
}
```

调用路径：

```txt
buildTextToImageRequestBody()
  -> runInternalImageTask({ toolAction: "generate_image", createPayload })
  -> create_task
  -> query_task polling
  -> extractImages()
```

### 变清晰接口调用

目的：

让 `image.upscale` 使用内部超分接口，而不是普通生图接口。

方案：

当 capability 是 `image.upscale`，构造：

```ts
{
  user: {
    idx: userIdx,
  },
  task_type: "magnify",
  args: {
    mode: "super_resolution",
    image_base64,
  },
}
```

调用路径：

```txt
getSourceImageDataUrl()
  -> buildUpscaleRequestBody()
  -> runInternalImageTask({ toolAction: "super_resolution", createPayload })
  -> create_task
  -> query_task polling
  -> extractImages()
```

注意：

- `sourceImage` 来自当前选中的图片。
- 前端可传 URL 或 data URL。
- 后端统一转换成内部接口接受的 `image_base64` 格式。
- `image_base64` 最终使用 data URL 还是纯 base64，需要迁入时用真实接口确认，并集中在转换函数里处理。

### 抠图接口调用

目的：

让 `image.cutout` 使用内部 remove background 接口。

方案：

当 capability 是 `image.cutout`，构造：

```ts
{
  user: {
    idx: userIdx,
  },
  task_type: "remove_bg",
  args: {
    num_image: 1,
    image_list: [
      {
        mode: "new",
        image_base64,
      },
    ],
  },
}
```

调用路径：

```txt
getSourceImageDataUrl()
  -> buildCutoutRequestBody()
  -> runInternalImageTask({ toolAction: "cutout", createPayload })
  -> create_task
  -> query_task polling
  -> extractImages()
```

### 扩图接口调用

目的：

让 `image.outpaint` 使用内部 outpainting 接口，并支持扩图编辑器传入的方向距离。

方案：

当 capability 是 `image.outpaint`，从 `input.extra` 读取：

- `left`
- `right`
- `top`
- `bottom`
- `numImage`
- `prompt`

构造：

```ts
{
  user: {
    idx: userIdx,
  },
  task_type: "outpainting",
  args: {
    prompt,
    image_base64,
    left,
    right,
    top,
    bottom,
    num_image,
  },
}
```

调用路径：

```txt
getSourceImageDataUrl()
  -> validateOutpaintDistances()
  -> buildOutpaintRequestBody()
  -> runInternalImageTask({ toolAction: "outpainting", createPayload })
  -> create_task
  -> query_task polling
  -> extractImages()
```

### Jimeng 调用保持独立

目的：

不让内部生图接口改造影响即梦工具。

方案：

- `imageTool === "jimeng"` 时继续走 `executeJimengImageGenerate()`。
- `image.upscale`、`image.cutout`、`image.outpaint` 第一阶段强制走 `internel`。
- 只有 `image.generate` 和后续明确支持的能力允许切换到 `jimeng`。

前端工具选择规则：

```ts
const selectedTool =
  input.capability === "image.generate" && imageTool() === "jimeng"
    ? "jimeng_image_generate"
    : "internel_image_generate"
```

后端 `studio-service.ts` 也需要兜底：

- 如果 `capability !== "image.generate"`，即使 `imageTool` 传入 `jimeng`，也应选择 `internel` 或返回明确错误。

### 结果回写

目的：

确保真实生图结果进入 UXAI session，而不是只存在前端临时状态。

方案：

工具返回后，agent 工具链和 `studio-service.ts` 直接链路都需要记录同一份 output contract：

```ts
{
  ok: true,
  provider: "internel",
  capability,
  toolAction,
  taskId,
  model,
  aspectRatio,
  width,
  height,
  images,
  primaryImage,
  request,
  response,
}
```

并把图片写入 `attachments`：

```ts
attachments: images.map((image, index) => ({
  type: "file",
  mime: "image/png",
  filename,
  url: image,
}))
```

前端恢复历史时优先读 attachments，再读 output JSON。

## 实施步骤

### 1. 建立能力映射表

目的：

统一 5170 的 mode / toolAction 与 UXAI 的 Studio capability，避免前端、prompt、tool 各自维护一套枚举。

方案：

在 UXAI Studio 文档或代码中明确以下映射：

| 5170 mode | 5170 toolAction | UXAI capability | 后端任务 |
|---|---|---|---|
| `image` | `generate_image` | `image.generate` | 普通文生图 |
| `video` | 暂不迁入 | `video.generate` | 暂保留入口或置灰 |
| `upscale` | `super_resolution` | `image.upscale` | `task_type="magnify"` |
| `cutout` | `cutout` | `image.cutout` | `task_type="remove_bg"` |
| `inpaint` | 暂不迁入 | `image.inpaint` | 后续补 builder |
| `outpaint` | `outpainting` | `image.outpaint` | `task_type="outpainting"` |
| `scene` | 暂按普通生图 | `image.fusion` | 后续补融合能力 |

落地位置建议：

- 前端静态配置：`packages/app/octoapp/pages/studio/data.ts`
- 后端 capability 类型：`packages/opencode/src/studio/image-provider.ts`
- 内部工具分发：`packages/opencode/src/tool/internel_image_generate.ts`

### 2. 抽象 Studio 工具请求上下文

目的：

让普通生图、变清晰、抠图、扩图走同一个工具入口，但由清晰的 builder 分别构造 request body。

方案：

在 `internel_image_generate.ts` 中整理出统一上下文：

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
```

新增统一分发函数：

```ts
async function buildInternalRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  if (getStudioCapability(input) === "image.upscale") return buildUpscaleRequestBody(input, context)
  if (getStudioCapability(input) === "image.cutout") return buildCutoutRequestBody(input, context)
  if (getStudioCapability(input) === "image.outpaint") return buildOutpaintRequestBody(input, context)
  return buildTextToImageRequestBody(input, context)
}
```

每个 builder 只负责一种能力，不在主执行函数里堆条件分支。

### 3. 迁入普通生图 payload 细节

目的：

复用 5170 中更完整的风格模型、比例、数量、LoRA、target、mode 配置，同时保持 UXAI 当前 `internel_image_generate` 的接口形态。

方案：

对照 5170 的 `imageStyleConfigs` 和 UXAI 当前 `getInternalStyleConfig()`，统一以下字段：

- `task_type`
- `tag_name`
- `target`
- `target_size`
- `loras`
- `mode`
- `num_image`
- `customer_prompt`
- `prompt`

普通生图 builder 输出：

```ts
{
  user: { idx: context.userIdx },
  task_type: context.taskType,
  args: {
    tag_name,
    num_image,
    target,
    target_size,
    loras,
    mode,
    ref_img_list: [],
    customer_prompt,
    prompt,
  },
}
```

注意：

- `styleModel` 名称需要做兼容映射，例如 5170 的 `qianwen` 对 UXAI 当前 `qwen`。
- 默认比例当前 UXAI 是 `3:4`，5170 是 `1:1`，需要产品确认后统一；技术上建议沿用 UXAI 当前默认，避免现有行为变化。

### 4. 迁入变清晰能力

目的：

让 Studio 右侧“变清晰”和 composer 的“变清晰”都能走真实后端能力，并写回 UXAI session 历史。

方案：

前端：

- 使用当前选中图片作为 `sourceImage`。
- 调用现有 `runGeneration({ capability: "image.upscale", sourceImage, prompt })`。
- 保持 pending turn、画布 loading、事件回流逻辑不变。

后端：

- builder 固定生成：

```ts
{
  user: { idx: context.userIdx },
  task_type: "magnify",
  args: {
    mode: "super_resolution",
    image_base64,
  },
}
```

- `image_base64` 由 `sourceImage` 转换得到。
- 如果 `sourceImage` 是 data URL，直接使用。
- 如果是 http(s) URL，由后端 fetch 后转 data URL 或纯 base64，按接口要求统一。
- 如果没有源图，抛出明确错误。

### 5. 迁入抠图能力

目的：

补齐 5170 已有的 remove background 能力，让 Studio “抠图”按钮从静态入口变成可执行工具。

方案：

前端：

- `StudioDetails` 增加 `onCutout`。
- 点击当前图片的“抠图”时调用：

```ts
runGeneration({
  capability: "image.cutout",
  sourceImage: selectedImage.remoteUrl ?? selectedImage.url,
  prompt: "对当前图片进行抠图，移除背景并保留主体",
})
```

后端：

builder 固定生成：

```ts
{
  user: { idx: context.userIdx },
  task_type: "remove_bg",
  args: {
    num_image: 1,
    image_list: [
      {
        mode: "new",
        image_base64,
      },
    ],
  },
}
```

结果解析继续复用现有 `extractImages()` 逻辑，需要确保支持 `results_clean_bg` 和 `results_v2.output.clean_bg`。

### 6. 迁入扩图能力

目的：

把 5170 的扩图编辑器能力迁入 UXAI Studio，让用户可以在当前图基础上设置扩展方向和距离。

方案：

前端：

- 保留 UXAI 当前 `StudioOutpaintEditor` 的入口，逐步替换为 5170 `StudioEnlarging.vue` 的 Solid 版本。
- 扩图编辑器需要输出：
  - `prompt`
  - `imageBase64` 或 `sourceImage`
  - `left`
  - `right`
  - `top`
  - `bottom`
  - `numImage`
  - `realWidth`
  - `realHeight`
- 通过 `runGeneration()` 的 `extra` 或专门参数传给 prompt/tool。

后端：

builder 固定生成：

```ts
{
  user: { idx: context.userIdx },
  task_type: "outpainting",
  args: {
    prompt,
    image_base64,
    left,
    right,
    top,
    bottom,
    num_image,
  },
}
```

校验规则：

- `left/right/top/bottom` 必须是非负数。
- 四个方向不能全为 0。
- 必须有源图。

### 7. 统一 source image 转换

目的：

变清晰、抠图、扩图都依赖当前图片，不能让每个 builder 自己处理图片读取。

方案：

新增工具函数：

```ts
async function getSourceImageDataUrl(input: ImageGenerateInput) {
  const sourceImage = input.sourceImage ?? input.referenceImages?.[0]
  if (!sourceImage) throw new Error("This Studio action requires a source image.")
  if (sourceImage.startsWith("data:image/")) return sourceImage
  const response = await fetch(sourceImage)
  if (!response.ok) throw new Error(`Failed to fetch source image: ${response.status}`)
  return `data:${response.headers.get("content-type") ?? "image/png"};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`
}
```

如果内部接口需要纯 base64，再加：

```ts
function dataUrlToBase64(value: string) {
  return value.split(",")[1] ?? value
}
```

最终格式以内部接口实际要求为准。5170 当前传的是 data URL，UXAI 当前计划中有纯 base64 表述，迁入时需要通过一次真实接口请求确认。

### 8. 迁入 Agent 规划能力

目的：

让多轮图片修改不只是“当前输入文本”，而能继承上一轮主体、风格、场景、构图、光影和色彩。

方案：

5170 的 `ImageGenerationAgent` 有两类能力：

- planner：判断 `generate_image` / `super_resolution` / `cutout` / `outpainting`。
- state：维护 `subject/style/scene/composition/lighting/colorPalette` 等图片上下文。

迁入有两种路线：

1. 轻量路线：
   - 不迁入完整 planner。
   - 继续使用 UXAI 当前 `buildStudioPromptText()` 和 `buildStudioConversationContext()`。
   - 增加更结构化的“上一轮摘要”，包含主体、风格、场景等字段。

2. 完整路线：
   - 将 5170 planner 改造成 `packages/opencode/src/studio/studio-planner.ts`。
   - 在 `createGeneration()` 或 `internel_image_generate` 前调用 planner。
   - planner 输出结构化 `StudioPlan`，再交给 builder。

建议先走轻量路线，避免同时改动前端、agent、tool、session 持久化。等工具能力稳定后，再把 planner 抽进后端。

### 9. 前端 UI 迁移

目的：

吸收 5170 更完整的交互体验，但不引入 Vue，不破坏 UXAI 现有 session 数据流。

方案：

按组件逐步替换，而不是一次性重写：

1. `ComposerPanel.vue` -> `StudioComposer`
   - 保留 Solid 组件。
   - 迁入 mode/style/settings 菜单视觉。
   - mode 直接绑定 `StudioCapability`。

2. `ImageStudio.vue` 详情区 -> `StudioDetails`
   - 迁入当前图信息、结果数量、尺寸、taskId、风格标签。
   - 增加 `onCutout`。
   - 扩图按钮进入编辑器模式。

3. `StudioEnlarging.vue` -> `StudioOutpaintEditor`
   - 迁入 canvas / Konva 交互需要谨慎评估。
   - 如果继续用 Konva，需要在 UXAI app workspace 增加依赖。
   - 如果不加依赖，先用 DOM + CSS 实现方向距离输入版本。

4. 历史列表不迁入 5170 localStorage 版本。
   - 继续使用 UXAI `StudioHistory`。
   - 会话来源仍然是 `globalSDK.client.session.list()`。

### 10. 调整历史重建

目的：

确保从 UXAI session 重新打开 Studio 时，可以正确还原图片能力、比例、模型、taskId 和图片结果。

方案：

增强 `packages/app/octoapp/pages/studio/turns.ts`：

- 从 tool part `state.input` 解析：
  - `capability`
  - `styleModel`
  - `aspectRatio`
  - `count`
  - `sourceImage`
  - `extra`
- 从 tool part `state.output` 解析：
  - `images`
  - `primaryImage`
  - `taskId`
  - `toolAction`
- 从 tool part `state.metadata` 解析原始 request / response。

当前 `buildResult()` 默认把历史 result 的 capability 写成 `image.generate`，迁移后需要改成从 tool 输入或输出恢复真实 capability。

### 11. 扩展后端返回和持久化字段

目的：

让前端详情面板可以显示 5170 中已有的 taskId、尺寸、工具动作等信息。

方案：

扩展 `StudioGenerationResult` 或 tool output JSON：

```ts
{
  ok: true,
  provider,
  model,
  capability,
  toolAction,
  taskId,
  width,
  height,
  aspectRatio,
  images,
  primaryImage,
  response,
}
```

同时保持当前字段兼容：

- `images`
- `primaryImage`
- `response`

避免破坏 `turns.ts` 现有图片提取逻辑。

### 12. 错误处理和超时策略

目的：

迁入 5170 的任务轮询后，避免生成失败时只表现为空图或无响应。

方案：

统一错误文案：

- create task HTTP 失败。
- create task 业务失败。
- query task 失败。
- query task 返回失败状态。
- 轮询超时。
- 结果中没有图片 URL。
- 源图转 base64 失败。

后端错误通过 tool part `state.status="error"` 或 `StudioGenerationError` 返回，前端沿用当前失败卡片展示。

轮询参数沿用 5170 的默认值：

- `pollIntervalMs: 2000`
- `maxPollCount: 60`
- `maxCreateRetries: 3`
- `createTimeoutMs: 30000`

### 13. 测试计划

目的：

迁移会触碰前端历史重建和后端工具 builder，需要防止 session 历史和图片提取退化。

方案：

前端单元测试：

- `turns.ts` 能从 tool input 恢复 `image.upscale`。
- `turns.ts` 能从 `results_clean_bg` / `results_v2.output.clean_bg` 提取抠图结果。
- `turns.ts` 能恢复 outpaint 的 `taskId` 和尺寸。
- pending result 与真实 tool result 回流后不会重复显示。

后端单元测试：

- `image.generate` 生成普通 payload。
- `image.upscale` 生成 `magnify` payload。
- `image.cutout` 生成 `remove_bg` payload。
- `image.outpaint` 生成 `outpainting` payload。
- source image 支持 data URL 和 http URL。
- 源图缺失时抛出明确错误。

手动验证：

- 新建 Studio 会话生成图片。
- 切换会话后结果可恢复。
- 点击变清晰生成新一轮结果。
- 点击抠图生成透明/去背景结果。
- 点击扩图进入编辑器并生成结果。
- 刷新页面后历史仍能恢复。

类型检查：

- 前端修改后在 `packages/app` 运行 `bun typecheck`。
- 后端工具修改后在 `packages/opencode` 运行 `bun typecheck`。

## 推荐执行顺序

1. 先定义并测试 Studio tool part output contract，确保 agent 链路和 direct API 链路写出的历史同构。
2. 再迁后端 shared executor 和 builder：普通生图、变清晰、抠图、扩图。
3. 增强 `turns.ts` 的历史恢复能力，按统一 contract 解析能力、taskId、尺寸、图片和错误。
4. 接入普通生图 composer mode，继续走 agent 链路。
5. 接入变清晰、抠图、扩图按钮，优先走 `/studio/generations`；如果 direct API 历史同构未完成，则临时走 agent 链路。
6. 最后迁扩图编辑器视觉和更完整详情区。

这样每一步都能单独验证，避免一次性迁 UI、状态、后端、历史导致问题难定位。

## 风险和取舍

### Vue 到 Solid 迁移成本

5170 页面不能直接复制进 UXAI。正式实现需要把 Vue 组件翻译成 Solid 组件，尤其是扩图编辑器的响应式和事件处理。

建议：

- 普通 composer 和详情区直接改现有 Solid 组件。
- 扩图编辑器先迁最小功能，再迁复杂交互。

### Konva 依赖

5170 扩图编辑器使用 Konva / vue-konva。UXAI 当前 app 不一定有 Konva。

建议：

- 如果只需要方向和距离输入，先不用 Konva。
- 如果需要完整画布拖拽体验，再评估加入 `konva`，不要引入 `vue-konva`。

### 内部接口 image_base64 格式

5170 的 `superResolutionService` 检查的是 data URL，但字段名叫 `image_base64`。UXAI 之前方案中写过纯 base64。

建议：

- 迁入时通过真实请求确认内部接口接受格式。
- 在工具函数中集中转换，避免 builder 到处处理。

### Planner 迁入时机

完整迁入 5170 planner 会改变多轮语义，风险高。

建议：

- 第一阶段先迁工具动作和 payload builder。
- 第二阶段再迁结构化 planner。

## 二次审视补充缺口

### 1. 直接接口与 Agent 工具链边界

缺口：

当前方案同时提到了 `globalSDK.client.session.promptAsync()` 和 `/studio/generations` / `createGeneration()`，但没有明确正式 Studio 到底走哪条链路。

影响：

- 如果普通输入走 agent，右侧按钮走 `/studio/generations`，历史消息格式会不一致。
- 如果全部走 agent，变清晰、抠图这类确定性操作会多经过一次 LLM 规划，速度和稳定性会受影响。
- 如果全部走直接 API，就失去 `octo_studio` agent 的自然语言多轮规划能力。

补充方案：

第一阶段按操作类型分流，但统一历史格式：

```txt
普通文本生图:
Studio UI -> session.promptAsync -> octo_studio -> image tool -> tool part

确定性图片操作:
Studio UI -> /studio/generations -> createGeneration() -> persistStudioSession()
```

原因：

- 普通生图保留 `octo_studio` 的多轮自然语言规划能力。
- 变清晰、抠图、扩图避免经过 LLM 后丢失 `capability`、`sourceImage`、扩图距离等确定性参数。
- 只要两条链路都写出同构 tool part，`turns.ts` 和 UI 仍然只需要一套历史解析逻辑。

禁止的中间态：

```txt
普通生图一种 message 格式，直接操作另一种 message 格式
```

如果 `persistStudioSession()` 暂时不能写出与 agent 工具链一致的 part，就先让确定性操作继续走 agent，并把 direct API 作为后续任务。

### 2. API 鉴权与请求头

缺口：

当前方案只写了 `IMAGE_CREATE_TASK_URL` / `IMAGE_QUERY_TASK_BASE_URL`，没有写内部生图服务是否需要鉴权、Cookie、Token、租户 header 或业务 header。

影响：

- 开发环境可跑，桌面 sidecar 或生产环境可能无法调用内部接口。
- 鉴权散落在代码中会导致配置难迁移。

补充方案：

统一增加内部图片 API 请求头配置函数：

```ts
function internalImageHeaders() {
  return {
    "content-type": "application/json",
    ...(env("IMAGE_API_TOKEN") ? { authorization: `Bearer ${env("IMAGE_API_TOKEN")}` } : {}),
    ...(env("IMAGE_API_COOKIE") ? { cookie: env("IMAGE_API_COOKIE") } : {}),
  }
}
```

建议支持的环境变量：

| 变量 | 用途 |
|---|---|
| `IMAGE_API_TOKEN` | Bearer token |
| `IMAGE_API_COOKIE` | 内部服务 cookie |
| `IMAGE_API_CLIENT_ID` | 如内部网关需要 client id |
| `IMAGE_API_CLIENT_SECRET` | 如内部网关需要 client secret |

日志中不能输出这些值。

### 3. Desktop Sidecar 运行时配置

缺口：

文档没有说明桌面 App 中这些环境变量从哪里进入 opencode sidecar。

影响：

- 本地 shell 中能跑，但 Electron 桌面启动后 sidecar 可能没有 `IMAGE_CREATE_TASK_URL` 等变量。

补充方案：

- 确认 `packages/desktop/src/main/server.ts` 的 sidecar env 会继承 shell env。
- 如需产品化配置，需要在设置页或本地配置文件中写入内部生图配置。
- 不建议把内部接口地址和 token 写死进前端 bundle。

验收点：

- `bun run dev:desktop` 下可以读取生图环境变量。
- 打包后的桌面 App 可以通过用户配置或系统环境变量读取相同配置。

### 4. 日志脱敏

缺口：

当前工具实现里会 `console.log("[studio.internel] request", JSON.stringify(debugRequest, null, 2))`。如果请求体包含 `image_base64`，会把整张图写进日志。

影响：

- 日志巨大。
- 泄漏用户图片。
- 影响性能和可读性。

补充方案：

所有 request / response 日志必须脱敏：

```ts
function redactImagePayload(value: unknown): unknown {
  // image_base64 / data:image / binary_data_base64 只保留长度、mime、hash 或 "<redacted>"
}
```

日志只记录：

- capability
- task_type
- taskId
- prompt 长度
- 图片数量
- base64 字节数
- sourceImage 类型
- status / progress

不能记录：

- 完整 base64
- 完整 token / cookie
- 用户敏感 prompt 的长文本，除非开发开关开启。

### 5. Source Image 安全边界

缺口：

方案写了后端 `fetch(sourceImage)`，但没有限制 URL 来源、大小、类型和超时。

影响：

- SSRF 风险。
- 下载超大图片导致内存问题。
- 非图片 URL 导致内部接口失败。
- 私有网络地址被服务端请求。

补充方案：

`getSourceImageDataUrl()` 需要校验：

- 只允许 `data:image/*`、`http:`、`https:`。
- `http(s)` 下载设置超时。
- 限制最大文件大小，例如 20MB。
- 校验 `content-type` 以 `image/` 开头。
- 禁止访问内网 IP、localhost、link-local 地址，除非显式开发开关允许。

如果当前图片来自内部生图结果 URL，需要确认这些 URL 是否能被 sidecar 访问；不能访问时前端应传 data URL 或后端需要通过已有认证下载。

### 6. 图片结果持久化策略

缺口：

当前方案默认把返回 URL 写入 attachments，但没有处理远程 URL 过期、权限失效或跨设备不可访问。

影响：

- 历史 session 过几天重新打开，图片可能失效。
- 用户切换网络或机器后无法查看历史图。

补充方案：

分两阶段：

第一阶段：

- 保留远程 URL。
- `turns.ts` 能解析并展示。
- 失败时显示明确占位。

第二阶段：

- 后端下载生成结果，写入 UXAI 管理的本地/对象存储资产。
- tool attachments 使用稳定资产 URL 或本地文件引用。
- 记录原始 remoteUrl 作为 metadata。

需要避免把大 base64 直接长期写入 sqlite message part，防止数据库膨胀。

### 7. 任务取消、并发和过期结果

缺口：

文档写了轮询，但没有定义用户切换会话、关闭页面、再次提交、取消生成时怎么办。

影响：

- 旧任务完成后可能覆盖当前选图。
- 多次点击可能创建多个任务。
- 长轮询无法取消，浪费资源。

补充方案：

前端：

- `isBusy()` 时禁用提交和工具按钮。
- 每次 pending result 绑定 `sessionID`、`requestID`、`createdAt`。
- event 回流时只更新同 session 的结果。

后端：

- `createTaskWithRetry()` 和 `queryTask()` 支持 `AbortSignal`。
- 如果 session loop 已中止，停止轮询。
- 如果内部服务支持取消任务，后续接入 cancel endpoint。

第一阶段可不做真实取消，但必须防止 stale result 覆盖当前 UI。

### 8. Progress 回流

缺口：

内部 query task 有 `progress`，但方案只在完成后回写，前端无法展示真实进度。

影响：

- 长任务用户只能看到“生成中”。
- 失败前没有状态信息。

补充方案：

第一阶段：

- 只展示通用 pending loading。
- tool 完成或失败后一次性更新。

第二阶段：

- 在 tool running state metadata 中写入 progress。
- 或通过 session event 增加 progress part delta。
- 前端 `StudioConversation` / `StudioResultCanvas` 展示百分比。

如果没有事件机制支持中间 progress，不要为了 progress 引入独立 HTTP polling。

### 9. 工具参数结构化传递

缺口：

当前 UXAI Studio 有一部分参数靠 prompt 中的 `工具参数JSON` 再由 tool 解析。迁移后如果继续这样做，扩图距离、sourceImage、能力类型都容易被模型漏传或改写。

影响：

- 模型可能没有把 `capability` 传进 tool。
- outpaint 的 `left/right/top/bottom` 可能丢失。
- 变清晰被误走普通生图。

补充方案：

普通文本生图可以继续通过 agent 调 tool，但必须尽量通过 tool schema 结构化传参：

```ts
tools: {
  internel_image_generate: true,
}
parts: [...]
```

同时在 agent prompt 中要求调用工具时传：

- `capability`
- `styleModel`
- `aspectRatio`
- `count`
- `sourceImage`
- `extra`

后端再做兜底解析 prompt 中的 `工具参数JSON`，但不把 prompt JSON 作为唯一来源。

确定性图片操作不依赖模型转述参数：

- `image.upscale`
- `image.cutout`
- `image.outpaint`

这三类操作优先通过 `/studio/generations` 传结构化 JSON 到后端；只有在 direct API 还不能写出同构 tool part 时，才临时走 agent 链路。

后续增强方向：

- 为 session loop 增加 server-side Studio request context，让 UI 侧 capability 不经过模型改写也能被 tool 读取。
- 或提供 first-class direct tool invocation API，并由服务端统一写 message / part。

### 10. API Schema 与 SDK 生成

缺口：

如果修改 `/studio/generations` HttpApi schema 或 SDK 类型，文档没有提醒重新生成 JS SDK。

影响：

- `@opencode-ai/sdk` 生成类型过期。
- 前后端字段不一致。

补充方案：

只要修改：

- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- OpenAPI schema
- SDK 暴露类型

就必须运行：

```sh
./packages/sdk/js/script/build.ts
```

如果第一阶段只走 `session.promptAsync()` 且不改 HttpApi schema，则不用生成 SDK。

### 11. 能力置灰与产品边界

缺口：

文档列了 `video.generate`、`image.inpaint`、`image.fusion`，但没有定义未实现时 UI 怎么表现。

影响：

- 用户能选择但实际失败。
- 后端 fallback 到普通生图造成误导。

补充方案：

第一阶段明确支持：

- `image.generate`
- `image.upscale`
- `image.cutout`
- `image.outpaint`

暂不支持：

- `video.generate`
- `image.inpaint`
- `image.fusion`

UI 处理：

- 暂不支持项置灰或显示“即将支持”。
- 不允许提交 unsupported capability。

后端处理：

- 不支持能力返回明确错误，不 fallback 成普通生图。

### 12. 风格模型 ID 兼容

缺口：

5170 使用 `qianwen`、`bdicon`、`smart3d`，UXAI 使用 `qwen`、`bd-icon`、`smart-3d` 等 ID。文档只提了一句兼容映射，没有定义映射表。

影响：

- 历史会话里的 styleModel 无法正确显示。
- payload builder 取不到对应 LoRA。

补充方案：

建立映射表：

| UXAI ID | 5170 ID | 显示名 |
|---|---|---|
| `qwen` | `qianwen` | 千问 |
| `bd-icon` | `bdicon` | BDIcon |
| `smart-3d` | `smart3d` | 智慧3D |
| `xiaoyi` | `agent` | 小艺agent |
| `hongmeng` | `harmony` | 鸿蒙插画 |
| `3d-abstract` | `abstract3d` | 3D抽象元素 |

内部 builder 只接受归一化后的 ID。

### 13. 结果 MIME 与透明图

缺口：

抠图结果可能是透明 PNG，但当前 attachments 固定 `mime: "image/png"`，普通结果也可能是 jpg/webp。

影响：

- 下载文件扩展名不准确。
- 透明图预览和保存可能不一致。

补充方案：

- 从 URL 后缀、响应 header 或 data URL 解析 MIME。
- attachments 记录真实 mime。
- 文件名扩展名根据 mime 生成。
- 抠图默认按 PNG 保存。

### 14. 测试 HTTP Server

缺口：

后端测试只说 builder 单测，没有说明如何测 create/query 轮询。

影响：

- 很容易只测 payload，不测真实轮询状态机。

补充方案：

在 `packages/opencode` 测试中启动本地 Hono/Bun test server 或 mock fetch handler：

- create_task 第一次 500、第二次成功，验证重试。
- create_task 成功但无 taskId，验证错误。
- query_task 运行中 -> 成功，验证轮询。
- query_task 失败状态，验证错误。
- query_task 超时，验证错误。

避免 mock 业务逻辑，只模拟外部 HTTP 边界。

### 15. 灰度与回滚

缺口：

没有说明上线后如何回滚到旧 Studio 行为。

影响：

一旦新 tool builder 或 UI 出问题，会影响所有 Studio 生图。

补充方案：

增加 feature flag：

| 开关 | 用途 |
|---|---|
| `OCTO_STUDIO_INTERNAL_BUILDER_V2` | 是否启用迁入后的 internal payload builder |
| `OCTO_STUDIO_CUTOUT_ENABLED` | 是否开放抠图 |
| `OCTO_STUDIO_OUTPAINT_ENABLED` | 是否开放扩图 |
| `OCTO_STUDIO_PLANNER_V2` | 是否启用 5170 planner |

第一阶段默认只开普通生图和变清晰；抠图、扩图按开关逐步开放。

## 最终验收标准

- Studio 页面不依赖 `localhost:5170` 或 `localhost:3001`。
- 所有图片生成历史都存在 UXAI session 中。
- 普通生图和变清晰默认可通过现有 Studio 页面触发。
- 抠图、扩图在对应 feature flag 开启后可通过现有 Studio 页面触发；未开启时 UI 必须置灰或隐藏。
- 重新打开 Studio session 后能看到历史图片、能力、模型、比例和提示词。
- agent 链路和 `/studio/generations` 直接链路写出的 message / part contract 一致，`turns.ts` 只有一套解析逻辑。
- 后端工具 builder 有单元测试覆盖。
- create/query 轮询状态机有 HTTP 边界测试覆盖。
- `packages/app` 和 `packages/opencode` 分别通过 `bun typecheck`。
