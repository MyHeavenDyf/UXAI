# Studio 创建模板第一步生成风格描述流式实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio“创建模板”第一步中“生成风格描述”按钮的启用规则、统一字段设计、SSE 流式协议、阶段提示、思考过程展示、增量回填、状态处理和文件改动范围。
- 最后更新：2026-08-29。
- 关联前置：
  - `docs/studio-template-creator-content-implementation-plan.md` 已覆盖第 1 步“制作模板”主体表单。
  - `docs/studio-template-publish-implementation-plan.md` 已覆盖第 2 步“发布模板”。
  - `docs/studio-template-examples-implementation-plan.md` 已覆盖第 3 步“添加示例”。
- 本方案新建独立文档，不修改前置方案文档。

## 2. 核心结论

本功能按供应商流式接口实现。供应商每次返回的 `response.data` 都是 JSON 字符串，格式为：

```ts
{
  type: string
  content?: string
}
```

整体结论：

- 风格维度字段直接统一为供应商接口字段。
- 前端不直连供应商 URL，只请求本地 Studio route。
- opencode 层沿用现有 Studio 架构，负责调用供应商流式接口并转发 SSE。
- 前端按 `type` 判断当前阶段：
  - `step`：接口已成功开始，进入图片风格特征提取阶段。
  - `think`：思考过程增量文本。
  - `overview`：概览字段增量文本。
  - 风格维度字段 key：对应维度描述增量文本。
- 再次点击生成时，不在点击瞬间清空旧描述；首次收到 `type: "step"` 时再清空旧描述和 think。

推荐调用链：

```text
StudioTemplateCreator
  -> studio-page.tsx 使用 fetchEventSource 请求 POST /studio/style-description-gen
    -> packages/opencode/src/server/routes/instance/studio.ts 返回 text/event-stream
      -> packages/opencode/src/studio/studio-service.ts 创建流式响应
        -> packages/opencode/src/tool/internel_style_template.ts 调供应商 SSE 接口
```

## 3. 统一字段设计

### 3.1 字段列表

因为生成接口入参、生成接口返回、未来模板发布接口、未来查询编辑回填接口都使用同一套字段，所以前端状态字段应直接统一为接口字段。

```ts
export type StudioStyleDimensionId =
  | "tonal"
  | "composition"
  | "volume"
  | "surface"
  | "color"
  | "linework"
  | "shape_structure"
  | "role_design"
  | "lettering"
  | "post_processing"
```

`STYLE_DIMENSIONS` 中的 `id` 直接使用上述字段：

| 字段 | UI 文案 | placeholder |
|---|---|---|
| `tonal` | 明暗 | 描述图片的明暗特征，包括整体亮度倾向、对比范围、层次丰富程度。 |
| `composition` | 构图 | 描述图片的构图特征，包括透视类型、背景处理方式、负空间、景深、视觉层级，以及画面的整体节奏感。 |
| `volume` | 体积感 | 描述图片的形体立体感，包括物体表面的过渡方式、过渡的边缘特征，以及形体边界的质量。 |
| `surface` | 表面质感 | 描述图片中物体的表面属性，包括质感、纹理特征、细节密度、工艺痕迹 |
| `color` | 色彩 | 描述图片的色彩系统，包括主导色、背景色、饱和度分布、点缀色 |
| `linework` | 线条 | 描述线条与笔触特征 |
| `shape_structure` | 造型特征 | 描述形状语言与造型构造 |
| `role_design` | 角色形象 | 描述角色或生物的造型设计，包括人物比例特征以及整体形态语言风格 |
| `lettering` | 字体 | 描述文字或者字体设计 |
| `post_processing` | 后期效果 | 描述后期处理效果 |

默认选中：

```ts
const DEFAULT_STYLE_DIMENSIONS: StudioStyleDimensionId[] = [
  "tonal",
  "composition",
  "volume",
  "surface",
]
```

### 3.2 状态结构

当前 `selectedDimensions` 和 `styleDescriptionDetails` 都改用统一字段：

```ts
const [selectedDimensions, setSelectedDimensions] = createSignal<StudioStyleDimensionId[]>([...DEFAULT_STYLE_DIMENSIONS])
const [styleDescriptionDetails, setStyleDescriptionDetails] = createSignal<Partial<Record<StudioStyleDimensionId, string>>>({})
```

后续生成、发布、编辑回填都不需要再做字段转换：

```ts
style_dimensions: selectedDimensions()
```

### 3.3 不再维护双向映射

不新增以下映射：

```ts
STYLE_DIMENSION_API_NAMES
STYLE_DIMENSION_IDS_BY_API_NAME
```

