# Studio 本地媒体缩略图无 `sharp` 改造方案

## 1. 文档定位

本文基于当前已经实现的 Studio 缩略图代码，给出移除 `sharp` 后的完整改造方案。

本文取代 `studio-local-media-thumbnail-architecture-plan.md` 中以下设计：

- sidecar 使用 `sharp` 下载、解码、缩放和编码图片；
- sidecar 常驻 Worker 自动消费图片缩略图队列；
- 视频 Canvas 抽帧结果再次交给 `sharp` 校验和转码；
- 应用启动并初始化 Studio Instance 后自动恢复并执行全部排队任务。

本文不改变以下既有约定：

- 原始媒体 URL 永久保留，右侧主画布、全屏、下载和编辑继续使用原资源；
- 缩略图仍保存到 Studio 全局会话根下的 `.octo/<sessionID>/thumbnails/`；
- `TARGET_DPR = 1.5`；
- pending、排队、生成失败时继续显示原图或原视频，不显示占位图；
- 缩略图加载成功后才原位替换原资源；
- 不考虑供应商 URL 失效场景；
- 不增加供应商域名白名单，也不拦截内网、loopback、保留地址或代理 Fake IP。

## 2. 当前问题

当前 `packages/opencode/src/studio/studio-media-thumbnail.ts` 动态导入 `sharp`。源码环境可以解析该模块，但桌面端构建会经历两次打包：

1. `packages/opencode/script/build-node.ts` 将 opencode server 打成 Node ESM 单文件；
2. `packages/desktop/electron.vite.config.ts` 再把该文件打入 Electron sidecar。

`sharp` 的 JavaScript 被打进 sidecar 后，内部仍需动态加载平台原生文件，例如：

```text
@img/sharp-win32-x64/sharp.node
```

当前 Electron 产物没有携带并解包该文件，因此 Windows 实际运行时报错：

```text
Could not load the "sharp" module using the win32-x64 runtime
```

这不是 `bun run dev:beta` 的使用方式错误，而是 native addon 与当前双重单文件打包方式不兼容。

## 3. 最终架构结论

采用以下职责划分：

```text
进入 Studio 并打开 session
  -> ensure 接口为缺少缩略图的媒体创建唯一任务记录
  -> 页面中的 StudioMediaThumbnail 发现 pending 媒体
  -> 当前 Studio 页面级单并发队列在 idle 时处理
  -> 图片通过本地同源 source 接口读取原始字节
  -> Chromium 解码 + 离屏 Canvas 缩放 + WebP 编码
  -> 视频沿用 Chromium video seek + Canvas 抽帧 + WebP 编码
  -> 把已经缩放完成的 WebP 提交给本地保存接口
  -> sidecar 只做轻量字节校验、原子写文件和数据库更新
  -> PartUpdated 刷新页面
  -> 前端预加载本地缩略图后无感替换原资源
```

关键变化：

- sidecar 不再解码、缩放或重新编码图片；
- sidecar 不再导入 `sharp`；
- Chromium 是唯一的媒体解码与缩略图编码执行者；
- `studio_media_thumbnail` 表继续保留，但定位从“sidecar Worker 队列”调整为“持久化任务状态账本”；
- 只有 Studio 页面处于打开状态时才消费任务；
- 打开应用但未进入 Studio，不扫描历史 session，也不执行缩略图任务；
- 进入 Studio 但未打开某个旧 session，不处理该 session；
- 切出 Studio 或关闭应用时停止未完成的浏览器任务；下次重新进入相关 session 后继续；
- 数据库唯一索引、前端 Promise Map 和确定性文件名共同保证不创建重复任务或重复正式文件。

## 4. 生命周期定义

### 4.1 新生成结果

供应商生成完成后的顺序：

1. generation 立即标记为 `succeeded`；
2. 保存原始媒体 URL；
3. completed tool message 立即展示原始媒体；
4. 为缺少缩略图的图片或视频写入唯一的 `queued` 任务记录，但不启动 sidecar Worker；
5. 如果用户当前仍停留在 Studio，媒体组件挂载后进入页面级 Canvas 队列；
6. 如果页面已经退出，任务记录保留，下一次进入该 session 时处理。

缩略图永远不能延迟或改变 generation 的成功状态。

### 4.2 旧 session

