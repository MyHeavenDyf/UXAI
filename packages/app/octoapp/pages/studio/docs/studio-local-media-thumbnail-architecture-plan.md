# Studio 本地媒体缩略图架构与实施方案

## 1. 背景

Studio 当前把供应商返回的原始图片、视频 URL 同时用于右侧原图预览、对话结果卡片、文件管理网格和会话侧边栏。

供应商不提供真实缩略图。现有 `thumbnailUrl` 通常退化为原资源 URL，因此长对话会同时持有大量高分辨率图片和 `<video>` 节点，造成网络、图片解码、内存、显存、绘制和媒体管线压力。

本方案的核心目标是：

1. 供应商生成成功后，立即保留原始资源信息。
2. 本地服务异步生成并持久化轻量缩略图，不阻塞“生成成功”状态。
3. 对话、文件管理、详情缩略图区和侧边栏在本地缩略图 ready 后只展示静态缩略图。
4. 只有用户选中某个结果进入右侧画布、全屏、下载或编辑时才加载原始资源。
5. 缩略图生成对用户无感：图片和视频在任务排队、抽帧或失败时继续显示原资源，缩略图加载完成后原位平滑替换。

## 2. 结论与技术选择

采用“本地服务异步物化缩略图 + 前端按用途选择资源”的方案。

图片不把渲染进程 Canvas 作为主链路，原因如下：

- 跨域图片可以显示，但没有正确 CORS 响应头时无法从 Canvas 导出。
- 浏览器仍需完整下载和解码 2K/4K 原图。
- Canvas 编码若未放入 Worker，可能阻塞 UI 主线程。
- 图片缩略图已经可以由本地服务通过 `sharp` 稳定处理，没有必要让 UI 主线程重复承担完整解码和编码。

视频采用一条独立的无感补全链路：列表先渲染原始 `<video>`；同时创建不插入 DOM 的 CORS 视频元素完成 metadata、seek 和帧解码，再用小 Canvas 捕获一帧，交给本地服务校验、转码和持久化为 WebP poster。可见视频不设置 `crossOrigin`，避免供应商不支持 CORS 时连原视频也无法展示；离屏抽帧或保存失败时继续显示原视频，不改变 generation 成功状态，也不显示占位图。

## 3. 资源使用规则

| 使用位置 | 图片 | 视频 |
| --- | --- | --- |
| 对话结果卡片 | 缩略图 ready 前显示原图，ready 后平滑替换 | poster ready 前显示原视频并异步抽帧，ready 后平滑替换 |
| 文件管理网格 | 缩略图 ready 前显示原图，ready 后平滑替换 | poster ready 前显示原视频并异步抽帧，ready 后平滑替换 |
| 右侧详情缩略图区 | 缩略图 ready 前显示原图，ready 后平滑替换 | poster ready 前显示原视频并异步抽帧，ready 后平滑替换 |
| 左侧会话缩略图 | 缩略图 ready 前显示原图，ready 后平滑替换 | poster ready 前显示原视频，ready 后平滑替换 |
| 右侧主画布 | 原始资源 | 原始视频 |
| 全屏、下载、编辑 | 原始资源 | 原始视频 |

图片列表位置优先使用本地缩略图；缩略图未 ready 时继续使用原图，不能让后台优化改变原有可见性：

```ts
thumbnailStatus === "ready" && thumbnailUrl
  ? thumbnailUrl
  : originalUrl
```

从原资源切换到缩略图前应先预加载缩略图，加载完成后再替换当前节点，避免闪白或短暂占位。视频在 poster 尚未完成时允许临时创建真实 `<video>` 节点；poster ready 后改为静态 `<img>`，后续打开不再创建对应 `<video>`。

## 4. 数据结构

### 4.1 前后端媒体对象

扩展 `StudioImage`，明确区分可持久化路径和可直接访问的 URL：

```ts
type StudioImage = {
  id: string
  kind?: "image" | "video"

  // 原始资源。当前供应商 URL 继续保留。
  url: string
  remoteUrl?: string

  // 持久化值使用相对于 Studio 全局会话根的
  // .octo/<session>/thumbnails/... 路径。
  // 前端 normalize 阶段转换成 /artifact/serve URL。
  thumbnailUrl?: string

  thumbnailStatus?: "pending" | "ready" | "failed"
  width?: number
  height?: number
  duration?: number
}
```

首期可以继续沿用 `thumbnailUrl` 字段，避免大面积 SDK/API 变更，但需要约定：

- 后端持久化时允许它是相对于 Studio 全局会话根的 `.octo/...` 本地路径。
- 前端渲染前将本地路径转换成 `artifact/serve` URL。
- `remoteUrl ?? url` 始终代表原资源。