除非后端未来明确返回字段和提交字段不同，否则不维护 UI 字段和接口字段两套体系。

## 4. 按钮启用规则

“生成风格描述”按钮仅依赖风格图集上传数量：

```ts
styleImages().length >= 3
```

不作为按钮启用条件的字段：

- `styleKeywords()`：风格关键词，可为空字符串。
- `selectedDimensions()`：选择的风格维度，可为空数组。
- `styleDescriptionOverview()`：概览是否已填写。
- `styleDescriptionDetails()`：维度描述是否已填写。

生成中按钮应禁用，避免重复请求：

```ts
styleImages().length < 3 || styleDescriptionGenerating()
```

如果真实接口 handler 未传入，也禁用按钮：

```ts
styleImages().length < 3 || styleDescriptionGenerating() || !props.onGenerateStyleDescription
```

## 5. 请求参数

点击按钮后调用本地 Studio 流式接口，最终由 opencode 层转发到供应商接口。

请求参数：

```ts
export type StudioStyleDescriptionGenerateInput = {
  style_keywords: string
  style_images: Array<{ url: string }>
  style_dimensions: StudioStyleDimensionId[]
}
```

字段说明：

| 参数 | 来源 | 规则 |
|---|---|---|
| `style_keywords` | `styleKeywords()` | 可为空字符串，传当前输入值 |
| `style_images` | `styleImages()` | 沿用当前上传数据结构 `{ url }[]` |
| `style_dimensions` | `selectedDimensions()` | 已经是接口字段名数组，直接传 |

示例：

```json
{
  "style_keywords": "弥散渐变、柔和光影",
  "style_images": [{ "url": "data:image/png;base64,..." }],
  "style_dimensions": ["tonal", "composition", "surface"]
}
```

如果用户取消所有维度，则传：

```json
{
  "style_dimensions": []
}
```

## 6. 供应商流式返回协议

### 6.1 基础格式

供应商接口每次 `response.data` 都是 JSON 字符串：

```ts
export type StudioStyleDescriptionStreamEvent = {
  type: string
  content?: string
}
```

注意：

- `type` 并不是一开始就对应风格描述字段。
- 第一个有业务意义的成功事件为 `type: "step"`，表示接口已成功开始思考并生成描述。
- 后续 `type: "think"` 表示思考过程。
- 最后阶段的 `type` 才会变为 `overview` 或风格描述字段 key。
- `content` 一次可能只有 2-4 个字符，需要拼接显示，以保持逐字输出效果。
- `content` 可能包含换行符 `\n`，展示时需要保留换行。

### 6.2 支持的 `type`

| type | 含义 | content 处理 | UI 阶段 |
|---|---|---|---|
| `step` | 接口调用成功，开始提取图片风格特征 | 不作为描述内容展示 | `extracting` |
| `think` | 思考过程增量文本 | 追加到 think 文本 | `extracting` |
| `overview` | 概览字段增量文本 | 追加到概览输入项 | `summarizing` |
| `tonal` | 明暗字段增量文本 | 追加到 `styleDescriptionDetails.tonal` | `summarizing` |
| `composition` | 构图字段增量文本 | 追加到 `styleDescriptionDetails.composition` | `summarizing` |
| `volume` | 体积感字段增量文本 | 追加到 `styleDescriptionDetails.volume` | `summarizing` |
| `surface` | 表面质感字段增量文本 | 追加到 `styleDescriptionDetails.surface` | `summarizing` |
| `color` | 色彩字段增量文本 | 追加到 `styleDescriptionDetails.color` | `summarizing` |
| `linework` | 线条字段增量文本 | 追加到 `styleDescriptionDetails.linework` | `summarizing` |
| `shape_structure` | 造型特征字段增量文本 | 追加到 `styleDescriptionDetails.shape_structure` | `summarizing` |
| `role_design` | 角色形象字段增量文本 | 追加到 `styleDescriptionDetails.role_design` | `summarizing` |
| `lettering` | 字体字段增量文本 | 追加到 `styleDescriptionDetails.lettering` | `summarizing` |
| `post_processing` | 后期效果字段增量文本 | 追加到 `styleDescriptionDetails.post_processing` | `summarizing` |

示例：

```json
{"type":"step","content":"start"}
{"type":"think","content":"正在"}
{"type":"think","content":"分析图片"}
{"type":"think","content":"\\n色彩"}
{"type":"overview","content":"整体"}
{"type":"overview","content":"风格轻盈"}
{"type":"tonal","content":"明暗对比"}
{"type":"tonal","content":"较弱。"}
```

## 7. 生成阶段和提示文案

建议定义阶段：

```ts
type StyleDescriptionStreamPhase =
  | "idle"
  | "extracting"
  | "summarizing"
  | "done"
  | "error"
```

