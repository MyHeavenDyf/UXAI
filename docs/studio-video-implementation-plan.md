# Studio 视频生成实现方案

## 目标与范围

基于 `docs/video.md` 中的视频创建参数与交互思路，在当前 Studio 中新增视频生成能力。首期只实现两种类型：

- 文生视频：用户输入 prompt 后生成视频。
- 首尾帧生成：用户上传首帧、可选尾帧，再输入 prompt 生成视频。

不实现 `video.md` 中的多图参考、风险控制弹窗、历史图片选择侧栏、埋点、示例 prompt 循环、画布导出上传等功能。最终仍复用 Studio 现有生成入口 `/studio/generations`，前端展示形态延续 Studio 图片信息预览的结构，只把媒体渲染从图片扩展为视频。

## 当前现状

相关文件：

- `packages/app/octoapp/pages/studio/index.tsx`：Studio 页面、输入框、生成提交、画布、详情面板。
- `packages/app/octoapp/pages/studio/types.ts`：Studio 前端类型。
- `packages/app/octoapp/pages/studio/data.ts`：能力、比例、风格、工具配置。
- `packages/app/octoapp/pages/studio/turns.ts`：从 session message/part 中解析 Studio 轮次和结果。
- `packages/opencode/src/studio/image-provider.ts`：生成服务输入输出类型。
- `packages/opencode/src/studio/studio-service.ts`：`/studio/generations` 的服务实现和 session 持久化。
- `packages/opencode/src/tool/internel_image_generate.ts`：内部 create task/query task 工具。
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`：Studio HTTP API schema。

当前 `video.generate` 已存在于 `StudioCapability` 和 `STUDIO_CAPABILITIES`，但没有加入 `SUPPORTED_STUDIO_CAPABILITIES`。生成服务也仍按图片结果处理：`StudioGenerationResult.images`、tool attachment 的 `mime: image/png`、`turns.ts` 只提取图片 URL、画布用 `<img>` 展示。

## 产品交互

### 能力入口

在能力菜单中启用 `video.generate`。选中视频生成后，Composer 切换为视频输入形态：

- 顶部输入区域展示首帧、交换箭头、尾帧两个上传位，视觉参考需求图。
- 下方保留一个 textarea，placeholder 使用：“请描述你想生成的视频内容，或使用反推描述图片，也可查看使用指南提升生成效果。”
- 底部工具栏展示：
  - `视频生成` 能力按钮。
  - 参数按钮。
  - 发送按钮。

### 视频子类型

用一个前端状态表示视频类型：

```ts
type StudioVideoMode = "text" | "first_last_frame"
```

建议默认策略：

- 默认是文生视频。
- 输入区常态显示首帧、尾帧两个上传位。
- 用户未上传任何图片时按文生视频提交。
- 用户上传首帧或尾帧后按首尾帧生成提交。
- 用户删除所有视频帧后回到文生视频。
- 参数面板不提供“文生视频 / 首尾帧”分段选择，生成类型完全由上传位是否有图片判断。

### 上传规则

只支持首尾帧两个位置：

- 首帧：首尾帧生成时必填。
- 尾帧：可选。
- 支持本地上传和粘贴图片。
- 文件限制沿用 `video.md`：
  - `image/png`、`image/jpeg`。
  - 最小边不小于 300px。
  - 长短边比例不大于 2.5。
  - 文件大小不超过 10MB。

当前 Studio 只有单张参考图上传逻辑，需要新增两个独立资产位，而不是复用 `assets()[0]`。

### 参数面板

视频参数放到现有 `settings` 菜单中，图片生成继续使用 `ImageSettings`，视频生成新增 `VideoSettings`：

- 比例：只提供 `1:1`、`9:16`、`16:9`。可从 `STUDIO_ASPECT_RATIOS` 过滤得到，不单独扩展图片比例。
- 时长：`5`、`10`，默认 `5`。
- 数量：`1`、`2`、`3`、`4`，默认 `1`。
- 模式：`std` 标准模式、`pro` 高质量模式，默认 `std`。

首尾帧生成中，如果首帧和尾帧都存在，则自动设置 `mode: "pro"` 并禁用模式选择，保持 `video.md` 的联动规则。

## 前端数据设计

在 `types.ts` 中扩展媒体类型。建议保留 `images` 字段做兼容，同时新增通用 `media` 字段；首期 UI 优先读 `media`，没有时回退 `images`。

```ts
type StudioMediaKind = "image" | "video"