如果希望进一步消除语义歧义，可以新增 `thumbnailPath`，但这会增加 API schema 和兼容处理工作量，不是首期必要项。

### 4.2 历史消息格式

当前 completed tool output 只保存 `images: string[]`、`videos: string[]` 等原始 URL，无法恢复缩略图。

新增结构化 `media` 字段，同时保留旧字段兼容旧客户端：

```json
{
  "images": ["https://supplier/original.png"],
  "videos": [],
  "media": [
    {
      "id": "studio_img_xxx_0",
      "kind": "image",
      "url": "https://supplier/original.png",
      "remoteUrl": "https://supplier/original.png",
      "thumbnailUrl": ".octo/ses_xxx/thumbnails/studio_gen_xxx-0.webp",
      "thumbnailStatus": "ready",
      "width": 2048,
      "height": 2048
    }
  ]
}
```

读取规则：

1. 优先解析 `media`。
2. 没有 `media` 时继续解析旧的 `images`、`videos` 和 attachments。
3. 旧数据默认 `thumbnailStatus = pending`，先显示原图，回填完成后由本地缩略图原位替换。

## 5. 本地文件布局

### 5.1 Studio 使用全局会话根，不使用用户项目目录

Studio 与 Insight、Make 不同，不跟随用户当前选择的项目目录。`StudioPage` 当前使用：

```ts
const projectDir = useProjectDir({ mode: "config" })
```

这里的变量名 `projectDir` 容易产生误导。`mode: "config"` 实际通过 `octoSessionsDir(Global.Path.config)` 得到 Studio 全局会话根：

```text
Global.Path.config
  = <XDG_CONFIG_HOME>/opencode

Studio 全局会话根
  = <XDG_CONFIG_HOME>/octo/sessions
```

默认环境下通常类似：

```text
~/.config/octo/sessions
```

如果桌面端启用了 AppData fallback，则前缀可能类似：

```text
<Electron userData>/xdg-config/octo/sessions
```

实现时不得把缩略图写入用户当前选择的项目目录，也不得通过 `server.projects.last()`、Studio 路由参数中的旧项目目录或 Insight/Make 的 `sdk.directory` 推导缩略图根目录。

前端请求应继续使用 Studio 的 `projectDir()` 作为 `x-opencode-directory`；在 Studio 页面中它代表上述全局会话根。后端 Worker 应优先使用该 Studio session/generation 所属的 `Instance.directory`，避免自行硬编码 `~/.config` 或重新计算平台路径。

### 5.2 物理目录

缩略图保存到 Studio 全局会话根下的 session 独立目录：

```text
<Studio 全局会话根>/
  .octo/
    <sessionID>/
      uploads/
        source-<uuid>.png
        inpaint-composite-<uuid>.png
      thumbnails/
        <generationID>-0.webp
        <generationID>-1.webp
        <generationID>-video-0.webp
```

默认环境下，一个完整缩略图路径通常类似：

```text
~/.config/octo/sessions/.octo/<sessionID>/thumbnails/<generationID>-0.webp
```

其中 `uploads/` 是 Studio 当前保存重绘源图、局部重绘合成图、参考图和首尾帧的位置；`thumbnails/` 是本方案新增的内部派生资源目录。二者与 `outputs/` 平级，但缩略图不能混入 `uploads/` 或 `outputs/`。

数据库和 completed message 中可以继续持久化 session 相对定位值：

```text
.octo/<sessionID>/thumbnails/<generationID>-0.webp
```

该值不是相对于用户项目目录。前端调用 `artifact/serve` 时，必须同时传入 Studio 全局会话根作为 directory header，由服务端在对应 `Instance.directory` 下解析。

原因：

- session 删除时可随 session 目录一起清理。
- 不混入 `uploads` 或 `outputs`，避免显示在用户文件列表中。
- 现有 `artifact/serve` 已允许读取 session 目录内的相对路径。
- 路径稳定，不依赖当前服务地址、端口或认证信息。

写文件时使用临时文件加原子 rename：

```text
<generationID>-0.webp.tmp
  -> 写入成功
  -> rename 为 <generationID>-0.webp
```

避免应用中断后留下半文件。

## 6. 图片缩略图策略

### 6.1 输出参数

- 根据图片在结果卡片中的最大显示包围盒动态计算，不使用统一固定长边。
- 最大显示包围盒：`420 × 210 CSS px`。
- 目标像素密度：`TARGET_DPR = 1.5`。
- 绝对最长边安全上限：768px。
- 不放大小图；计算尺寸大于原图时保持原始像素尺寸。
- 格式：WebP。
- quality：80。
- 保留透明通道。
- 自动处理 EXIF orientation。
- 去除无用 metadata。
- 动图首期取首帧。