阶段对应 tip 文案：

| 阶段 | tip |
|---|---|
| `idle` | 生成风格描述需要先上传风格图集，生成描述耗时约20-30s，请耐心等待。 |
| `extracting` | 正在提取图片风格特征 |
| `summarizing` | 正在汇总风格描述 |
| `done` | 风格描述已生成。 |
| `error` | 展示错误文案，或恢复默认说明 |

规则：

- 点击按钮后进入生成中，但 tip 可以先保持默认说明，直到收到 `step`。
- 首次收到 `step` 后，将 tip 改为“正在提取图片风格特征”。
- 收到 `think` 时继续保持“正在提取图片风格特征”。
- 收到 `overview` 或风格描述字段 key 时，将 tip 改为“正在汇总风格描述”。
- 流式接口结束后，将 tip 改为“风格描述已生成。”。
- 流式接口结束后，tip 下方的思考过程展示不再显示。

## 8. 再次生成时的清空规则

再次点击“生成风格描述”时，不立即清空旧描述和 think。

清空发生在首次收到：

```json
{"type":"step"}
```

原因：

- `step` 作为接口调用成功并开始生成的标识。
- 如果点击后网络失败或接口没有成功开始，旧描述不应被误清空。

建议新增状态：

```ts
const [styleDescriptionStreamStarted, setStyleDescriptionStreamStarted] = createSignal(false)
```

处理 `step`：

```ts
const handleStyleDescriptionStep = () => {
  if (!styleDescriptionStreamStarted()) {
    setStyleDescriptionStreamStarted(true)
    setStyleDescriptionOverview("")
    setStyleDescriptionDetails({})
    setStyleDescriptionThinking("")
  }

  setStyleDescriptionStreamPhase("extracting")
}
```

点击开始新请求前，需要把本次流 started 状态重置：

```ts
setStyleDescriptionStreamStarted(false)
```

不考虑后续中途失败回滚：

- 如果已收到 `step` 后中途失败，不恢复旧描述。
- 如果未收到 `step` 就失败，不清空旧描述。

## 9. 思考过程展示

### 9.1 展示位置

思考过程展示在“正在提取图片风格特征”tip 文案下面。

只在以下条件同时满足时显示：

```ts
styleDescriptionStreamPhase() === "extracting" &&
styleDescriptionThinking().length > 0
```

流结束后不显示。

### 9.2 内容拼接

收到：

```json
{"type":"think","content":"..."}
```

处理：

```ts
setStyleDescriptionThinking((current) => current + (event.content ?? ""))
```

不要用额外打字机定时器。接口每次吐出 2-4 个字符，直接 append 已经能形成逐字显示效果，且更容易处理取消、切换和失败。

### 9.3 三行高度和自动滚动

CSS：

```css
.studio-template-creator-thinking {
  max-height: 60px;
  overflow-y: auto;
  white-space: pre-wrap;
}
```

说明：

- `max-height` 按 `line-height: 20px` 设置为三行。
- `white-space: pre-wrap` 用于保留 `content` 中的 `\n`。
- 超过三行时容器内部滚动。

自动滚到底部：

```ts
let thinkingRef!: HTMLDivElement

createEffect(() => {
  props.thinkingText
  queueMicrotask(() => {
    if (thinkingRef) thinkingRef.scrollTop = thinkingRef.scrollHeight
  })
})
```

因此 `studio-template-creator.tsx` 需要从 Solid 增加 `createEffect` import。

## 10. 描述字段增量回填

### 10.1 字段识别

建议定义字段集合：

```ts
const STYLE_DESCRIPTION_FIELDS = new Set<StudioStyleDescriptionStreamField>([
  "overview",
  "tonal",
  "composition",
  "volume",
  "surface",
  "color",
  "linework",
  "shape_structure",
  "role_design",
  "lettering",
  "post_processing",
])
```

其中：

```ts
type StudioStyleDescriptionStreamField = "overview" | StudioStyleDimensionId
```

类型守卫：

```ts
function isStyleDescriptionStreamField(value: string): value is StudioStyleDescriptionStreamField {
  return STYLE_DESCRIPTION_FIELDS.has(value as StudioStyleDescriptionStreamField)
}
```

### 10.2 追加规则

收到 `overview`：

```ts
setStyleDescriptionStreamPhase("summarizing")
setStyleDescriptionOverview((current) =>
  truncateValue(current + (event.content ?? ""), DESCRIPTION_ITEM_MAX_LENGTH),
)
```

收到维度字段：

