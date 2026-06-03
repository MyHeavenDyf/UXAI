# Studio 局部重绘实现方案

## 目标

根据 `/Users/ljc/Documents/workspace/image-agent-studio-vite-express/docs/aa.md` 的智能重绘设计，在 UXAI 现有 Studio 中复刻“局部重绘”能力。

本方案只覆盖 Studio 内已有图片的局部编辑闭环：

- 从当前选中图片进入局部重绘编辑器。
- 在图片上涂抹要重绘或消除的区域。
- 支持笔刷粗细、撤销、重做、清空。
- 支持“重绘 / 消除”两种模式。
- 生成时复用 UXAI 现有 `/studio/generations` 和 `internel_image_generate` 能力。
- 生成结果继续写入 `octo_studio` 会话，并在 Studio 历史中展示。

非目标：

- 不实现文档里的上传组件。
- 不实现埋点。
- 不实现“一键生成”以外的独立业务接口调用。
- 不引入 Vue 运行时。
- 不长期依赖 `image-agent-studio-vite-express` 工程。

## 现状

关键文件：

- `packages/app/octoapp/pages/studio/index.tsx`
- `packages/app/octoapp/pages/studio/studio.css`
- `packages/app/octoapp/pages/studio/types.ts`
- `packages/app/octoapp/pages/studio/data.ts`
- `packages/opencode/src/studio/studio-service.ts`
- `packages/opencode/src/tool/internel_image_generate.ts`

当前已有基础：

- `StudioCapability` 已包含 `image.inpaint`。
- 能力菜单 `STUDIO_CAPABILITIES` 已包含“局部重绘”，但前端 `SUPPORTED_STUDIO_CAPABILITIES` 暂未启用。
- 右侧详情面板已有“局部重绘”按钮，但没有点击事件。
- Studio 已有 `mode()` 编辑工作区模式，当前支持 `preview`、`hd`、`outpaint`。
- `runGeneration()` 已能复用同一套 pending、会话持久化、结果刷新流程。
- 后端 `internel_image_generate.ts` 已有独立 builder 分发结构，当前支持普通生图、变清晰、抠图、扩图。

## 总体链路

```txt
用户点击“局部重绘”
  -> StudioPage.openInpaint()
  -> 右侧工作区切换到 StudioInpaintEditor
  -> 用户在图片上涂抹 mask
  -> 用户选择“重绘 / 消除”、调整笔刷、输入 prompt
  -> StudioInpaintEditor 生成原图 + mask 的合成图 base64
  -> StudioPage.submitInpaint()
  -> runGeneration({ capability: "image.inpaint", sourceImage, prompt, extra })
  -> POST /studio/generations
  -> createGeneration()
  -> executeInternelImageGenerate()
  -> buildInpaintRequestBody()
  -> create_task / query_task
  -> tool part attachments
  -> Studio 会话流刷新
```

## 前端方案

### 1. 启用能力入口

位置：`packages/app/octoapp/pages/studio/index.tsx`

把 `image.inpaint` 加入 `SUPPORTED_STUDIO_CAPABILITIES`。

扩展编辑模式类型：

```ts
export type StudioMode = "preview" | "hd" | "outpaint" | "inpaint"
```

位置：`packages/app/octoapp/pages/studio/types.ts`

### 2. 右侧按钮接入

给 `StudioDetails` 增加 `onInpaint` prop，并把“局部重绘”按钮接到事件上。

`StudioPage` 中增加：

```ts
function openInpaint() {
  if (!selectedImage()) return
  setMode("inpaint")
}
```

传入详情面板：

```tsx
<StudioDetails
  ...
  onInpaint={openInpaint}
/>
```

### 3. 新增 StudioInpaintEditor

建议先放在 `packages/app/octoapp/pages/studio/index.tsx` 内，和 `StudioHDEditor`、`StudioOutpaintEditor` 保持同文件模式。后续若文件继续膨胀，再拆到 `inpaint-editor.tsx`。