只有打开旧 session 时才调用：

```text
POST /studio/sessions/:sessionID/thumbnails/ensure
```

该接口只做以下工作：

- 扫描该 session 中成功的 generation；
- 把缺少本地缩略图的图片和视频规范化为 `thumbnailStatus: pending`；
- 通过 `(generation_id, media_index)` 唯一索引创建缺失的任务记录；
- 把旧实现因 `sharp` 失败留下的任务恢复为 `queued`；
- 立即返回，不下载、不解码、不生成缩略图。

实际 Canvas 任务由当前 Studio 页面的媒体组件触发。

### 4.3 切换 session

在 Studio 内切换 session 时：

- 新 session 调用自己的 ensure；
- 页面队列允许当前已经开始编码或提交的单个任务完成；
- 尚未开始的旧 session 内存任务取消；
- 数据库记录仍是 `queued`，以后进入旧 session 时重新加入内存队列；
- 已成功保存的任务为 `succeeded`，以后不会重复生成。

### 4.4 切出 Studio、关闭应用或崩溃

- StudioPage 卸载时 abort 当前页面队列的下载、解码和提交；
- 尚未保存成功的数据库任务保持或恢复为 `queued`；
- 不依赖 shutdown hook；
- 下次进入相关 session 后，ensure 和媒体组件重新发现任务；
- 已经原子写入正式文件但客户端未收到响应时，保存接口通过确定性路径识别已有合法 WebP，补齐数据库状态而不重复写文件。

这里的“持久化”指任务记录和成功结果可恢复，不代表应用启动后常驻后台执行。

## 5. 去重模型

### 5.1 数据库去重

继续使用当前唯一索引：

```text
(generation_id, media_index) UNIQUE
```

ensure、新生成入队和保存接口都使用幂等插入或更新。同一媒体最多存在一条任务记录。

### 5.2 页面运行期去重

页面级队列使用以下 key：

```text
<serverURL>:<studioDirectory>:<generationID>:<mediaIndex>
```

维护：

```ts
Map<string, Promise<string | undefined>>
```

结果卡片、文件管理、详情小图同时挂载同一媒体时复用同一个 Promise，不重复下载、解码、Canvas 编码或提交。

### 5.3 文件去重

正式路径保持确定性：

```text
.octo/<sessionID>/thumbnails/<generationID>-<mediaIndex>.webp
```

保存时先写随机临时文件，再原子 rename。正式文件已存在且通过轻量 WebP 校验时直接复用。

## 6. 图片无 `sharp` 处理流程

### 6.1 为什么需要本地 source 接口

供应商图片可以直接显示，不代表能够画入 Canvas 后导出。若供应商没有正确的 CORS 响应头，Canvas 会被污染，`toBlob()` 无法输出。

因此前端不能直接把供应商 URL 当作 Canvas 输入。新增一个只按 generation 和 media index 读取资源的本地同源接口：

```text
GET /studio/generations/:generationID/media/:mediaIndex/thumbnail-source
```

请求不携带任意外部 URL。sidecar 从已经持久化的 generation result 中读取 `remoteUrl ?? url`，避免把该接口变成任意 URL 代理。

接口行为：

1. 校验 generation 属于当前 Studio `Instance.directory` 且状态为 `succeeded`；
2. 校验 media index 存在并且目标是图片；
3. `data:image/...` 直接解码；
4. HTTPS URL 由 sidecar 下载；
5. 保留当前 30 秒超时、最多 5 次重定向、50 MiB 响应体限制和图片 MIME 校验；
6. 不做供应商域名、内网、私网或保留地址校验；
7. 使用原始图片 MIME 返回字节，并设置 `Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。

前端通过带认证和 directory header 的 `fetch` 获取 Blob，再创建本地 object URL。Canvas 读取的是本地 fetch 得到的 Blob，不受供应商 CORS 限制。

### 6.2 浏览器解码和缩放

优先使用：

```ts
createImageBitmap(blob, { imageOrientation: "from-image" })
```

不支持或解码失败时回退到：

```ts
const url = URL.createObjectURL(blob)
const image = new Image()
image.src = url
```

回退路径必须在完成后 `URL.revokeObjectURL(url)`。

解码得到实际方向修正后的宽高，再按既定算法计算目标尺寸：

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
```