```ts
setStyleDescriptionStreamPhase("summarizing")
setStyleDescriptionDetails((current) => ({
  ...current,
  [event.type]: truncateValue(
    (current[event.type] ?? "") + (event.content ?? ""),
    DESCRIPTION_ITEM_MAX_LENGTH,
  ),
}))
```

规则：

- 每个输入项最大 300 字符。
- 超过 300 时直接截取到 300。
- 总字数超过 700 时继续沿用已有红色总字数提示和禁用“下一步”逻辑。
- 即使返回了当前未选中的维度字段，也保存到 `styleDescriptionDetails`；界面只展示当前选中的字段，用户后续选中该维度时可看到已生成内容。

## 11. 前端流式调用设计

### 11.1 依赖选择

用户提供的示例使用：

```ts
import { fetchEventSource } from "@microsoft/fetch-event-source"
```

当前仓库未检索到该依赖。实现时有两个选择：

1. 在需要消费 SSE 的 package 中新增 `@microsoft/fetch-event-source`。
2. 使用原生 `fetch + ReadableStream` 解析 SSE。

推荐：

- app 前端请求本地 `/studio/style-description-gen` 时使用 `@microsoft/fetch-event-source`。
- opencode 调供应商 SSE 时也可以使用 `@microsoft/fetch-event-source`。

原因：

- 原生 `EventSource` 不支持 POST body，本需求需要 POST JSON。
- `@microsoft/fetch-event-source` 支持 POST、headers、body、AbortController 和 `openWhenHidden`。
- 代码更贴近供应商示例，后续联调成本更低。

需要修改：

```text
packages/app/package.json
packages/opencode/package.json
bun.lock
```

如果希望减少依赖，可以只在前端加该依赖，opencode 侧用原生 `fetch + ReadableStream` 转发供应商 SSE；但从实现一致性和可维护性看，两端都使用该库更简单。

### 11.2 `StudioTemplateCreator` props

位置：

```text
packages/app/octoapp/pages/studio/studio-template-creator.tsx
```

建议导出类型：

```ts
export type StudioStyleDescriptionGenerateHandlers = {
  onEvent: (event: StudioStyleDescriptionStreamEvent) => void
  signal?: AbortSignal
}

export function StudioTemplateCreator(props: {
  onGenerateStyleDescription?: (
    input: StudioStyleDescriptionGenerateInput,
    handlers: StudioStyleDescriptionGenerateHandlers,
  ) => Promise<void>
}): JSX.Element
```

### 11.3 `studio-page.tsx` 中消费本地 SSE

位置：

```text
packages/app/octoapp/pages/studio-page.tsx
```

新增函数：