缩略图尺寸由“原图在 `420 × 210` 包围盒内按 `contain` 展示时的尺寸 × 1.5”得到，同时受原图尺寸和768px绝对上限约束：

```ts
const MAX_CSS_WIDTH = 420
const MAX_CSS_HEIGHT = 210
const TARGET_DPR = 1.5
const ABSOLUTE_MAX_EDGE = 768

const displayScale = Math.min(
  MAX_CSS_WIDTH / sourceWidth,
  MAX_CSS_HEIGHT / sourceHeight,
)
const scale = Math.min(
  1,
  displayScale * TARGET_DPR,
  ABSOLUTE_MAX_EDGE / Math.max(sourceWidth, sourceHeight),
)
const thumbnailWidth = Math.max(1, Math.round(sourceWidth * scale))
const thumbnailHeight = Math.max(1, Math.round(sourceHeight * scale))
```

必须先按 EXIF orientation 校正宽高，再参与上述计算。宽高无效或无法解析时将任务标记为失败，不允许为了继续处理而生成变形缩略图。

示例：

| 原图尺寸 | 缩略图尺寸 |
| --- | --- |
| 250 × 250 | 250 × 250 |
| 300 × 500 | 189 × 315 |
| 600 × 300 | 600 × 300 |
| 1024 × 256 | 630 × 158 |
| 1920 × 1080 | 560 × 315 |
| 2520 × 1080（21:9） | 630 × 270 |
| 4096 × 4096 | 315 × 315 |

对于 250 × 250 这类小图，仍建议生成一份本地 WebP 缩略资源，而不是在列表中直接使用远程原 URL。这样可以保持所有列表统一使用本地静态资源、统一缓存和失败处理；该步骤只是转码和落盘，不进行像素放大。如果转码后文件反而明显更大，可以保留原编码字节作为本地缩略资源，但显示尺寸和像素尺寸仍不得放大。

这套计算会让方图和竖图通常落在315px长边附近，只有横图和超宽图按实际显示需要提升到约560～630px。相比所有图片统一输出512px，它能降低多数图片的像素量；相比全局固定250px，它又能避免单张横图在结果卡片中被明显放大。首期仍只维护一份缩略图，无需为侧边栏、文件管理和结果卡片分别生成多套资源。

### 6.2 图片处理库

推荐在 `packages/opencode` 中直接声明 `sharp` 依赖，不依赖 lockfile 中其他包间接带入的版本。

需要在桌面端构建产物中验证：

- macOS arm64/x64
- Windows x64
- Linux x64/arm64（若产品支持）

如果某个平台无法加载图片处理库：

- 记录结构化错误。
- 将该媒体标记为 `thumbnailStatus = failed`。
- 生成结果仍保持 succeeded。
- 图片列表项回退原图，视频列表项回退原视频；该行为不改变 generation 的 succeeded 状态。

## 7. 视频缩略图策略

视频采用“原视频先展示、浏览器抽帧、服务端持久化、poster 预加载后替换”的无感流程：

1. `thumbnailStatus !== "ready"` 时渲染原始 `<video muted playsinline preload="auto">`，不显示占位图；该可见节点不设置 `crossOrigin`。
2. 并行创建不插入 DOM 的 `video`，在设置 `src` 前指定 `crossOrigin = "anonymous"`；metadata 就绪后 seek 到 `min(1 秒, duration × 10%)`，seek 完成后把当前帧绘制到小 Canvas。
3. Canvas 尺寸沿用缩略图动态计算和 `TARGET_DPR = 1.5`，不放大源视频，最长边再受 768px 绝对上限约束。
4. Canvas 编码为 WebP 后通过 `POST /studio/generations/:generationID/video-poster` 提交；本地服务再次用 `sharp` 校验、缩放和标准化编码，然后原子写入 `.octo/<sessionID>/thumbnails/<generationID>-<mediaIndex>.webp`。
5. 后端更新 generation result 和 completed tool message 中的 `thumbnailUrl/thumbnailStatus`，并发送现有 `PartUpdated` 事件。
6. 前端先预加载新 poster，成功后才把 `<video>` 原位替换成 `<img>`。