不放大小图。250 × 250 输入仍输出 250 × 250，不会放大到315或512。

创建不插入 DOM 的 Canvas：

```ts
canvas.width = targetWidth
canvas.height = targetHeight
context.drawImage(source, 0, 0, targetWidth, targetHeight)
canvas.toBlob(callback, "image/webp", 0.8)
```

Canvas 设置完成后才进入编码；整个任务通过 `requestIdleCallback` 调度，所有图片和视频共用单并发队列。这里的“离屏”指 Canvas 不挂入可见 DOM，不强制要求使用 `OffscreenCanvas` API。

### 6.3 提交保存

新增统一保存接口：

```text
POST /studio/generations/:generationID/media/:mediaIndex/thumbnail
```

首期继续使用 JSON base64，避免引入新的 multipart/binary body 解析链：

```json
{
  "content": "<webp base64>"
}
```

由于提交内容已经是最大约 630 × 315 或315 × 315的 WebP，base64 额外体积可控。后续如真实数据表明 JSON 转换有明显内存成本，再单独改为 binary body。

## 7. 视频无 `sharp` 处理流程

视频前端流程沿用当前实现：

1. poster 未 ready 时始终显示原始 `<video>`；
2. 不插入 DOM 的 video seek 到 `min(1秒, duration × 10%)`；
3. 按同一尺寸公式画入 Canvas；
4. Canvas 直接编码为 `image/webp`、quality 0.8；
5. 提交给统一 thumbnail 保存接口；
6. 本地缩略图预加载成功后才把可见 `<video>` 替换为 `<img>`。

sidecar 不再用 `sharp` 对浏览器结果进行二次缩放或转码。原有 `/video-poster` 可以直接删除并迁移到统一接口；如果希望降低一次改动风险，也可以保留一版兼容 handler，但内部必须调用同一个无 `sharp` 保存函数，后续再删除。

视频跨域抽帧仍保持当前降级语义：供应商不允许 CORS、codec 不支持、seek 失败或超时时，继续显示原视频，不出现占位图，不影响 generation。首期不为视频 source endpoint 增加 Range 代理，因为正确支持视频 seek、Range、Content-Length 和中断转发会显著扩大改动范围。

## 8. sidecar 的轻量校验与落盘

移除 `sharp` 后，sidecar 不再验证解码结果，但仍需要拒绝明显错误或过大的提交。

### 8.1 WebP 字节校验

保存接口至少校验：

- base64 能正常解码；
- 字节数大于最小 WebP header；
- 字节数不超过10 MiB；
- bytes 0～3 为 `RIFF`；
- bytes 8～11 为 `WEBP`；
- RIFF 声明长度与实际内容没有明显矛盾；
- generation、media index 和当前 directory 匹配；
- generation 状态为 `succeeded`。

不需要在 sidecar 中解析像素，也不接受客户端指定目标文件路径。

### 8.2 原子保存

保存顺序：

```text
校验身份和 WebP 字节
  -> mkdir thumbnails
  -> 写 <target>.<uuid>.tmp
  -> 再读临时文件 header 和 size
  -> 删除已有 target（Windows rename 兼容）
  -> rename 临时文件为正式文件
  -> 更新 studio_generation.result
  -> 同步 completed tool output.media
  -> 发布 PartUpdated
  -> 更新 studio_media_thumbnail 为 succeeded
```

若正式文件已经存在且 header/size 合法，跳过重写，直接修复后续数据库和 message 状态。

### 8.3 失败状态

- source 下载失败：接口返回错误，浏览器队列记录日志并按当前页面生命周期有限重试；
- Canvas 解码或编码失败：只记录浏览器日志；
- 保存失败：服务端和浏览器都记录 generationID、mediaIndex 和错误；
- 页面内达到最大重试次数后，任务数据库仍保持 `queued`，下次进入 session 可以再次尝试；服务端能够观察到的 source/save 错误写入任务记录，纯浏览器 Canvas 错误只写前端日志；
- UI 继续使用原资源，不切换为占位图；
- generation 始终保持 `succeeded`。

## 9. 涉及文件及具体修改

### 9.1 `packages/opencode/src/studio/studio-media-thumbnail.ts`

这是后端改动最大的文件。

删除：