```ts
async function generateStyleDescription(
  input: StudioStyleDescriptionGenerateInput,
  handlers: StudioStyleDescriptionGenerateHandlers,
) {
  const current = server.current
  if (!current) throw new Error("No active server.")

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...directoryHeader(projectDir()),
  }

  if (current.http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: current.http.username,
      password: current.http.password,
    })}`
  }

  await fetchEventSource(new URL("/studio/style-description-gen", current.http.url).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    openWhenHidden: true,
    signal: handlers.signal,
    onmessage(response) {
      handlers.onEvent(parseStyleDescriptionStreamEvent(response.data))
    },
    onerror(error) {
      throw error
    },
  })
}
```

注意：

- `fetchEventSource` 返回 Promise，不是浏览器原生 `EventSource` 实例，不能依赖 `eventSource.close()`。
- 关闭请求使用 `AbortController.abort()`。
- `onerror` 中抛出错误可让外层 `catch` 统一处理。

### 11.4 流事件解析

建议在 `studio-page.tsx` 或 `studio-template-creator.tsx` 附近新增解析函数：

```ts
function parseStyleDescriptionStreamEvent(data: string): StudioStyleDescriptionStreamEvent {
  const parsed = JSON.parse(data) as Partial<StudioStyleDescriptionStreamEvent>
  if (typeof parsed.type === "string") {
    return {
      type: parsed.type,
      content: typeof parsed.content === "string" ? parsed.content : "",
    }
  }
  throw new Error("风格描述生成返回格式异常")
}
```

`type` 的业务合法性可以在 `StudioTemplateCreator` 内按 `step`、`think` 和字段集合判断。

## 12. 前端状态与事件处理

### 12.1 新增状态

在 `StudioTemplateCreator` 中新增：

```ts
const [styleDescriptionGenerating, setStyleDescriptionGenerating] = createSignal(false)
const [styleDescriptionGenerateMessage, setStyleDescriptionGenerateMessage] = createSignal("")
const [styleDescriptionStreamPhase, setStyleDescriptionStreamPhase] = createSignal<StyleDescriptionStreamPhase>("idle")
const [styleDescriptionThinking, setStyleDescriptionThinking] = createSignal("")
const [styleDescriptionStreamStarted, setStyleDescriptionStreamStarted] = createSignal(false)
let styleDescriptionGenerateController: AbortController | undefined
```

组件销毁时 abort：

```ts
onCleanup(() => styleDescriptionGenerateController?.abort())
```

### 12.2 事件处理入口

```ts
const handleStyleDescriptionStreamEvent = (event: StudioStyleDescriptionStreamEvent) => {
  if (event.type === "step") {
    handleStyleDescriptionStep()
    return
  }

  if (event.type === "think") {
    setStyleDescriptionStreamPhase("extracting")
    setStyleDescriptionThinking((current) => current + (event.content ?? ""))
    return
  }

  if (isStyleDescriptionStreamField(event.type)) {
    appendStyleDescriptionField(event.type, event.content ?? "")
  }
}
```

### 12.3 点击处理流程

```ts
const handleGenerateStyleDescription = async () => {
  if (styleImages().length < 3 || styleDescriptionGenerating() || !props.onGenerateStyleDescription) return

  styleDescriptionGenerateController?.abort()
  const controller = new AbortController()
  styleDescriptionGenerateController = controller
  setStyleDescriptionGenerating(true)
  setStyleDescriptionGenerateMessage("")
  setStyleDescriptionStreamStarted(false)

  try {
    await props.onGenerateStyleDescription(
      {
        style_keywords: styleKeywords(),
        style_images: styleImages(),
        style_dimensions: selectedDimensions(),
      },
      {
        signal: controller.signal,
        onEvent: handleStyleDescriptionStreamEvent,
      },
    )

    if (!controller.signal.aborted) {
      setStyleDescriptionStreamPhase("done")
      setStyleDescriptionThinking("")
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      setStyleDescriptionStreamPhase("error")
      setStyleDescriptionGenerateMessage(error instanceof Error ? error.message : String(error))
    }
  } finally {
    if (styleDescriptionGenerateController === controller) styleDescriptionGenerateController = undefined
    if (!controller.signal.aborted) setStyleDescriptionGenerating(false)
  }
}
```

### 12.4 tip 文案计算

```ts
const styleDescriptionGenerateTip = createMemo(() => {
  if (styleDescriptionGenerateMessage()) return styleDescriptionGenerateMessage()
  if (styleDescriptionStreamPhase() === "extracting") return "正在提取图片风格特征"
  if (styleDescriptionStreamPhase() === "summarizing") return "正在汇总风格描述"
  if (styleDescriptionStreamPhase() === "done") return "风格描述已生成。"
  return "生成风格描述需要先上传风格图集，生成描述耗时约20-30s，请耐心等待。"
})
```

错误 tip 是否红色可通过 `styleDescriptionStreamPhase() === "error"` 控制 class。

## 13. opencode 后端流式转发设计

### 13.1 本地 Studio route

位置：

```text
packages/opencode/src/server/routes/instance/studio.ts
```

新增：

```text
POST /studio/style-description-gen
```

route 需要：

- 校验 JSON body。
- 返回 `text/event-stream`。
- 调用 `createStyleDescriptionGenStream`。
- 将 service/tool 产生的事件逐条写给前端。

schema：

```ts
const StudioStyleDimensionId = z.enum([
  "tonal",
  "composition",
  "volume",
  "surface",
  "color",
  "linework",
  "shape_structure",
  "role_design",
  "lettering",
  "post_processing",
])

const StudioStyleDescriptionGenInput = z.object({
  style_keywords: z.string(),
  style_images: z.array(z.object({ url: z.string().min(1) })).min(3),
  style_dimensions: z.array(StudioStyleDimensionId),
})
```

### 13.2 SSE 输出格式

本地 route 输出标准 SSE。每条 data 保持 `{ type, content }`：

```text
data: {"type":"step","content":"start"}

data: {"type":"think","content":"正在分析"}

data: {"type":"overview","content":"整体风格轻盈"}