组件职责对应原文档里的 `FusionEditDraw.vue` 和 `FusionEditDrawCanvas.vue`，但用 Solid + 原生 Canvas 实现，不引入 Fabric.js。理由：

- 当前仓库没有 Fabric.js 依赖。
- 局部重绘只需要自由涂抹、撤销/重做、mask 输出，原生 Canvas 足够。
- 避免新增大依赖和打包风险。

组件输入：

```ts
function StudioInpaintEditor(props: {
  image: StudioImage
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    prompt: string
    mode: "qwen_image_edit" | "erase"
    sourceImage: string
    compositeImage: string
    hasDrawing: boolean
  }) => void
}): JSX.Element
```

核心状态：

| 状态 | 说明 |
|---|---|
| `editMode` | `"qwen_image_edit"` 重绘，`"erase"` 消除 |
| `brushSize` | 默认 40，范围 10 到 126 |
| `localPrompt` | 局部重绘提示词 |
| `displaySize` | 图片在编辑器中的展示尺寸 |
| `sourceSize` | 图片原始像素尺寸 |
| `undoList` | mask 快照栈，首项为空 mask |
| `redoList` | 重做栈 |
| `isDrawing` | 鼠标或触控绘制中 |

DOM 结构：

```txt
studio-inpaint
├── header: 标题、图片信息、关闭
├── body
│   ├── canvas-wrap
│   │   ├── img 背景图
│   │   ├── canvas mask 层
│   │   └── cursor 圆形笔刷预览
│   └── controls
│       ├── 重绘 / 消除 segmented control
│       ├── 清空 / 撤销 / 重做按钮
│       ├── 笔刷 slider
│       ├── prompt textarea
│       └── 一键生成按钮
```

### 4. 画布绘制策略

使用两个尺寸概念：

- `displaySize`：编辑器中实际显示尺寸，受工作区大小限制。
- `sourceSize`：图片原始尺寸，用于最终输出。

显示时：

- 图片用 `<img>` 展示。
- `canvas` 覆盖在图片上，宽高等于 `displaySize`。
- mask 涂抹颜色使用 `rgba(137, 71, 213, 0.3)`，光标预览用同色系圆形边框。

绘制时：

- `pointerdown` 开始路径。
- `pointermove` 用 `lineCap = "round"`、`lineJoin = "round"`、`strokeStyle = "rgba(137, 71, 213, 0.3)"`、`lineWidth = brushSize` 绘制。
- `pointerup` 把当前 mask canvas 的 `ImageData` 或 data URL 压入 `undoList`，并清空 `redoList`。
- 支持鼠标和触控，使用 pointer events。

撤销/重做：

- `undoList[0]` 始终为空 mask。
- 撤销时弹出当前快照到 `redoList`，恢复 `undoList.at(-1)`。
- 重做时弹出 `redoList.at(-1)` 到 `undoList`，并恢复。
- 清空时恢复 `undoList[0]`，清空 `redoList`。

### 5. mask 和图片输出

提交时生成三个值：

1. `sourceImage`：当前选中图片。优先使用 `image.remoteUrl ?? image.url`，若后端需要 base64，会由已有 `getSourceImageDataUrl()` fetch/转换。
2. `compositeImage`：原图与 mask 叠加后的 PNG base64，传给实际 inpainting 接口。
3. `hasDrawing`：编辑区是否存在真实涂抹痕迹，直接决定后端 `args.has_drawing`。

`compositeImage` 生成方式：

```txt
source image + display mask canvas
  -> 加载原图到 sourceSize 离屏 canvas
  -> drawImage(sourceImage, 0, 0, sourceWidth, sourceHeight)
  -> drawImage(displayMaskCanvas, 0, 0, sourceWidth, sourceHeight)
  -> toDataURL("image/png")
  -> 去掉 data:image/png;base64, 前缀
  -> 得到纯 base64 字符串
```

`hasDrawing` 判断：

- 必须根据编辑区是否有涂抹痕迹判断，而不是固定写死。
- 可以维护 `undoList.length >= 2` 做 UI 按钮启用判断。
- 提交前建议扫描 mask canvas alpha 通道兜底，避免空路径或撤销后误判。