- `type SharpFactory`；
- `sharpFactory`；
- `loadSharp()`；
- 所有 `import("sharp")`；
- `MAX_INPUT_PIXELS`；
- `materializeThumbnail()` 中的服务端解码、orientation、resize 和 WebP 编码；
- `claimJob()`、`renewJobLease()`、`completeJob()`、`failJob()`、`tick()`；
- `workerTimers`、`activeDirectories`、`activeControllers`；
- `runStudioMediaThumbnailWorkerOnce()`；
- `startStudioMediaThumbnailWorker()`；
- Worker 的 interval、lease 续租和 disposer；
- `saveStudioVideoPoster()` 中基于 `sharp` 的 metadata、resize 和二次编码逻辑；
- 只用于服务端缩放的尺寸常量和 `studioThumbnailDimensions()`；尺寸算法移动到前端生成模块。

保留并调整：

- `mediaResult()`；
- `isVideo()`；
- `prepareStudioThumbnailMedia()`；
- `thumbnailPath()` 和 `absoluteThumbnailPath()`；
- `syncCompletedMessage()`；
- `updateMedia()`；
- `enqueueResult()` 和 `(generation_id, media_index)` 幂等插入；调整过滤条件，让缺少缩略图的图片和视频都写入账本，而不是继续跳过视频；
- `enqueueStudioMediaThumbnails()`，但末尾不再启动 Worker；
- `ensureStudioSessionThumbnails()`，但末尾不再启动 Worker；
- URL、redirect、MIME、响应体大小和超时校验；
- 私网和保留地址继续允许访问。

新增：

- `loadStudioThumbnailSource({ generationID, mediaIndex, signal })`：只允许按已持久化媒体身份读取原图字节，返回 `{ bytes, contentType }`；
- `studioThumbnailWebpAllowed(bytes)`：检查 RIFF/WEBP header 和声明长度；
- `validStoredThumbnail(file)`：使用 `stat` 和读取少量 header 校验已有文件，不解码；
- `saveStudioMediaThumbnail({ generationID, mediaIndex, content })`：统一保存图片缩略图和视频 poster；
- 进程内 `Map<key, Promise>`，仅用于合并同时到达的重复保存请求；
- 保存成功后把对应任务更新为 `succeeded`、写入 `thumbnail_path` 并清理旧 error/lease；
- 保存失败时更新最后错误，但不能修改 generation 成功状态；
- ensure 时把旧 `running` 任务恢复为 `queued`，并恢复以下旧实现错误：
  - `sharp is not a function`；
  - `Sharp module did not expose a callable factory...`；
  - `Could not load the "sharp" module using the ... runtime`；
- ensure 时将这些旧失败媒体重新规范化为 `thumbnailStatus: pending`。

注意：不能根据客户端传来的 URL 下载资源，source 必须从数据库中的 generation result 获取。

### 9.2 `packages/opencode/src/studio/studio-service.ts`

修改：

- 删除 `startStudioMediaThumbnailWorker` import；
- `startStudioGenerationWorker()` 末尾不再启动缩略图 Worker；
- generation 成功后的 `enqueueStudioMediaThumbnails(record.id)` 保留，它只写任务账本；
- generation 成功、消息写入和缩略图入账的顺序保持不变；
- 不在应用启动、Instance 初始化或 generation Worker 启动时扫描历史缩略图任务。

### 9.3 `packages/opencode/src/studio/studio-media-thumbnail.sql.ts`

当前文件保留，不删除表，也不做破坏性 schema 迁移。

说明性调整：

- status 类型暂时保留 `queued | running | succeeded | failed`，兼容已经创建的数据库；
- 新实现主要写 `queued | succeeded`；
- `running` 是旧 Worker 遗留兼容状态，ensure 时恢复为 `queued`；
- `failed` 是旧版本或未来诊断状态，不作为 UI 是否显示原资源的依据；
- 唯一索引继续负责持久层去重。

如果代码不需要注释变更，该文件可以不产生实际 diff。

### 9.4 `packages/opencode/migration/20260921160000_studio_media_thumbnail/migration.sql`

不修改。

原因：迁移可能已经在实际环境执行，删除或重写历史迁移会造成不同安装环境 schema 不一致。现有表仍用于任务去重、成功状态和崩溃恢复。

### 9.5 `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

路径增加：