同一页面内使用 `server + directory + generationID + mediaIndex` 作为 Promise 去重键，同一帧只提交一次；成功结果在当前页面运行期缓存，后端再以确定性文件路径和同一媒体键保证幂等。所有离屏视频任务共用全局单并发串行队列，并通过 `requestIdleCallback`（不支持时退化为下一事件循环）启动，避免旧 session 同时创建大量视频解码器。离屏视频的 CORS 请求、Canvas 编码、视频 codec 或读取失败时，保留原视频继续展示，不创建占位状态，也不影响 generation 的 succeeded 状态。该实现不依赖系统 ffmpeg。

## 8. 异步任务模型

### 8.1 为什么不能阻塞生成完成

缩略图是展示优化，不应改变供应商任务的成功语义。供应商已经成功返回原资源后，应先：

1. 将 generation 标记为 succeeded。
2. 持久化原始媒体。
3. 更新对话消息，让用户立即看到成功状态和原图。
4. 再异步生成缩略图。

### 8.2 持久化任务表

为保证应用退出或崩溃后可以重试，新增 `studio_media_thumbnail` 表，而不是只创建内存 Promise：

```text
id
generation_id
session_id
directory
media_index
kind
source_url
status              queued | running | succeeded | failed
attempts
next_retry_at
lease_owner
lease_expires_at
thumbnail_path
error
time_created
time_updated
```

约束建议：

- `(generation_id, media_index)` 唯一。
- 删除 generation/session 时级联删除任务记录。
- 最大并发 2；默认先使用 1，性能验证后再调整。
- 最大重试 3 次，使用退避时间。
- `running` 任务必须带有限时租约，不能仅依赖内存中的“正在执行”状态。
- Worker 执行期间定期续租；任务完成或失败时必须校验 `lease_owner`，失去租约的旧 Worker 不得覆盖任务状态。
- 进程启动或 Instance 初始化时恢复 queued 任务，并回收租约已经过期的 running 任务。
- 相同 generation + index 的任务必须幂等。

Worker claim 必须通过数据库条件更新完成，只有满足以下条件之一的任务才可被领取：

```text
status = queued AND next_retry_at <= now
OR
status = running AND lease_expires_at <= now
```

领取成功后写入当前 `lease_owner` 和新的 `lease_expires_at`。只有成功完成条件更新的 Worker 才能处理该任务，避免多个 Worker 重复执行。

### 8.3 Worker 生命周期

```text
completeGeneration
  -> 保存 succeeded result
  -> completeStudioSession 写入原始 media + pending 状态
  -> enqueueThumbnailJobs
  -> startStudioThumbnailWorker

worker
  -> claim queued job 或租约过期的 running job
  -> 写入 lease_owner 和 lease_expires_at
  -> 下载并校验原资源
  -> 生成缩略图
  -> 原子写入 thumbnails 目录
  -> 更新 studio_generation.result
  -> 更新 completed tool part 的 output.media
  -> 发布 MessageV2.Event.PartUpdated
  -> job 标记 succeeded
```

前端已经监听 message part 更新，因此不需要为缩略图单独维护一条前端轮询链路。

### 8.4 页面切换、软件退出和崩溃恢复

缩略图任务属于本地服务，不属于 `StudioPage`、`StudioConversation` 等前端组件生命周期。

#### 切换 session 或切换到其他模块

- 前端页面卸载不能取消已经持久化的任务。
- 只要本地服务和 Studio 全局会话根对应的 Instance 仍在运行，Worker 就继续按低并发处理队列。
- 用户离开 Studio 后即使没有组件监听实时事件，Worker 仍会更新数据库和 completed message part。
- 再次进入 Studio 时，通过正常的 session messages 请求读取最新 `media.thumbnailUrl`，不依赖之前是否接收到实时事件。

#### Studio 全局会话 Instance 被释放

- Instance dispose 时停止领取新任务。
- 正在下载或解码的任务通过 `AbortSignal` 中止。
- 能执行优雅清理时，将当前任务重新置为 queued、清空租约且不增加失败次数。
- 如果进程在清理前退出，任务保持 running，后续通过租约过期机制回收。
- 任务在 Studio 全局会话根对应的 Instance 再次初始化时恢复，不依赖用户切回任何项目目录，也不要求其他 Instance 代为处理。

#### 正常关闭软件

- 已经处于 queued 的记录保持不变。
- 正在运行的任务尽量中止并恢复为 queued。
- 应用关闭后没有后台进程继续处理，但任务只是暂停，不会消失。
- 下次启动应用并初始化 Studio 全局会话根对应的 Instance 时启动 Worker，继续处理未完成任务。

#### 强制退出或崩溃

- 不能依赖 shutdown hook，因此 running 任务通过 `lease_expires_at` 自动恢复。
- 重启后，租约未过期时先等待；租约过期后重新 claim。
- 相同 generation + media index 使用确定性的目标文件名，重试不会生成多份正式缩略图。