实际接口只接受“原图 + mask”合成图的 base64，因此前端需要在提交前完成合成。后端 `buildInpaintRequestBody()` 不再独立传 `mask_base64`，而是把 `compositeImage` 放入 `args.image_base64`。

### 6. 提交逻辑

`StudioPage` 新增：

```ts
function submitInpaint(input: {
  prompt: string
  mode: "qwen_image_edit" | "erase"
  sourceImage: string
  compositeImage: string
  hasDrawing: boolean
}) {
  if (isBusy() || !input.hasDrawing) return
  void runGeneration({
    capability: "image.inpaint",
    sourceImage: input.sourceImage,
    prompt: input.prompt || (input.mode === "erase" ? "消除涂抹区域内的物体" : "重绘所选区域"),
    extra: {
      generateMode: input.mode,
      compositeImage: input.compositeImage,
      hasDrawing: input.hasDrawing,
    },
  })
}
```

`handleSubmit()` 中，如果顶部能力选择为 `image.inpaint`，没有必要直接生成；建议要求用户先选中图片并打开编辑器：

```ts
if (capability() === "image.inpaint") {
  openInpaint()
  return
}
```

### 7. Pending 文案

优化 `buildStudioThinkingText()`：

- `image.inpaint`：`好的，我将根据涂抹区域局部重绘当前图片。`
- `erase` 模式可通过 `extra.generateMode` 在 pending 文案中显示为“消除涂抹区域”。

这不是功能必需，但可以避免显示成“生成一张 3:4 比例的局部重绘”。

## 后端方案

### 1. toolAction 扩展

位置：`packages/opencode/src/studio/studio-service.ts`、`packages/opencode/src/tool/internel_image_generate.ts`、必要时 `packages/opencode/src/studio/image-provider.ts`

当前 `toolAction` 类型没有 inpainting。建议扩展：

```ts
type InternalToolAction = "generate_image" | "super_resolution" | "cutout" | "outpainting" | "inpainting"
```

`toolActionForCapability()` 增加：

```ts
if (capability === "image.inpaint") return "inpainting"
```

### 2. 增加 buildInpaintRequestBody

位置：`packages/opencode/src/tool/internel_image_generate.ts`

新增 helper：

```ts
function getExtraString(input: ImageGenerateInput, key: string) {
  const value = input.extra?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}
```

新增 builder：

```ts
function buildInpaintRequestBody(input: ImageGenerateInput) {
  const compositeImage = getExtraString(input, "compositeImage")
  if (!compositeImage) throw new Error("Inpaint requires a composite image base64.")
  const generateMode = getExtraString(input, "generateMode")
  const hasDrawing = input.extra?.hasDrawing === true

  return {
    user: { idx: context.userIdx },
    task_type: "inpainting",
    args: {
      prompt: input.prompt,
      has_drawing: hasDrawing,
      image_base64: compositeImage.startsWith("data:image/") ? dataUrlToBase64(compositeImage) : compositeImage,
      generate_mode: generateMode === "erase" ? "erase" : "qwen_image_edit",
      num_image: 1,
    },
  }
}
```

注意：

- 字段名以 `aa.md` 的 create 参数为基础：`task_type: "inpainting"`、`args.prompt`、`args.has_drawing`、`args.generate_mode`、`args.num_image`。
- `has_drawing` 必须来自前端编辑区真实涂抹状态，即 `input.extra.hasDrawing === true`。
- `num_image` 不受 Studio 数量参数或其它参数影响，固定为 `1`。
- 实际接口只接受原图 + mask 合成图的 base64，字段为 `args.image_base64`；不传独立 `mask_base64`。

### 3. 接入 builder 分发

