# Octo Studio 技术方案

## 目标

Studio 应作为独立的 AI 创作工作台存在，而不是 Cowork 或 opencode 会话 UI 的皮肤分支。它可以继续运行在 octoapp 里，复用全局目录、窗口、登录态、历史会话等基础能力，但图片生成、图片编辑、结果管理和创作状态应该有自己的业务模型。

这份方案重点解决三个问题：

- Studio 的前端、服务层、图片生成能力如何分层。
- 图片生成 tool 如何使用，但不让 Studio 强依赖 opencode。
- 后续扩展视频生成、变清晰、抠图、局部重绘、扩图时，架构不需要重做。

## 设计原则

- Studio 业务独立：页面组件不直接解析 opencode assistant message，也不把 tool result 当作核心数据源。
- AI 能力适配器化：Jimeng 只是第一个 provider，后续可以换成其他图像模型。
- 前端只处理体验状态：提交、生成中、预览、重试、编辑模式等状态在 Studio store 中表达。
- 服务端负责密钥和签名：前端不能持有 Jimeng access key / secret key。
- opencode tool 作为兼容入口：可以保留给 agent 使用，但 Studio 主链路不应该通过 “让模型调用 tool” 来生成图片。

## 总体架构

```txt
Studio UI
  |
  | submit StudioGenerationRequest
  v
Studio Client API
  |
  | POST /studio/generations
  v
Studio Service
  |
  | normalize request / persist task / call provider
  v
ImageGenerationProvider
  |
  | JimengProvider
  v
Jimeng CVProcess API
```

opencode 相关能力放在旁路：

```txt
opencode agent
  |
  | tool call
  v
jimeng_demo_image_generate tool
  |
  | delegates to shared JimengProvider
  v
Jimeng CVProcess API
```

核心判断：Studio UI 调用 Studio Service；opencode tool 调用同一个 provider。两条入口共享底层实现，但互不绑死。

## 模块划分

### Frontend

建议目录：

```txt
packages/app/octoapp/pages/studio/
  index.tsx
  studio.css
  types.ts
  data.ts
  api.ts
  store.ts
  components/
  hooks/
```

职责：

- `index.tsx`：装配页面和 provider。
- `api.ts`：封装 Studio API 调用，不直接知道 Jimeng。
- `store.ts`：维护当前任务、结果、选中图片、编辑模式、菜单状态。
- `types.ts`：定义 Studio 业务类型。
- `components/`：纯 UI 组件，尽量通过 props 接收状态和事件。
- `hooks/`：组合前端交互逻辑，例如生成、重试、上传、选择结果。

### Backend

建议新增服务模块：

```txt
packages/opencode/src/studio/
  studio-route.ts
  studio-service.ts
  studio-store.ts
  image-provider.ts
  providers/
    jimeng-provider.ts
```

也可以放在当前项目已有 server/API 约定对应的位置，关键是保持 `studio-service` 和 `image-provider` 独立于页面组件。

职责：

- `studio-route.ts`：暴露 HTTP/RPC API。
- `studio-service.ts`：处理生成、重试、编辑、任务状态和结果归档。
- `studio-store.ts`：持久化 Studio task/result，后续可落到项目目录或数据库。
- `image-provider.ts`：定义 provider interface。
- `jimeng-provider.ts`：实现 Jimeng 签名、请求、响应解析。

## 核心类型

Studio 前端和服务层围绕这些业务对象建模：

```ts
type StudioCapability =
  | "image.generate"
  | "video.generate"
  | "image.upscale"
  | "image.cutout"
  | "image.inpaint"
  | "image.outpaint"
  | "image.fusion"

type StudioGenerationRequest = {
  capability: StudioCapability
  prompt: string
  styleModel: string
  aspectRatio: "1:1" | "2:3" | "3:4" | "9:16" | "3:2" | "4:3" | "16:9"
  count: 1 | 2 | 3 | 4
  referenceImages: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

type StudioGenerationResult = {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  capability: StudioCapability
  prompt: string
  provider: "jimeng"
  model: string
  aspectRatio: string
  images: StudioImage[]
  error?: string
  createdAt: number
  completedAt?: number
}

type StudioImage = {
  id: string
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  seed?: string
  sourceProviderResponse?: unknown
}
```

要点：

- UI 永远消费 `StudioGenerationResult`，不消费 Jimeng 原始响应。
- `sourceProviderResponse` 只用于调试和兼容，不参与核心渲染。
- `capability` 使用稳定枚举，便于后续把图片生成扩展成完整创作工具集。

## Provider Interface

图片生成能力抽象成 provider：