#### 不同中断时点的幂等处理

缩略图提交顺序固定为：

```text
写临时文件
  -> 校验临时文件
  -> 原子 rename 为正式文件
  -> 更新 studio_generation.result
  -> 更新 completed message output.media
  -> 发布 PartUpdated
  -> job 标记 succeeded
```

恢复规则：

- rename 前中断：删除残留临时文件并重新生成。
- rename 后、数据库更新前中断：发现确定性正式文件存在且校验通过，复用文件并继续更新数据库。
- generation result 已更新、message 未更新时中断：从 generation result 继续修复 message。
- media 已完整持久化、job 尚未标记 succeeded 时中断：直接将 job 修正为 succeeded，不重复生成。
- session/generation 已被删除：停止任务并清理临时文件；外键级联删除任务记录。

这些规则保证任务可以至少执行一次，但最终正式文件和媒体记录只有一份。

## 9. 下载和安全限制

本地服务下载供应商资源时必须增加限制：

- 只处理 generation provider 返回并持久化的 URL，不能接受任意前端 URL。
- 允许访问任意 HTTPS 图片地址，不维护供应商域名 allowlist，也不拦截 loopback、私网、link-local、保留地址或代理 Fake IP；Studio 的部署环境允许使用内网资源。
- 跟随 redirect 后仍需重新校验 HTTPS 协议；本地文件等非 HTTPS 协议仍不允许。
- 限制请求超时，例如 30 秒。
- 限制最大响应体，例如图片 50 MiB、视频按产品上限配置。
- 校验 HTTP status、Content-Type 和实际文件签名。
- 限制最大像素数，防止解压炸弹。
- 下载与解码失败只影响缩略图任务，不影响原 generation。

对于 `data:image/...` 结果，可以直接在服务端解码，不发起网络请求。

## 10. 前端实现

### 10.1 URL 归一化

在 Studio 页面统一提供两个 accessor：

```ts
function originalMediaSrc(image: StudioImage) {
  return image.remoteUrl ?? image.url
}

function thumbnailMediaSrc(image: StudioImage) {
  if (image.thumbnailStatus === "ready" && image.thumbnailUrl) return artifactServeUrl(image.thumbnailUrl)
  if (image.kind !== "video") return originalMediaSrc(image)
  return undefined
}
```

`artifactServeUrl` 应复用 `getArtifactRelativePath` 和 `getArtifactServeUrl`，同时兼容已经是 HTTP/data/blob URL 的值。视频返回 `undefined` 表示应暂时渲染原始 `<video>`，不是显示占位图。

### 10.2 拆分原图和缩略图组件

不要继续让一个 `StudioMediaPreview` 同时服务画布和列表。

建议拆成：

```text
StudioMediaThumbnail
  - 图片 pending/failed 时使用 originalMediaSrc，ready 后使用 thumbnailMediaSrc
  - 图片加 loading="lazy"、decoding="async"
  - 视频 pending/failed 时临时渲染原视频并触发抽帧
  - 视频 poster 预加载成功后渲染成静态 <img>
  - poster 加载失败时回退原视频，不显示占位图

StudioOriginalMedia
  - 图片使用 originalMediaSrc
  - 视频使用 StudioVideoPlayer
  - 只在右侧画布/全屏/编辑场景挂载
```

### 10.3 不同区域的替换

- `StudioResultCard` 使用 `StudioMediaThumbnail`。
- `StudioFileManager` 使用 `StudioMediaThumbnail`。
- `StudioDetails` 的小图列表使用 `StudioMediaThumbnail`。
- `StudioResultCanvas` 使用 `StudioOriginalMedia`。
- fullscreen 继续使用原始资源，但统一通过 `originalMediaSrc`。
- session thumbnail store 优先解析结构化 `media[].thumbnailUrl`。

### 10.4 离屏渲染补充

缩略图完成后仍应加入：

- 所有列表图片使用 `loading="lazy"`。
- 所有列表图片使用 `decoding="async"`。
- turn 容器使用 `content-visibility: auto` 和合理的 `contain-intrinsic-size`。
- 长期再引入 turn 虚拟化或历史分页。

缩略图主要解决媒体资源成本，不能完全解决所有历史 DOM 常驻问题。

## 11. 历史数据兼容与回填

### 11.1 旧消息读取

旧消息没有 `media` 和真实缩略图：

- 仍能通过旧 `images/videos/attachments` 恢复原资源。
- 列表先显示原图片或原视频。
- 缩略图/poster ready 后预加载本地资源，再原位替换原资源。