```

建议封装写入函数：

```ts
function encodeSseData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}
```

如果捕获错误，建议也输出同一结构：

```ts
controller.enqueue(encoder.encode(encodeSseData({
  type: "error",
  content: error instanceof Error ? error.message : String(error),
})))
```

前端可把 `type: "error"` 当作错误事件处理。

### 13.3 Studio service

位置：

```text
packages/opencode/src/studio/studio-service.ts
```

新增 service 方法，职责是业务层薄封装：

```ts
export async function createStyleDescriptionGenStream(
  input: StudioStyleDescriptionGenRequest,
  handlers: {
    onEvent: (event: StyleDescriptionGenStreamEvent) => void
    signal?: AbortSignal
  },
) {
  await generateStyleDescriptionStream(input, handlers)
}
```

service 层可以做：

- 空流结果兜底。
- 供应商异常 message 标准化。
- 如供应商返回非 JSON，转换为 `{ type: "error", content: "风格描述生成返回格式异常" }`。

若供应商已经逐条返回目标协议，service 可以只透传。

### 13.4 Internal style template tool helper

不建议继续把本功能写入：

```text
packages/opencode/src/tool/internel_image_generate.ts
```

原因：

- `internel_image_generate.ts` 已经包含图片/视频生成、任务查询、取消、重启、prompt tags、权限检查、prompt gen 等逻辑，文件体量较大。
- 风格模板生成描述不是图片生成任务本身，而是模板创建流程的流式辅助接口。
- 未来模板发布、查询、编辑、回填接口也会继续增加，提前拆分能避免 `internel_image_generate.ts` 继续膨胀。

建议新增文件：

```text
packages/opencode/src/tool/internel_style_template.ts
```

该文件负责：

- 风格模板相关供应商 endpoint。
- `IMAGE_STYLE_DESCRIPTION_GEN_URL` 环境变量覆盖。
- local / beta / prod 三环境 endpoint 判断。
- `generateStyleDescriptionStream`。
- `{ type, content }` 流事件类型。
- SSE client 调用和基础解析。

#### 13.4.1 三环境 endpoint 设计

`internel_image_generate.ts` 当前通过 `OCTO_CHANNEL` 判断 local / beta / prod 三套 endpoint，新文件也需要遵循同一逻辑。

建议在 `internel_style_template.ts` 中定义独立 preset：

```ts
type ImportMetaWithEnv = ImportMeta & {
  env?: {
    OCTO_CHANNEL?: string
  }
}

type InternalStyleTemplateEndpointPreset = {
  styleDescriptionGenUrl: string
}
```

环境判断函数沿用当前逻辑：

```ts
function octoChannel() {
  return (import.meta as ImportMetaWithEnv).env?.OCTO_CHANNEL ?? process.env.OCTO_CHANNEL ?? "prod"
}

function internalStyleTemplateEndpoints() {
  if (octoChannel() === "prod") return PROD_STYLE_TEMPLATE_ENDPOINTS
  if (octoChannel() === "beta") return BETA_STYLE_TEMPLATE_ENDPOINTS
  return LOCAL_STYLE_TEMPLATE_ENDPOINTS
}
```

三套 endpoint：

```ts
const LOCAL_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "http://localhost:3000/style_description_gen",
} satisfies InternalStyleTemplateEndpointPreset

const BETA_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "xx",
} satisfies InternalStyleTemplateEndpointPreset