```ts
type ImageGenerationProvider = {
  generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>
  edit(input: ImageEditInput): Promise<ImageGenerateOutput>
}

type ImageGenerateInput = {
  prompt: string
  aspectRatio: string
  count: number
  styleModel?: string
  referenceImages?: string[]
  extra?: Record<string, unknown>
}

type ImageEditInput = ImageGenerateInput & {
  sourceImage: string
  editType: "upscale" | "cutout" | "inpaint" | "outpaint" | "fusion"
}

type ImageGenerateOutput = {
  provider: "jimeng"
  model: string
  images: { url: string; width?: number; height?: number }[]
  raw: unknown
}
```

Studio Service 只依赖这个 interface。Jimeng 的 `req_key`、`scale`、`image_urls`、签名方式都藏在 `JimengProvider` 内部。

## Jimeng Tool 如何使用

现有文件：

```txt
/Users/ljc/Documents/workspace/agent/tool/jimeng_demo_image_generate.ts
```

它当前是一个 opencode plugin tool，做了这些事：

- 按火山引擎 V4 方式签名。
- POST 到 `https://visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31`。
- 请求体包含 `req_key`、`prompt`、`scale`、可选 `image_urls` 和 `extraBody`。
- 从任意嵌套响应里提取图片 URL。
- 返回 JSON 字符串，字段包括 `images`、`primaryImage`、`rawBody`。

推荐用法不是让 Studio 前端直接调用这个 tool，而是分三层复用：

1. 抽出核心 Jimeng client。
   将签名、请求、重试、`collectImageUrls` 提取到 `JimengProvider` 或 `jimeng-client.ts`。

2. Studio Service 直接调用 `JimengProvider`。
   Studio 的生成按钮提交到后端 API，后端把业务请求转换成 Jimeng 请求。

3. opencode tool 改成适配器。
   `jimeng_demo_image_generate.ts` 只负责解析 tool args，然后调用同一个 `JimengProvider`，最后把结果格式化成 tool output。

这样 Studio 独立于 opencode，但 opencode agent 仍然可以用同一个图片生成能力。

## Studio API 设计

### 创建生成任务

```txt
POST /studio/generations
```

请求：

```json
{
  "capability": "image.generate",
  "prompt": "户外骑行图片，沿着绿道一路骑行...",
  "styleModel": "千问",
  "aspectRatio": "3:4",
  "count": 4,
  "referenceImages": []
}
```

响应：

```json
{
  "id": "studio_gen_...",
  "status": "running"
}
```

### 查询任务

```txt
GET /studio/generations/:id
```

响应：

```json
{
  "id": "studio_gen_...",
  "status": "succeeded",
  "capability": "image.generate",
  "images": [
    { "id": "img_1", "url": "https://..." }
  ]
}
```

### 编辑图片

```txt
POST /studio/generations/:id/edits
```

请求：

```json
{
  "capability": "image.outpaint",
  "sourceImage": "https://...",
  "prompt": "保留主体，扩展左右背景",
  "aspectRatio": "16:9",
  "count": 1
}
```

### 再次生成

```txt
POST /studio/generations/:id/retry
```

复用原始 prompt 和设置，可允许覆盖部分参数。

## 请求转换规则

Studio 请求到 Jimeng 请求的转换由 `JimengProvider` 管理：

```txt
StudioGenerationRequest
  -> ImageGenerateInput
  -> JimengRequestBody
```

示例映射：

- `prompt`：由用户 prompt、风格模型、比例、质量要求拼接而成。
- `aspectRatio`：优先映射到 Jimeng 支持的比例字段；如果接口不支持字段，再写入 prompt。
- `count`：优先映射到 Jimeng 支持的 batch 字段；如果接口不支持，需要服务层循环调用或降级为 1 张。
- `referenceImages`：映射为 `image_urls`。
- `sourceImage`：编辑类能力映射为 `primaryImage` 或 `image_urls`。
- `capability`：选择不同 `req_key` 或 `extraBody`。

当前已知 Jimeng tool 请求体：

```json
{
  "req_key": "jimeng_t2i_v40",
  "prompt": "...",
  "scale": 0.5,
  "image_urls": ["https://..."]
}
```

待确认字段：

- 不同比例对应的官方字段。
- 一次生成多图对应的官方字段。
- 扩图、变清晰、抠图、局部重绘各自对应的 `req_key`。
- 编辑类任务是否需要 mask、bbox 或其他结构化参数。

在字段未确认前，先设计 `extra` 透传能力，避免阻塞 UI 和业务模型。

## 前端状态流

```txt
idle
  -> composing
  -> submitting
  -> running
  -> succeeded
  -> previewing
```

错误流：