```ts
async function buildInternalRequestBody(input: ImageGenerateInput, context: InternalRequestContext) {
  const capability = getStudioCapability(input)
  if (capability === "image.upscale") return buildUpscaleRequestBody(input, context)
  if (capability === "image.cutout") return buildCutoutRequestBody(input, context)
  if (capability === "image.inpaint") return buildInpaintRequestBody(input)
  if (capability === "image.outpaint") return buildOutpaintRequestBody(input, context)
  return buildTextToImageRequestBody(input, context)
}
```

### 4. 持久化和展示

`studio-service.ts` 当前会把 `input.extra` 写入 tool part 的 `state.input`，并把工具输出图片作为 attachments 持久化。局部重绘复用这条链路即可。

需要同步扩展 `toolAction` 类型，否则 TypeScript 会在 `inpainting` 输出处报错。

## 样式方案

位置：`packages/app/octoapp/pages/studio/studio.css`

新增样式组：

- `.studio-inpaint`
- `.studio-inpaint-header`
- `.studio-inpaint-body`
- `.studio-inpaint-canvas-wrap`
- `.studio-inpaint-image`
- `.studio-inpaint-mask`
- `.studio-inpaint-cursor`
- `.studio-inpaint-controls`
- `.studio-inpaint-mode-group`
- `.studio-inpaint-tool-row`
- `.studio-inpaint-brush`
- `.studio-inpaint-prompt`
- `.studio-inpaint-create`

视觉上沿用 `StudioHDEditor` 和 `StudioOutpaintEditor`：

- 顶部 64px header。
- 主区域左画布右参数。
- 右侧控制区不做卡片嵌套，使用分组和分割线。
- 图标按钮用于关闭、撤销、重做、清空；没有现成图标时先用文字按钮，后续可接入已有 `Icon`。

## 测试与验证

### 单元测试

后端建议补充或扩展 `internel_image_generate` 相关测试：

- `image.inpaint` 会分发到 `buildInpaintRequestBody`。
- 缺少 `compositeImage` 时抛出明确错误。
- `hasDrawing: false` 时 `args.has_drawing` 为 `false`。
- `num_image` 固定为 `1`，不受 `count` 影响。
- `generateMode: "erase"` 会进入消除模式。
- `generateMode` 非法时回退 `qwen_image_edit`。

测试必须从包目录运行：

```txt
cd packages/opencode
bun test ...
```

### 类型检查

按仓库要求从包目录运行：

```txt
cd packages/app
bun typecheck

cd packages/opencode
bun typecheck
```

### 手动验证

1. 打开 Studio，生成或选择一张已有结果图。
2. 点击右侧“局部重绘”。
3. 在图片上涂抹，确认笔刷圆点、紫色 mask、撤销、重做、清空可用。
4. 重绘模式下输入 prompt，点击生成。
5. 消除模式下涂抹后不输入 prompt，点击生成。
6. 左侧会话出现 pending，完成后出现新图片。
7. 返回预览后可继续变清晰、抠图、扩图。

## 实施顺序

1. 类型和入口：启用 `image.inpaint`，扩展 `StudioMode`、详情按钮、工作区分支。
2. 前端编辑器：实现 `StudioInpaintEditor` 的画布、mask、撤销重做、提交。
3. 后端 builder：补 `toolAction` 类型、`buildInpaintRequestBody()` 和分发。
4. 样式：补齐局部重绘编辑器的布局和交互状态。
5. 验证：运行 `packages/app` 与 `packages/opencode` 的 typecheck，手动跑通生成链路。

## 风险与待确认点

- 前端合成图需要读取原图像素；如果远程图片没有合适的 CORS 头，Canvas 会被污染并导致 `toDataURL()` 失败。需要优先使用可跨域读取的图片 URL，或在后端增加图片代理/转换兜底。
- 合成图必须是纯 base64 字符串；若前端传 data URL，后端 builder 会通过 `dataUrlToBase64()` 去掉前缀。
- 原生 Canvas 的撤销快照如果用 data URL，超大图可能占内存。第一版因为只保存显示尺寸 mask，风险可控；后续可改为有限栈，比如最多 30 步。
- 如果图片本身没有 width / height 元数据，需要前端在 `img.onload` 后读取 `naturalWidth / naturalHeight`。