const PROD_STYLE_TEMPLATE_ENDPOINTS = {
  styleDescriptionGenUrl: "xx",
} satisfies InternalStyleTemplateEndpointPreset
```

说明：

- beta/prod 的真实供应商 URL 未确认前，可先临时写 `"xx"` 或空字符串，并优先依赖环境变量覆盖。
- 更稳妥的编码方式是允许默认 URL 为空，未配置时抛出明确错误。
- local 地址可用于本地 mock 调试。

默认值和环境变量覆盖：

```ts
const DEFAULT_STYLE_DESCRIPTION_GEN = internalStyleTemplateEndpoints().styleDescriptionGenUrl
const url = env("IMAGE_STYLE_DESCRIPTION_GEN_URL") ?? DEFAULT_STYLE_DESCRIPTION_GEN
```

新增函数：

```ts
export async function generateStyleDescriptionStream(
  input: StyleDescriptionGenRequest,
  handlers: {
    onEvent: (event: StyleDescriptionGenStreamEvent) => void
    signal?: AbortSignal
  },
) {
  const url = env("IMAGE_STYLE_DESCRIPTION_GEN_URL") ?? DEFAULT_STYLE_DESCRIPTION_GEN
  if (!url) throw new Error("style_description_gen url is not configured.")

  await fetchEventSource(url, {
    method: "POST",
    headers: {
      ...internalImageHeaders(),
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
    openWhenHidden: true,
    signal: handlers.signal,
    onmessage(response) {
      handlers.onEvent(parseStyleDescriptionStreamEvent(response.data))
    },
    onerror(error) {
      throw error
    },
  })
}
```

注意：

- 如果在 opencode 包里使用 `@microsoft/fetch-event-source`，需要把依赖加到 `packages/opencode/package.json`。
- 也可以不新增依赖，使用 `fetch` 读取 `ReadableStream` 并解析 SSE。这样依赖更少，但代码更复杂。
- 因为供应商调用发生在 opencode 端，依赖应加在 `packages/opencode`，不是只加在 `packages/app`。
- 不修改 `packages/opencode/src/tool/registry.ts`，该能力不是 agent tool，而是 Studio UI 触发的供应商 helper。

## 14. 需要添加或修改的文件

### 14.1 新增文件

本阶段只建议新增一个运行时代码文件：

```text
packages/opencode/src/tool/internel_style_template.ts
```

该文件用于承载风格模板供应商接口调用，避免继续扩写已经较大的 `internel_image_generate.ts`。

文件内包含：

- 风格模板供应商接口三环境 endpoint 配置。
- `OCTO_CHANNEL` 环境选择逻辑。
- `IMAGE_STYLE_DESCRIPTION_GEN_URL` 环境变量覆盖。
- `StyleDescriptionGenRequest` 请求类型。
- `StyleDescriptionGenStreamEvent` 流事件类型。
- `generateStyleDescriptionStream` 流式调用函数。
- 供应商 `response.data` 的 `{ type, content }` JSON 解析。

本阶段不新增：

```text
packages/app/octoapp/pages/studio/studio-template-stream.ts
packages/opencode/src/studio/image-template.ts
```

原因：

- 前端流事件解析和 UI 状态处理规模不大，直接放在 `studio-page.tsx` / `studio-template-creator.tsx` 更清晰。
- opencode 侧模板类型目前只被 `internel_style_template.ts` 和 `studio-service.ts` 使用，直接从 `internel_style_template.ts` 导出即可。
- 等后续模板发布、查询、编辑接口继续增加，再评估是否抽公共类型文件。

### 14.2 修改文件

#### `packages/app/octoapp/pages/studio/studio-template-creator.tsx`

需要修改：

- 将 `StyleDimensionId` 改为统一接口字段，并建议导出为 `StudioStyleDimensionId`。
- 更新 `STYLE_DIMENSIONS` 的 `id`。
- 更新 `DEFAULT_STYLE_DIMENSIONS`。
- 导出 `TemplateUploadImage` 类型。
- 导出流式事件类型。
- 给 `StudioTemplateCreator` 增加可选 `onGenerateStyleDescription` props。
- 新增 `styleDescriptionGenerating` 状态。
- 新增 `styleDescriptionGenerateMessage` 状态。
- 新增 `styleDescriptionStreamPhase` 状态。
- 新增 `styleDescriptionThinking` 状态。
- 新增 `styleDescriptionStreamStarted` 状态。
- 新增 `styleDescriptionGenerateController`。
- 新增 `handleGenerateStyleDescription`。
- 新增 `handleStyleDescriptionStreamEvent`。
- 新增 `handleStyleDescriptionStep`。
- 新增 `appendStyleDescriptionField`。
- 新增 `styleDescriptionGenerateTip`。
- 修改 `StyleDescriptionSection` props 和按钮/tip/think 展示逻辑。
- 修改 `VisualStyleForm` props 透传生成相关状态和事件。
- 请求时直接传 `style_dimensions: selectedDimensions()`。
- 保持第一步“下一步”校验逻辑不变。

#### `packages/app/octoapp/pages/studio-page.tsx`

需要修改：

- 引入 `fetchEventSource`。
- 引入 `StudioStyleDescriptionGenerateInput`、`StudioStyleDescriptionGenerateHandlers` 和事件类型。
- 新增 `parseStyleDescriptionStreamEvent`。
- 新增 `generateStyleDescription` 流式请求函数。
- 在渲染 `StudioTemplateCreator` 时传入：

```tsx
<StudioTemplateCreator onGenerateStyleDescription={generateStyleDescription} />
```

#### `packages/opencode/src/tool/internel_style_template.ts`

需要新增：

- 引入或实现 SSE client。
- 定义 `InternalStyleTemplateEndpointPreset`。
- 定义 `LOCAL_STYLE_TEMPLATE_ENDPOINTS`、`BETA_STYLE_TEMPLATE_ENDPOINTS`、`PROD_STYLE_TEMPLATE_ENDPOINTS`。
- 按 `OCTO_CHANNEL` 沿用 local / beta / prod 三环境选择逻辑。
- 新增 `DEFAULT_STYLE_DESCRIPTION_GEN`。
- 新增风格描述生成请求/流事件类型。
- 新增 `generateStyleDescriptionStream` 函数。
- 支持环境变量覆盖：`IMAGE_STYLE_DESCRIPTION_GEN_URL`。
- 不修改 `tool/registry.ts`。

#### `packages/opencode/src/tool/internel_image_generate.ts`

不建议修改：

- 本功能不继续扩展该文件。
- 后续若需要共用请求 header、环境判断、错误格式化等逻辑，再单独评估是否抽公共 helper。
- 当前避免对图片/视频生成主链路造成额外风险。

#### `packages/opencode/src/studio/studio-service.ts`

需要修改：

- 从 `internel_style_template.ts` 引入 `generateStyleDescriptionStream` 和相关类型。
- 新增 `StudioStyleDescriptionGenRequest` 类型。
- 新增 `createStyleDescriptionGenStream` 方法。
- 根据需要标准化业务错误。

#### `packages/opencode/src/server/routes/instance/studio.ts`

需要修改：

- 引入 `createStyleDescriptionGenStream`。
- 新增 `StudioStyleDescriptionGenInput` zod schema。
- 新增 `POST /studio/style-description-gen` route。
- route 返回 `text/event-stream`。

#### `packages/opencode/package.json`

可能需要修改：

- 如果 opencode 侧用 `fetchEventSource` 调供应商 SSE，新增 `@microsoft/fetch-event-source`。

#### `packages/app/package.json`

可能需要修改：

- 如果 app 侧用 `fetchEventSource` 调本地 SSE，新增 `@microsoft/fetch-event-source`。

#### `bun.lock`

可能需要修改：

- 如果新增依赖，需要更新 lockfile。

#### `packages/app/octoapp/pages/studio/studio-08.css`

可能需要修改：

- 确认 `.studio-template-creator-generate-button:disabled` 样式覆盖生成按钮。
- 新增/调整 tip、错误、思考过程展示样式。

建议样式：

```css
.studio-template-creator-generate-tip.error {
  color: #f04438;
}

.studio-template-creator-thinking {
  max-height: 60px;
  margin-top: 8px;
  overflow-y: auto;
  white-space: pre-wrap;
  color: #747476;
  font-size: 13px;
  line-height: 20px;
}
```

## 15. 验收标准

- `STYLE_DIMENSIONS` 的 `id` 使用统一接口字段。
- `selectedDimensions()` 直接得到 `tonal`、`surface`、`linework` 等接口字段。
- 不新增 `STYLE_DIMENSION_API_NAMES` 和 `STYLE_DIMENSION_IDS_BY_API_NAME` 双向映射。
- 风格图集少于 3 张时，“生成风格描述”按钮禁用。
- 风格图集达到 3 张后，且接口 handler 已配置时，“生成风格描述”按钮可点击。
- 点击按钮后进入生成中，但不立即清空已有描述和 think。
- 点击时前端请求本地 `/studio/style-description-gen`，不直连供应商域名。
- opencode route/service/tool 三层按现有 Studio 风格转发到供应商流式接口。
- 供应商流式接口调用位于 `packages/opencode/src/tool/internel_style_template.ts`，不继续扩写 `internel_image_generate.ts`。
- `internel_style_template.ts` 沿用 `OCTO_CHANNEL` 的 local / beta / prod 三环境 endpoint 选择逻辑。
- 供应商接口 URL 支持 `IMAGE_STYLE_DESCRIPTION_GEN_URL` 覆盖。
- SSE 请求 header 包含：
  - `Content-Type: application/json`
  - `Accept: text/event-stream`
- 点击时请求 body 包含：
  - `style_keywords`
  - `style_images`
  - `style_dimensions`
- `style_keywords` 为空时仍正常传空字符串。
- `style_images` 数据保持 `{ url }[]`。
- `style_dimensions` 直接使用统一字段数组。
- 未选择任何维度时，`style_dimensions` 为 `[]`。
- 每个 `response.data` 都按 `{ type, content }` JSON 字符串解析。
- 首次收到 `type: "step"` 时，视为接口调用成功，清空旧概览、旧维度描述和旧 think。
- 收到 `step` 后，按钮下 tip 文案改为“正在提取图片风格特征”。
- 收到 `think` 时，将 `content` 拼接展示在 tip 下方。
- think 展示最多三行高度，超过三行自动向下滚动。
- think 展示保留 `content` 中的换行符 `\n`。
- 收到 `overview` 时，tip 文案改为“正在汇总风格描述”，并把 `content` 逐步追加到概览。
- 收到风格维度字段 key 时，tip 文案保持“正在汇总风格描述”，并把 `content` 逐步追加到对应维度描述。
- 单个输入项内容超过 300 字符时截取到 300。
- 流式接口结束后，tip 文案改为“风格描述已生成。”。
- 流式接口结束后，think 展示不显示。
- 如果未收到 `step` 就失败，不清空旧描述。
- 如果已收到 `step` 后中途失败，不恢复旧描述。
- 生成中按钮禁用，避免重复请求。
- 生成接口不是进入下一步的强制步骤，用户手填仍可通过现有“下一步”校验。
- `bun typecheck` 通过。