type StudioMedia = {
  id: string
  kind: StudioMediaKind
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  duration?: number
  remoteUrl?: string
  localPath?: string
}
```

`StudioGenerationResult` 新增：

- `media?: StudioMedia[]`
- `videoMode?: StudioVideoMode`
- `duration?: "5" | "10"`
- `videoQualityMode?: "std" | "pro"`

`StudioGenerationRequest.extra` 用于传递视频专属参数：

```ts
{
  videoMode: "text" | "first_last_frame",
  duration: "5" | "10",
  mode: "std" | "pro",
  firstFrame?: "data:image/...",
  lastFrame?: "data:image/..."
}
```

## 前端实现拆分

### 1. 启用能力

在 `index.tsx` 的 `SUPPORTED_STUDIO_CAPABILITIES` 中加入 `"video.generate"`。

`canSubmit` 调整为：

- 图片生成：保持现状。
- 文生视频：prompt 非空。
- 首尾帧生成：首帧存在；prompt 可为空但建议允许为空时使用默认描述“根据首尾帧生成自然连贯的视频”。

### 2. Composer 改造

`StudioComposer` 增加 props：

- `videoMode`
- `videoFrames`
- `videoDuration`
- `videoQualityMode`
- `onVideoMode`
- `onVideoDuration`
- `onVideoQualityMode`
- `onPickVideoFrame`
- `onPasteVideoFrame`
- `onRemoveVideoFrame`
- `onSwapVideoFrames`

内部根据 capability 分三类渲染：

- `image.generate`：沿用现有参考图上传、风格、图片参数。
- `video.generate`：始终渲染首尾帧上传区和视频参数；不额外提供视频类型切换控件。
- 其它图片编辑能力：不展示上传位，保持工作区编辑流程。

上传位建议用 `.studio-composer-video-frame` 等新 class，尺寸约 `52 x 112`，模拟需求图中的倾斜小卡片；首帧/尾帧 label 固定展示在卡片内。上传后显示缩略图和删除按钮。

### 3. 提交流程

`runGeneration()` 允许接收视频 override：

```ts
{
  capability: "video.generate",
  extra: {
    videoMode,
    duration,
    mode,
    firstFrame,
    lastFrame,
  }
}
```

`createStudioGeneration()` 仍 POST `/studio/generations`，payload 中：

- `capability: "video.generate"`
- `prompt`
- `aspectRatio`
- `count`
- `imageTool: "internel"`
- `referenceImages`: 首尾帧生成时传 `[firstFrame, lastFrame].filter(Boolean)`，文生视频为空数组。
- `extra`: 传视频模式、时长、模式，以及首尾帧字段。

### 4. 结果展示

保留 Studio 现有三处展示结构：

- `StudioConversation`：结果卡片仍显示能力 badge、标题、创建时间、缩略图网格。由于接口首期只有视频 URL，卡片内直接基于该 URL 展示一张静态预览图；实现上优先使用视频第一帧作为缩略图，没有可用缩略图时再显示统一视频占位。
- `StudioResultCanvas`：如果当前 media 是视频，使用 `<video controls playsinline>` 展示；否则用 `<img>`。
- `StudioDetails`：缩略图网格改成媒体网格。`studio-detail-panel` 最上方展示与结果卡片一致，优先使用视频第一帧静态图；如果无法取帧，则显示统一视频占位。生成信息增加“时长”和“类型”，操作区只保留“再次生成”和“下载”，隐藏变清晰/抠图/局部重绘/扩图。

文案映射：

- 生成中：`视频生成中`
- 成功：`视频生成完成`
- badge：`视频生成`
- 类型：`文生视频` 或 `首尾帧生成`

下载逻辑复用 `downloadCurrentImage()`，改名为 `downloadCurrentMedia()`，视频文件名使用 `.mp4` 或从 URL 推断扩展名。

## 后端服务设计

### 1. 类型扩展

`image-provider.ts` 建议逐步改名不作为首期要求，但类型应扩展为媒体：

```ts
type StudioGeneratedMedia = {
  kind: "image" | "video"
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  duration?: number
}
```

`ImageGenerateOutput` 新增 `media?: StudioGeneratedMedia[]`。为兼容图片链路，图片 provider 可以继续只返回 `images`。

### 2. 内部工具请求体

在 `internel_image_generate.ts` 中让 `buildInternalRequestBody()` 优先处理 `capability === "video.generate"`。

文生视频请求体：

```json
{
  "user": { "idx": "[user_id]" },
  "task_type": "t2v_seedance",
  "args": {
    "tag_name": "文生视频",
    "prompt": "用户输入的提示词",
    "aspect_ratio": "1:1",
    "duration": "5",
    "count": 1,
    "mode": "std"
  }
}
```

首尾帧生成请求体：

```json
{
  "user": { "idx": "[user_id]" },
  "task_type": "i2v_seedance",
  "args": {
    "tag_name": "图生视频",
    "prompt": "用户输入的提示词",
    "aspect_ratio": "1:1",
    "duration": "5",
    "count": 1,
    "mode": "std",
    "image": "首帧base64",
    "image_tail": "尾帧base64"
  }
}
```

注意：`image`、`image_tail` 发送时 strip `data:image/...;base64,` 前缀，和 `video.md` 保持一致。尾帧为空时不传 `image_tail`。

### 3. 查询结果解析

新增视频 URL 提取逻辑，优先从常见字段读取：

- `result.results`
- `result.videos`
- `result.video_url`
- `result.videoUrl`
- `result.results_v2[].output.video`
- 递归扫描 `http(s)` 且扩展名或 query 中看起来是视频的 URL。

可识别视频 URL：

- `.mp4`
- `.mov`
- `.webm`
- `data:video/...;base64,...`

`executeInternelImageGenerate()` 返回：

- 视频能力：`media: [{ kind: "video", url }]`，`images: []`。
- 图片能力：保持现状。

### 4. Studio service 持久化

`studio-service.ts` 的关键调整：

- `StudioGenerationResult` 增加 `media`。
- 校验结果时对视频使用 `output.media?.length`，图片继续用 `output.images.length`。
- `completeStudioSession()` 写 tool output 时增加：
  - `media`
  - `videos`
  - `primaryVideo`
  - `videoMode`
  - `duration`
- tool attachment 的视频项使用 `mime: "video/mp4"`，filename 后缀 `.mp4`。
- `toolTitle` 对视频使用 `视频生成`。

保留 `images` 字段为空数组，避免旧 UI/测试因为字段缺失失败。

### 5. turns 解析

`turns.ts` 新增通用 media 解析：

- `isRenderableVideoUrl()`
- `collectVideoUrls()`
- `parseToolVideos()`
- `parseToolMedia()`：合并 attachments、output.images、output.videos、primaryImage、primaryVideo。

构建 result 时：

- `media` 包含图片和视频。
- `images` 只包含图片，用于兼容旧逻辑。
- 对 `video.generate`，`toolTitle` 使用视频文案。
- `buildStudioConversationContext()` 对视频摘要写“1 个视频”，不要依赖 `images.length` 判断是否有结果。

## API Schema 与 SDK

`packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` 中：

- payload 已支持 `video.generate` 和 `extra`，无需大改。
- success schema 增加 `media` 数组、`duration`、`videoMode`、`videoQualityMode`。
- `toolAction` 可选增加 `"generate_video"`，或视频先不设置 `toolAction`。

如果改动影响 OpenAPI/SDK，按仓库指令运行：

```sh
./packages/sdk/js/script/build.ts
```

## 样式方案

在 `studio.css` 增加少量视频专用样式：

- `.studio-composer.video`：保持现有渐变边框和圆角。
- `.studio-composer-video-frames`：水平排列首帧、交换按钮、尾帧。
- `.studio-composer-video-frame`：固定尺寸、轻微旋转、空状态灰底。
- `.studio-composer-video-frame.filled`：显示缩略图。
- `.studio-composer-video-swap`：中间交换图标按钮。
- `.studio-canvas-video`：`max-width: 100%`、`max-height: 100%`、`object-fit: contain`、圆角沿用图片画布。
- `.studio-detail-preview-video`：缩略图按钮内的视频封面/占位。

移动端和窄屏下，首尾帧上传区保持在 textarea 上方，不挤占输入文字宽度。

## 测试计划

前端：

- `video.generate` 能在能力菜单中选择。
- 文生视频无 prompt 时不能提交，有 prompt 可提交。
- 首尾帧上传首帧后可提交，删除首帧后不可提交。
- 首尾帧均存在时模式自动切为 `pro` 且禁用。
- 成功结果在对话卡片、画布、详情面板中都以视频展示。
- 视频结果详情隐藏图片编辑按钮。

后端：

- `buildInternalRequestBody()` 对文生视频生成 `task_type: "t2v_seedance"`。
- 首尾帧生成 `task_type: "i2v_seedance"`，首帧必传，尾帧可选。
- query 响应中视频 URL 能被提取到 `media`。
- `studio-service` 能把视频结果持久化为 tool output 和 video attachment。
- `turns.ts` 能从历史 session 还原视频结果。

建议运行：

```sh
cd packages/app/octoapp
bun typecheck
```

```sh
cd packages/opencode
bun typecheck
```

如果新增或修改 `turns.test.ts`，从对应 package 目录运行测试，避免在仓库根目录运行测试。

## 实施顺序

1. 扩展前后端类型：新增通用 media 字段，保持 images 兼容。
2. 后端接入 `video.generate` 请求体和视频结果解析。
3. 扩展 `studio-service` 持久化和 HTTP schema。
4. 扩展 `turns.ts` 解析视频 media。
5. 启用前端 `video.generate`，实现 Composer 视频输入和参数面板。
6. 扩展画布、对话卡片、详情面板的视频展示。
7. 补充 typecheck 和关键单测。

## 风险与取舍

- 当前内部工具文件名仍叫 `internel_image_generate.ts`，首期可以继续复用，避免同时改工具注册名和 agent prompt；后续可再抽象为 media provider。
- 视频生成耗时可能超过当前 `STUDIO_GENERATION_TIMEOUT_MS = 180_000`，建议根据真实接口耗时调整到 5 到 10 分钟，或者后续改成任务式轮询 UI。
- 如果接口不能稳定返回缩略图，详情缩略图可以先用视频元素第一帧展示，后续再补封面生成。
- 首期不走 agent 工具强制调用链路，而是沿用当前 Studio 直接 POST `/studio/generations` 的实现方式，改动面更小。