```ts
generationThumbnailSource:
  "/studio/generations/:generationID/media/:mediaIndex/thumbnail-source"

generationThumbnail:
  "/studio/generations/:generationID/media/:mediaIndex/thumbnail"
```

API 增加：

- GET source endpoint；
- POST thumbnail endpoint，payload 为 `{ content: Schema.String }`；
- 保存响应保持 `{ thumbnailUrl: Schema.String }`；
- mediaIndex 使用 path param 后必须转成整数并校验非负；
- source endpoint 使用 raw response 返回图片字节；
- OpenAPI 描述明确 source 只读取 generation 已持久化的媒体，不接受 URL。

处理旧 `/video-poster`：

- 推荐删除对应 path 和 endpoint；
- 若为降低一次改动风险暂时保留，标注 deprecated，并转发到统一保存函数；
- 当前前端迁移完成后不能再依赖旧接口。

### 9.6 `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

新增 source raw handler：

- 从 path params 取得 generationID/mediaIndex；
- 在 `Instance.restore` 中调用 `loadStudioThumbnailSource()`；
- 返回 `HttpServerResponse.raw(bytes, { contentType, headers })`；
- 客户端断开时应尽量把 abort signal 传递给下载；
- 错误转换成现有 `ApiStudioGenerationError`，日志不得输出完整 data URL。

新增统一 save handler：

- 调用 `saveStudioMediaThumbnail()`；
- 不等待任何后续 Worker；
- 不改变 generation status；
- 返回持久化的相对 `thumbnailUrl`。

删除或兼容转发原 `saveVideoPoster` handler。

### 9.7 `packages/opencode/package.json`

修改：

- 删除 `sharp: "0.33.5"` 直接依赖；
- 不新增其他 native 图片库；
- 不新增系统工具、ImageMagick、ffmpeg 或 Python 依赖。

注意：仓库其他工具的传递依赖可能仍让 lockfile 中出现 `sharp`，验收标准不是全文搜索 lockfile 为零，而是 opencode Studio sidecar 代码不再 import/require `sharp`。

### 9.8 `bun.lock`

通过仓库正常的 `bun install` 更新，禁止手工编辑。

预期：

- `packages/opencode` importer 不再直接声明 `sharp`；
- 其他包需要的 `sharp` 或 `@img/sharp-*` 条目可以继续存在；
- 桌面 sidecar 最终产物中不应再包含 Studio 对 `sharp` 的调用链。

### 9.9 新增 `packages/app/octoapp/pages/studio/studio-thumbnail-generation.ts`

把媒体生成任务从 UI 组件中拆出，避免继续扩大 `studio-media-thumbnail.tsx`。

该文件实现：

- 尺寸常量和 `studioThumbnailDimensions()`；
- `TARGET_DPR = 1.5`；
- `requestIdleCallback` fallback；
- 图片 Blob 解码；
- image bitmap / object URL 的释放；
- Canvas WebP 编码；
- 视频 metadata、seek、抽帧和清理；
- 带认证、directory header 的 source fetch；
- 统一 thumbnail POST；
- 全局单并发执行链；
- 按 server/directory/generation/index 的 Promise 去重 Map；
- 成功结果 Map；
- 每项有限重试和退避；
- `AbortController` 管理；
- `stopStudioThumbnailQueue(scope)`，供 StudioPage 卸载时停止尚未完成的任务；
- 结构化日志：queued、started、source loaded、encoded、saved、retry、aborted、failed。

建议导出：

```ts
studioThumbnailDimensions(width, height)
queueStudioImageThumbnail(input)
queueStudioVideoThumbnail(input)
stopStudioThumbnailQueue(scope)
```

队列任务开始前和每个异步阶段后都检查 signal，保证切出 Studio 后不会继续启动新的重任务。

### 9.10 `packages/app/octoapp/pages/studio/studio-media-thumbnail.tsx`

删除：

- 当前文件内的 `videoPosterTasks`、`videoPosterResults` 和串行 Promise；
- `videoPosterIdle()`；
- `queueVideoPoster()`；
- `videoFrameContent()`；
- `videoPosterContent()`；
- 直接调用旧 `/video-poster` 的 fetch；
- 组件内重复实现的 auth/header/base64 代码。

改为：