### 11.2 懒回填

新增幂等 ensure 能力，例如：

```text
POST /studio/sessions/:sessionID/thumbnails/ensure
```

进入旧 Studio session 后调用一次：

1. 服务端查找该 session 中 succeeded 且缺少缩略图的 generation。
2. 为缺失项插入任务，已存在任务不重复创建。
3. 立即返回，不等待缩略图完成。
4. Worker 按限流逐步生成。
5. 每个媒体完成后通过已有 message part 更新事件刷新 UI。

前端 ensure 请求失败时在当前 session 生命周期内使用退避重试；重试只重复调用幂等 ensure，不等待缩略图生成，页面卸载时取消请求和计时器。

因此旧 session 的任务触发时机是“首次进入该 session 并调用 ensure”，而不是应用启动时批量扫描全部历史 session。ensure 只负责持久化入队，不持有页面级 Promise，也不要求用户停留在 Studio 页面。

旧 session 图片很多时允许产生大量 queued 记录，但实际下载、解码并发仍限制为1，验证稳定后最多调整为2。切换模块不会清空队列；关闭软件会暂停队列；重新启动应用并初始化 Studio 全局会话 Instance 后继续执行。重复进入同一 session 会再次调用 ensure，但由于 `(generation_id, media_index)` 唯一约束，不会重复创建任务。

持久化任务表只承载服务端可独立完成的图片任务。视频 poster 由页面中的原视频完成解码和抽帧，因此它不是持久化 Worker 任务：切换模块后已经提交到后端的保存请求可以继续完成；若在抽帧或提交前关闭软件，该次浏览器任务会消失，下次进入包含该视频的 session 时重新尝试。前端只对正在执行的同一媒体 Promise 去重，单个组件生命周期内也只尝试一次；后端使用确定性文件路径和媒体键幂等保存，不会产生重复 poster 文件。

不要在应用启动时一次性扫描并处理全部历史 session，避免冷启动时大量下载和 CPU 占用。

## 12. 涉及文件

### 12.1 新增文件

#### `packages/opencode/src/studio/studio-media-thumbnail.sql.ts`

- 定义缩略图任务表。
- 定义任务 status 类型和索引。
- 定义 generation/media 唯一约束。

#### `packages/opencode/src/studio/studio-media-thumbnail.ts`

- 统一兼容开发源码、Node bundle 和 Electron sidecar 中 `sharp` 的 CommonJS/ESM 导出形态。

- 创建缩略图任务。
- Worker 调度、claim、重试和恢复。
- 使用 Studio session/generation 所属的 `Instance.directory` 作为全局会话根；禁止使用用户项目目录或硬编码平台配置路径。
- 安全下载远程资源。
- 图片缩放、WebP 编码和原子写入。
- 更新 generation result 和 completed message part。
- 发布 `PartUpdated` 事件。

#### `packages/opencode/migration/<timestamp>_studio_media_thumbnail/migration.sql`

- 创建 `studio_media_thumbnail` 表、索引和外键。

#### `packages/opencode/test/studio/studio-media-thumbnail.test.ts`

- 图片缩略图尺寸和格式测试。
- 幂等入队测试。
- 失败不改变 generation succeeded 状态。
- queued 任务跨重启恢复测试。
- running 任务租约过期后重新 claim 测试。
- 页面/模块切换不取消后台任务测试。
- 在临时文件、rename、generation result 和 message 更新等不同阶段中断后的幂等恢复测试。
- 非 HTTPS URL、超大文件、错误 MIME 拒绝测试；私网和保留地址应允许访问。
- completed message media 更新测试。
- 浏览器提交的视频帧被规范化为 WebP poster、幂等复用且不创建图片 Worker 任务的测试。

#### `packages/app/octoapp/pages/studio/studio-media.ts`

- `originalMediaSrc`。
- `thumbnailMediaSrc`。
- 本地 artifact path 转 serve URL。
- 构造 serve URL 和 directory header 时使用 Studio 的 config-mode 全局会话根。
- 原资源和 ready 本地缩略图选择逻辑。

#### `packages/app/octoapp/pages/studio/studio-media-thumbnail.tsx`

- 统一媒体缩略图组件。
- lazy loading、async decoding。
- 视频原资源展示、seek 抽帧、poster 提交与前端任务去重。
- 图片、视频 badge、原资源到缩略图的平滑替换；poster 失败时回退原视频。

#### `packages/app/octoapp/pages/studio/studio-media.test.ts`