```txt
submitting/running
  -> failed
  -> retrying
```

编辑流：

```txt
previewing
  -> editing(outpaint/upscale/cutout/inpaint/fusion)
  -> running
  -> succeeded
```

UI 不需要等 opencode message 流。它只关心 Studio generation task 状态。

## 与 opencode Session 的关系

推荐关系：弱关联，不作为主数据源。

Studio 可以继续使用 opencode session 的能力做这些事：

- 左侧历史列表复用 session 列表或目录上下文。
- 用户的一次生成可以同步写一条 session message，方便历史可追溯。
- agent 模式下可以通过 tool 解释和规划生成内容。

但 Studio 结果不要只存放在 assistant text/tool part 里。原因：

- 图片结果需要稳定缩略图、大图、编辑链路和元信息。
- tool output 是模型调用产物，不适合做图片资产管理。
- 后续视频、抠图、扩图需要任务级状态，而不只是聊天消息。

建议做法：

- Studio task/result 存在 `studio-store`。
- 如果需要兼容聊天历史，再把摘要同步为 session message。
- 从 session 进入 Studio 时，根据 session metadata 找到关联的 Studio task。

## 持久化设计

最小可行版本可以先落本地 JSON：

```txt
{projectDir}/.octo/studio/
  generations/
    studio_gen_xxx.json
  assets/
    img_xxx.png
```

更完整版本可以进入现有数据库或 session 存储体系。

建议至少持久化：

- generation id
- capability
- prompt
- style model
- aspect ratio
- count
- provider/model
- image URLs
- local cached asset paths
- status/error
- created/completed time
- parent generation id
- source image id

## 图片缓存策略

Jimeng 返回的是远端 URL，不能假设永久可用。建议服务端在生成成功后做缓存：

1. 下载远端图片到项目工作区或应用数据目录。
2. 生成缩略图。
3. Studio UI 优先显示本地缓存 URL。
4. 保留原始远端 URL 作为 fallback 和调试信息。

如果第一阶段不做缓存，也要在结果模型里预留：

```ts
remoteUrl: string
localPath?: string
thumbnailPath?: string
```

## 错误处理

服务层统一把 provider error 转成 Studio error：

- `provider_auth_failed`：密钥缺失或签名失败。
- `provider_rate_limited`：429 或限流。
- `provider_timeout`：超时。
- `provider_bad_response`：返回非 JSON 或无图片 URL。
- `provider_failed`：其他失败。

UI 展示：

- 生成卡片显示失败状态。
- 保留用户 prompt 和设置。
- 提供重试按钮。
- 详情区不进入空白状态。

## 安全与配置

Jimeng access key / secret key 只能在服务端读取：

```txt
JIMENG_ACCESS_KEY
JIMENG_SECRET_KEY
JIMENG_REQ_KEY
JIMENG_EDIT_REQ_KEY
```

不建议继续把默认密钥写在业务代码里。当前 tool 内的默认值可以保留作本地 demo 兼容，但正式 Studio Service 应要求环境变量或应用配置。

## 分阶段实现

### Phase 1：独立 UI 与本地 mock

- 新建 Studio 目录和页面组件。
- 建立 `StudioGenerationRequest/Result` 类型。
- 使用 mock provider 返回固定图片 URL，先跑通参考图 UI 状态。
- 不接 opencode tool，不改模型调用链。

### Phase 2：接入 Studio Service

- 新增 `/studio/generations` API。
- 前端从 mock 切到真实 API。
- 后端建立 `ImageGenerationProvider` interface。
- 先用同步请求返回结果；如耗时过长，再改为轮询任务。

### Phase 3：抽出 JimengProvider

- 从 `jimeng_demo_image_generate.ts` 提取签名、请求、重试和响应解析。
- Studio Service 调用 `JimengProvider`。
- opencode tool 改成调用同一个 `JimengProvider`。

### Phase 4：结果管理和编辑能力

- 持久化 generation/result。
- 增加缩略图和本地缓存。
- 实现再次生成、扩图、变清晰、抠图、局部重绘。
- 为不同 capability 配置不同 `req_key` 和参数映射。

## 结论

Studio 的主链路应是独立创作产品链路：

```txt
Studio UI -> Studio Service -> ImageGenerationProvider -> Jimeng API
```

opencode tool 的定位是复用同一图片生成能力的 agent 入口：

```txt
opencode tool -> ImageGenerationProvider -> Jimeng API
```

这样既能用现有 Jimeng tool 快速起步，又不会把 Studio 的产品架构绑定到 opencode 会话和 tool result 上。后续要扩展视频、编辑、资产管理、批量生成时，Studio 只是在自己的业务模型里继续长出来。