- 从 `studio-thumbnail-generation.ts` 调用图片或视频任务；
- 图片在 `thumbnailStatus !== ready` 时继续使用 `originalMediaSrc()`；
- 图片组件挂载且 generationID/mediaIndex 有效时，后台调用 `queueStudioImageThumbnail()`；
- 视频继续先显示原 `<video>`，就绪事件触发 `queueStudioVideoThumbnail()`；
- Promise 返回本地缩略图 URL 后，先用 `new Image()` 预加载；
- 预加载完成后更新组件本地 signal，实现无闪烁替换；
- 任务 pending、abort 或 failed 时不设置 `failed`，继续显示原资源；
- 只有原资源自身也加载失败时才进入现有最终占位 fallback；
- 保留 `loading="lazy"`、`decoding="async"`、拖拽原始 URL 和 video badge。

图片与视频必须走同一个单并发队列，不能各自同时跑一个任务。

### 9.11 `packages/app/octoapp/pages/studio-page.tsx`

保留当前“打开 session 后调用一次 ensure”的 effect，并修改生命周期清理：

- sessionID 变化时允许新 session 触发 ensure；
- ensure 成功只表示任务记录已准备好，不表示生成完成；
- 页面卸载或切出 Studio 时调用 `stopStudioThumbnailQueue()`；
- 停止内存任务不能把媒体改成 failed；
- 不在应用启动时扫描全部 session；
- 不在左侧历史列表仅加载 session 元数据时生成缩略图；
- 只有打开具体 session、媒体组件挂载后才消费任务。

当前 `ensuredThumbnailSessions` 可以继续防止同一 StudioPage 生命周期内重复 ensure；跨页面重新进入时再次调用幂等 ensure是允许的。

### 9.12 `packages/app/octoapp/pages/studio/studio-media.ts`

原则不变，只检查并保持：

- ready 且本地 thumbnail path 合法时返回缩略图；
- pending/failed 图片返回原图；
- pending/failed 视频返回 `undefined`，让组件显示原 `<video>`；
- artifact serve URL 使用 config-mode Studio 全局会话根；
- 不把远程 URL 当成本地缩略图。

如果当前实现已经满足，不需要实际修改。

### 9.13 `packages/app/octoapp/pages/studio/types.ts`

当前 `thumbnailUrl` 和 `thumbnailStatus` 类型可以继续使用，无需增加字段。

如果当前类型已经是：

```ts
thumbnailUrl?: string
thumbnailStatus?: "pending" | "ready" | "failed"
```

则不产生实际 diff。

### 9.14 `packages/app/octoapp/pages/studio/studio-conversation.tsx`

继续向 `StudioMediaThumbnail` 传递稳定的：

- `generationID`；
- `mediaIndex`；
- 原始 `StudioImage`。

检查右侧主画布、全屏和编辑链仍调用 `originalMediaSrc()`，不能因为新队列返回 thumbnail URL 而使用缩略图。

若当前调用已经完整，不需要实际修改。

### 9.15 `packages/app/octoapp/pages/studio/studio-file-manager.tsx`

继续向缩略图组件传递 generationID/mediaIndex。多个区域渲染同一媒体时，由新生成模块的 Promise Map 去重。

保持视频容器居中样式和 badge，不为 pending 状态增加占位图。

若当前调用已经完整，不需要实际修改。

### 9.16 `packages/app/octoapp/pages/studio/session-thumbnail.ts`

保持当前策略：

- ready 时优先本地 thumbnail；
- pending/failed 时图片使用原图；
- 视频 poster 未 ready 时保存原视频 fallback 信息；
- PartUpdated 到来后刷新为本地 thumbnail。

该文件不负责创建 Canvas 任务，避免仅渲染左侧历史列表就处理所有历史 session。

若当前实现已经满足，不需要实际修改。

### 9.17 `packages/app/octoapp/pages/studio/studio-history.tsx`

保持左侧列表只消费 session thumbnail store：

- 不直接加入图片/视频生成队列；
- 不因 pending 显示缩略图占位；
- 当前打开 session 生成成功后，通过 store/消息更新切换本地缩略图。

若当前实现已经满足，不需要实际修改。

### 9.18 `packages/app/octoapp/pages/studio/studio-03.css`

无架构性修改。

只回归确认：