- 原资源和缩略图 URL 选择测试。
- artifact path 转换测试。
- 缩略图 pending、failed 和旧数据状态使用原图，ready 后使用本地缩略图测试。

### 12.2 修改文件

#### `packages/opencode/src/studio/studio-service.ts`

- `buildGenerationResult` 不再把原 URL 默认写入 `thumbnailUrl`。
- `completeGeneration` 成功后入队缩略图任务。
- `completeStudioSession` 在 output 中持久化结构化 `media`。
- 提供更新 completed tool part media 的内部 helper。
- Instance dispose 时停止对应目录的缩略图任务。

#### `packages/opencode/src/studio/image-provider.ts`

- 保留供应商真实 `thumbnailUrl` 的兼容能力。
- 明确供应商不返回缩略图时字段为 `undefined`，不能回退成 `url`。

#### `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

- API schema 增加 `thumbnailStatus`。
- 增加 session thumbnails ensure endpoint schema。
- 增加 `POST /studio/generations/:generationID/video-poster` schema，只接受媒体索引和浏览器捕获的帧数据。

#### `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

- 实现 ensure endpoint，调用幂等入队函数后立即返回。
- 实现 video poster 保存 endpoint，不等待或改变 generation 的成功状态。

#### `packages/opencode/package.json`

- 将选定图片处理库声明为直接依赖。
- 如果选择 `sharp`，同步验证构建脚本会包含各平台 native binary。

#### `bun.lock`

- 由依赖安装正常更新，不手工编辑。

#### `packages/app/octoapp/pages/studio/types.ts`

- `StudioImage` 增加 `thumbnailStatus`。

#### `packages/app/octoapp/pages/studio/turns.ts`

- 新增结构化 `media` 解析。
- 优先使用 `media`，兼容旧 `images/videos/attachments`。
- 旧媒体不再把 `item.url` 自动复制到 `thumbnailUrl`。
- 可导出通用 `parseToolMedia` 给 session thumbnail 使用。

#### `packages/app/octoapp/pages/studio-page.tsx`

- `normalizeImage` 解析本地 thumbnail artifact path。
- session 打开后触发一次异步 ensure。
- `pickThumbnail` 优先返回 ready thumbnail，否则返回原图片。
- 右侧画布、下载、编辑统一使用 original source。

#### `packages/app/octoapp/pages/studio/studio-result-card.tsx`

- 图片和视频统一使用 `StudioMediaThumbnail`。
- 缩略图 pending/failed 时展示原图片或原视频，ready 后预加载并平滑替换。
- 向缩略图组件传递 `generationID/mediaIndex`，用于视频 poster 的唯一身份和保存。

#### `packages/app/octoapp/pages/studio/studio-conversation.tsx`

- 将当前通用 `StudioMediaPreview` 拆分为缩略图和原图组件。
- `StudioResultCanvas` 使用原资源。
- `StudioDetails` 小图列表使用缩略图。
- fullscreen 使用原资源。

#### `packages/app/octoapp/pages/studio/studio-file-manager.tsx`

- 图片网格在缩略图 ready 前使用原图，ready 后切换缩略图。
- 视频 poster ready 前使用原视频并抽帧，ready 后只创建静态 `<img>`。
- 保留 `loading="lazy"`，增加 `decoding="async"`。

#### `packages/app/octoapp/pages/studio/session-thumbnail.ts`

- 优先从 `media` 中提取 ready thumbnail。
- 没有 poster 时仍可从结构化 `media` 或旧 `videos` 中恢复原视频 URL。
- localStorage 同时持久化 URL、媒体 kind 和是否为原资源 fallback。

#### `packages/app/octoapp/pages/studio/studio-history.tsx`

- 视频 session 在 poster ready 前渲染原视频，ready 后渲染静态 `<img>`。
- 不因 poster pending/failed 显示占位图。

#### `packages/app/octoapp/pages/studio/studio-02.css`

- turn 增加离屏渲染优化。
- 给视频占位和真实资源加载失败状态补充样式。

#### `packages/app/octoapp/pages/studio/studio-03.css`

- 结果卡片静态视频 poster 和 badge 样式。
- 避免对缩略图使用高成本滤镜或大面积阴影。

#### `packages/app/octoapp/pages/studio/turns.test.ts`

- 新 `media` 格式解析。
- 旧消息兼容。
- 缩略图缺失时不复制原 URL。
- 图片和视频 kind、尺寸、duration 保留测试。

#### `packages/app/octoapp/pages/studio/session-thumbnail.test.ts`（若现有测试文件不存在则新增）

- 侧边栏优先真实 thumbnail。
- 没有 thumbnail 时返回原图片，ready 后切换本地缩略图。
- 视频 poster 未 ready 时返回原 mp4，ready 后返回本地 poster。