- `.studio-result-thumb-video` 居中仍有效；
- 图片和视频原资源与缩略图使用相同包围盒；
- pending 不新增占位样式；
- 替换时不改变布局尺寸。

### 9.19 `packages/opencode/src/session/session.ts`

当前删除 session 时已经清理：

```text
.octo/<sessionID>/thumbnails
```

保持不变。数据库任务通过外键级联删除，无需增加新的清理逻辑。

### 9.20 `packages/opencode/test/studio/studio-media-thumbnail.test.ts`

删除或重写依赖 sidecar Worker/`sharp` 的测试：

- Worker claim；
- lease 续租；
- `runStudioMediaThumbnailWorkerOnce()`；
- 服务端图片 resize/metadata；
- `sharp` 错误路径。

保留：

- 尺寸之外的媒体规范化；
- 幂等任务入账；
- generation succeeded 不受缩略图失败影响；
- completed message media 同步；
- 视频和图片使用确定性本地路径。

新增：

- source 只能通过 generationID/mediaIndex 读取对应原图；
- data URL source 解码；
- HTTPS、redirect、MIME、响应体大小校验；
- 私网/本机 URL 不被地址规则拒绝；
- WebP RIFF header 校验；
- 空内容、伪造内容和超大内容拒绝；
- 图片和视频统一保存；
- 重复提交返回同一个 thumbnailUrl；
- 已有合法文件补齐数据库状态；
- 旧 `running` 和三类 `sharp` 失败任务在 ensure 时恢复；
- 保存失败不改变 generation succeeded；
- 不存在任何自动 Worker timer。

### 9.21 新增 `packages/app/octoapp/pages/studio/studio-thumbnail-generation.test.ts`

测试可从生成模块抽出的纯逻辑：

- 250 × 250 不放大；
- 300 × 500 输出189 × 315；
- 600 × 300 保持600 × 300；
- 1920 × 1080 输出560 × 315；
- 4096 × 4096 输出315 × 315；
- 非法宽高拒绝；
- key 包含 server、directory、generationID、mediaIndex；
- 同 key 返回同一 Promise；
- 不同组件不会重复提交；
- 单并发顺序；
- abort 后尚未开始的任务不执行；
- WebP blob 转 base64 不包含 data URL 前缀。

DOM Canvas、Image、video 行为不复制浏览器实现到单元测试中；关键流程通过浏览器环境集成验证。

### 9.22 `packages/app/octoapp/pages/studio/studio-media.test.ts`

保持并补充：

- pending 图片使用原图；
- failed 图片使用原图；
- ready 本地路径使用 artifact serve URL；
- 远程 thumbnailUrl 不被信任为已物化缩略图；
- pending 视频交给原 `<video>` fallback。

### 9.23 `packages/app/octoapp/pages/studio/session-thumbnail.test.ts`

保持并补充：

- 左侧历史列表本身不触发生成任务；
- 当前 session pending 时继续展示原媒体；
- PartUpdated 后切换到本地 thumbnail；
- 视频 poster 失败仍保留原视频 fallback。

### 9.24 `packages/opencode/script/build-node.ts`

无需增加 `sharp` external，也无需复制 native binary。

实现完成后只需确认构建产物中已经没有 Studio 的 `sharp` import/require。不要为已经移除的依赖增加打包特例。

### 9.25 `packages/desktop/electron.vite.config.ts`

无需增加 `sharp` externalize 配置。

### 9.26 `packages/desktop/electron-builder.config.ts`

无需增加 `asarUnpack`、`extraResources` 或 `@img/sharp-*` 平台文件。

这三个构建文件“不修改”是本方案的重要结果：无 `sharp` 方案不把 native addon 打包复杂度转移到 Desktop。

## 10. 实施顺序

### 阶段一：先解除运行时依赖

1. 新增前端 `studio-thumbnail-generation.ts` 和尺寸测试；
2. 后端增加统一保存函数，使用轻量 WebP header 校验；
3. 视频切换到统一保存函数，确认不再调用 `sharp`；
4. 增加图片 source 和 save endpoints；
5. 图片组件接入浏览器 Canvas 队列；
6. 保证原图到缩略图平滑替换。

### 阶段二：移除旧 Worker