## 13. 分阶段实施顺序

### 第一阶段：图片缩略图和视频无感 poster

1. 增加结构化 `media` 持久化和兼容解析。
2. 增加图片缩略图任务表及 Worker。
3. 按 `420 × 210 CSS px`、`TARGET_DPR = 1.5` 和768px绝对上限动态生成 WebP。
4. 拆分缩略图/原图组件。
5. 对话、文件管理、详情小图和侧边栏先显示原图，再无感替换成本地缩略图。
6. 历史视频先展示原视频，通过浏览器 Canvas 抽帧并由后端持久化 poster，完成后无感替换。
7. 增加 lazy、async decoding 和 `content-visibility`。

该阶段已经能解决大部分滚动卡顿。

### 第二阶段：历史回填

1. 增加 session ensure endpoint。
2. 进入旧 session 时按需入队。
3. 限流处理旧媒体。
4. 增加失败重试和可观测日志。

### 第三阶段：视频 poster 稳定性验证

1. 覆盖损坏视频、无法 seek、跨域 Canvas、超时和 codec 不支持测试。
2. 验证切换模块、关闭重启后重新进入 session 能安全补做尚未持久化的 poster。
3. 验证同一视频在结果卡片、文件管理和详情区同时挂载时只提交一次。
4. 根据真实数据评估是否需要把浏览器抽帧升级成独立的跨平台本地媒体处理能力。

### 第四阶段：超长对话上限治理

1. turn `content-visibility` 效果验证。
2. 引入消息分页或 turn 虚拟化。
3. 优化 `buildStudioTurns` 当前随消息数量增长的重复查找。

## 14. 验收标准

### 功能

- 新生成图片成功后，右侧可以立即查看原图。
- 新生成或旧 session 中的视频 poster 未 ready 时立即显示原视频，不出现视频图标占位。
- 缩略图/poster 稍后生成，预加载完成后自动替换原资源，过程中不出现占位图或闪白。
- 重启应用、重新进入 session 后仍使用本地缩略图。
- 下载、全屏和编辑得到的是原资源，不是动态缩略图。
- 缩略图生成失败不改变 generation succeeded 状态。
- 旧 session 可以正常显示，并能按需回填。
- 进入旧 session 后立即切换到其他模块，图片 Worker 任务以及已经进入前端队列的视频 poster 任务仍继续执行。
- 图片缩略图排队或执行期间关闭软件，重新启动应用并初始化 Studio 全局会话 Instance 后任务继续；尚未落盘的视频 poster 在下次进入 session 时补做，且两类任务都不产生重复文件。
- 切换用户项目目录不会改变 Studio 缩略图的物理根目录，也不会导致同一 session 生成多套缩略图。
- 强制退出留下的 running 任务在租约过期后可以自动恢复。
- session 删除后对应 thumbnail 文件和任务记录被清理。

### 性能

- 已完成缩略图回填的长对话再次打开时，Network 中不批量请求全部原图和原视频；首次回填旧会话时允许先加载原图以保证内容连续可见。
- poster 已 ready 的视频在对话列表中只创建静态 `<img>`；首次抽帧期间允许临时存在 `<video>`。
- 滚动历史时只解码按显示包围盒动态生成的缩略图。
- 50 个 turn、每个 4 张图片且缩略图已 ready 的测试数据下，原图请求数应接近 0；旧会话首次回填期间不适用该指标。
- 缩略图 Worker 并发受控，不造成明显 UI 卡顿或 CPU 峰值。

### 回归

按仓库要求从 package 目录运行：

```bash
cd packages/opencode
bun test test/studio
bun typecheck

cd packages/app
bun test octoapp/pages/studio
bun typecheck
```

不得从仓库根目录运行测试。

## 15. 风险与回滚

### 风险

- native 图片依赖在部分平台未被正确打包。
- 大图片或异常文件造成内存峰值。
- message output 与 generation result 更新不一致。
- 旧客户端不识别 `media`。

### 控制措施

- `media` 为新增字段，保留旧字段向后兼容。
- 缩略图任务失败不影响原 generation。
- 限制下载大小、像素数、超时和并发。
- generation result 与 message part 更新使用同一个 helper 构建媒体数据。
- 每个任务幂等，可重复执行。

### 回滚

- 前端可以通过 feature flag 暂时关闭本地缩略图显示。
- 后端停止入队不影响已有原始结果。
- 新任务表为附加数据，不改变 generation 主状态。
- 即使回滚，旧 `images/videos` 字段仍可恢复原资源。