1. 删除 sidecar 图片 materialize 流程；
2. 删除 timer、claim、lease 和自动恢复执行；
3. 删除 service 启动 Worker 的调用；
4. ensure 改成只准备账本和媒体状态；
5. 增加 StudioPage 页面卸载队列清理。

### 阶段三：依赖和兼容清理

1. 删除 `packages/opencode/package.json` 的 `sharp`；
2. 正常更新 `bun.lock`；
3. 重写后端测试；
4. 恢复实际环境中旧 `sharp` 失败任务；
5. 检查 sidecar 构建产物没有 Studio sharp 调用；
6. Windows x64 实机运行 `bun run dev:beta` 验证。

## 11. 验收标准

### 11.1 生命周期

- 启动应用但不进入 Studio，不打印缩略图任务日志；
- 进入 Studio但不打开旧 session，不批量处理所有历史 session；
- 打开具体旧 session 后才打印 ensure 和 queue 日志；
- 切出 Studio 后不再启动新的下载、解码或 Canvas 任务；
- 重新进入该 session 后未完成任务继续；
- 不创建重复数据库记录，不生成重复正式文件。

### 11.2 显示体验

- pending 时图片立即显示原图；
- pending 时视频立即显示原视频；
- 排队很多时不出现图片或视频图标占位；
- 缩略图预加载成功后才替换原资源；
- 失败时继续显示原资源；
- 右侧主画布、全屏、下载和编辑始终使用原资源；
- `.studio-result-thumb-video` 内视频和 poster 居中。

### 11.3 依赖与构建

- `packages/opencode` 不再直接依赖 `sharp`；
- Studio 后端源码不再 import/require `sharp`；
- opencode Node build 成功；
- desktop beta build 成功；
- Windows x64 的 `bun run dev:beta` 不再出现：

```text
sharp is not a function
Sharp module did not expose a callable factory
Could not load the "sharp" module using the win32-x64 runtime
```

### 11.4 日志

成功链路至少包含：

```text
[studio.thumbnail] session backfill checked
[studio.thumbnail] image queued
[studio.thumbnail] image source loaded
[studio.thumbnail] image encoded
[studio.thumbnail] thumbnail write started
[studio.thumbnail] thumbnail write succeeded
```

失败日志包含：

- kind；
- generationID；
- mediaIndex；
- 当前阶段；
- 是否会在当前页面重试；
- error message；
- 成功落盘时的绝对路径。

日志不能输出完整 base64 或带敏感参数的完整供应商 URL。

## 12. 验证命令

按仓库约定从各 package 目录运行，不能从仓库根目录运行测试。

```bash
cd packages/opencode
bun test test/studio/studio-media-thumbnail.test.ts
bun typecheck
bun script/build-node.ts

cd packages/app
bun test octoapp/pages/studio/studio-thumbnail-generation.test.ts
bun test octoapp/pages/studio/studio-media.test.ts
bun test octoapp/pages/studio/session-thumbnail.test.ts
bun typecheck

cd packages/desktop
bun run build:beta
```

最后在 Windows x64 实际环境中：

```bash
cd packages/desktop
bun run dev:beta
```

验证新生成图片、旧 session 大量图片、视频 poster、快速切换 session、切出 Studio、关闭后重新进入，以及同一媒体同时出现在结果卡片/文件管理/详情区的去重行为。

## 13. 明确不做的内容

本轮不实现：

- 应用启动后全局扫描所有 Studio session；
- Studio 关闭后继续常驻后台生成；
- ffmpeg、ImageMagick、系统 `sips` 或 Python 图片处理；
- Electron `nativeImage` 主进程处理链；
- `sharp` native binary 的 external、copy 或 asar unpack；
- 供应商 URL 失效恢复；
- 供应商域名白名单；
- 私网、loopback、link-local、保留地址拦截；
- 视频 Range source proxy；
- 多尺寸缩略图；
- 历史列表未打开 session 的预生成。

## 14. 最终结果

改造完成后，Studio 缩略图能力只依赖桌面端已经具备的 Chromium 图片/视频解码和 Canvas WebP 编码，不再依赖任何新增 native 图片库。

任务只在用户进入 Studio并打开具体 session 后执行；任务记录、成功文件和媒体状态持久化，但执行器不常驻。缩略图优化失败或被中断时，用户始终可以继续看到并使用原始媒体。
