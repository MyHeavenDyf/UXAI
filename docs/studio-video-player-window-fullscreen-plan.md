# Studio 视频播放器窗口内全屏实现方案

## 目标

替换 Studio 画布中 `<video controls>` 提供的浏览器原生控制栏，实现一个 Studio 自有视频播放器。

全屏的产品定义是：

- 视频铺满当前 Electron 应用窗口的内容区域。
- 不调用 `BrowserWindow.setFullScreen()`，不进入操作系统全屏。
- 不依赖 Chromium 原生视频全屏按钮。
- Electron 标题栏、菜单栏和系统任务栏是否显示，保持应用窗口当前状态。
- 进入和退出全屏时不重置播放进度、音量、缓冲和暂停状态。

Web 版本使用相同播放器行为，窗口内全屏覆盖当前浏览器页面视口。

## 当前问题

当前实现位于：

- `packages/app/octoapp/pages/studio/studio-conversation.tsx`
- `packages/app/octoapp/pages/studio/studio-03.css`

`StudioMediaPreview` 对视频直接渲染：

```tsx
<video
  src={props.image.remoteUrl ?? props.image.url}
  class={props.class}
  controls={props.controls}
  muted={!props.controls}
  playsinline
  preload="metadata"
/>
```

原生 `controls` 的控制栏属于 Chromium 内部 Shadow DOM：

- 无法可靠修改全屏按钮的行为。
- 原生全屏走 HTML Fullscreen API，不等同于产品要求的应用窗口内覆盖。
- Electron、Chromium 和操作系统之间的行为存在差异。
- 无法在业务层统一处理全屏状态、退出按钮和异常反馈。

因此不继续修补原生全屏按钮，改为保留 `<video>` 负责媒体解码和播放，控制栏及全屏行为由 Studio 接管。

## 核心设计

新增 `StudioVideoPlayer` 组件，负责：

- 播放和暂停。
- 当前时间和总时长。
- 进度拖动。
- 音量和静音。
- 窗口内全屏。
- `Escape` 退出全屏。
- 双击视频切换全屏。
- 视频加载、错误和播放结束状态。

播放器底层仍使用一个原生 `<video>`，但不设置 `controls`。

### 为什么只保留一个 video

不建议普通模式渲染一个 `<video>`，全屏 Portal 再渲染另一个 `<video>`。两个实例需要同步：

- `currentTime`
- `paused`
- `volume`
- `muted`
- `playbackRate`
- buffered 数据

切换时还可能重新请求视频、黑屏或丢失播放状态。

推荐让播放器根节点始终通过 Solid `Portal` 挂载到 `document.body`：

- 普通模式：播放器覆盖画布中的占位节点。
- 全屏模式：播放器使用 `position: fixed; inset: 0` 覆盖整个应用内容区。
- 两种模式使用同一个 `<video>` DOM 节点。

## 文件拆分

新增：

```text
packages/app/octoapp/pages/studio/studio-video-player.tsx
packages/app/octoapp/pages/studio/studio-video-player.test.ts
```

修改：

```text
packages/app/octoapp/pages/studio/studio-conversation.tsx
packages/app/octoapp/pages/studio/studio-03.css
```

不需要修改：

```text
packages/desktop/src/main/windows.ts
packages/desktop/src/preload/*
packages/desktop/src/main/ipc.ts
```

该方案不需要 Electron IPC，也不需要 `webviewTag`。

## 组件接口

```ts
export function StudioVideoPlayer(props: {
  src: string
  poster?: string
  class?: string
  onError?: (error: MediaError | null) => void
}): JSX.Element
```

`StudioMediaPreview` 保留图片和视频分流：

```tsx
<Show
  when={isVideoMedia(props.image)}
  fallback={<img src={props.image.thumbnailUrl ?? props.image.url} class={props.class} alt="" />}
>
  <StudioVideoPlayer
    src={props.image.remoteUrl ?? props.image.url}
    poster={props.image.thumbnailUrl}
    class={props.class}
  />
</Show>
```

结果卡片和详情缩略图不需要完整控制栏，继续使用静音 `<video>` 或增加 `interactive` 参数区分：

```ts
type StudioMediaPreviewProps = {
  image: StudioImage
  class?: string
  interactive?: boolean
}
```

只有 `studio-canvas-image` 使用完整播放器。

## DOM 结构

画布中保留一个占位节点：

```tsx
<div class="studio-video-player-anchor" ref={anchorRef} />
```

播放器通过 Portal 渲染到 `body`：

```tsx
<Portal mount={document.body}>
  <div
    class="studio-video-player"
    classList={{ fullscreen: fullscreen() }}
    style={playerPosition()}
  >
    <video ref={videoRef} src={props.src} playsinline preload="metadata" />
    <div class="studio-video-player-controls">
      ...
    </div>
  </div>
</Portal>
```

普通模式下，读取 anchor 的视口位置：

```ts
const rect = anchorRef.getBoundingClientRect()

{
  top: `${rect.top}px`,
  left: `${rect.left}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
}
```

全屏模式不设置上述坐标，由 CSS 使用 `inset: 0`。

## 定位同步

普通模式播放器需要在以下场景重新测量 anchor：

- 初次挂载。
- Electron 窗口大小变化。
- Studio 左侧栏拖动。
- 右侧详情面板显示或隐藏。
- 页面滚动。
- 画布标签切换。

使用 `ResizeObserver` 监听 anchor 尺寸，使用捕获阶段的 `scroll` 监听处理祖先滚动：

```ts
const observer = new ResizeObserver(updatePosition)
observer.observe(anchorRef)

window.addEventListener("resize", updatePosition)
document.addEventListener("scroll", updatePosition, true)
```

为避免滚动期间高频写入状态，`updatePosition` 使用 `requestAnimationFrame` 合并。

组件卸载时移除监听并取消尚未执行的 animation frame。

## 播放状态

播放器状态建议使用 Solid signal：

```ts
const [playing, setPlaying] = createSignal(false)
const [currentTime, setCurrentTime] = createSignal(0)
const [duration, setDuration] = createSignal(0)
const [volume, setVolume] = createSignal(1)
const [muted, setMuted] = createSignal(false)
const [fullscreen, setFullscreen] = createSignal(false)
const [controlsVisible, setControlsVisible] = createSignal(true)
const [error, setError] = createSignal<string>()
```

播放状态以 `<video>` 事件为准，不在点击按钮后直接假设播放成功：

```tsx
<video
  onPlay={() => setPlaying(true)}
  onPause={() => setPlaying(false)}
  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
  onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
  onVolumeChange={(event) => {
    setVolume(event.currentTarget.volume)
    setMuted(event.currentTarget.muted)
  }}
  onEnded={() => setPlaying(false)}
  onError={(event) => setError(mediaErrorMessage(event.currentTarget.error))}
/>
```

播放按钮：

```ts
function togglePlayback() {
  if (!videoRef.paused) {
    videoRef.pause()
    return
  }
  void videoRef.play().catch(() => {
    setError("视频播放失败，请重试")
  })
}
```

## 进度控制

使用 `input[type="range"]`，不要自行通过鼠标坐标模拟滑块：

```tsx
<input
  type="range"
  min="0"
  max={duration()}
  step="0.01"
  value={currentTime()}
  onInput={(event) => {
    videoRef.currentTime = Number(event.currentTarget.value)
  }}
/>
```

时间格式：

```ts
function formatMediaTime(value: number) {
  if (!Number.isFinite(value)) return "00:00"
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
```

首期不需要实现已缓冲区间的独立视觉轨道。

## 音量控制

提供：

- 静音按钮。
- 音量滑块。
- 音量设为 `0` 时同步 muted 视觉状态。
- 取消静音时恢复最近一次大于 `0` 的音量。

音量只保存在当前播放器生命周期内，首期不写全局持久化。

## 窗口内全屏

点击自定义全屏按钮：

```ts
function toggleFullscreen() {
  setFullscreen((value) => !value)
}
```

全屏时：

- 播放器根节点使用 `position: fixed`。
- `inset: 0`。
- 使用高于 Dialog、Dropdown 和 Toast 的层级。
- 背景为黑色。
- 视频 `width: 100%; height: 100%; object-fit: contain`。
- 控制栏固定在播放器底部。
- 隐藏 Studio 页面其他内容，但不卸载。
- 锁定 `document.body` 滚动。

进入前记录 body 原有样式，退出或组件卸载时恢复：

```ts
createEffect(() => {
  if (!fullscreen()) return
  const overflow = document.body.style.overflow
  document.body.style.overflow = "hidden"
  onCleanup(() => {
    document.body.style.overflow = overflow
  })
})
```

不能直接在清理时固定赋值为空字符串，否则可能覆盖应用其他功能设置的内联样式。

### Escape 退出

只在全屏时注册：

```ts
createEffect(() => {
  if (!fullscreen()) return
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    setFullscreen(false)
  }
  document.addEventListener("keydown", onKeyDown)
  onCleanup(() => document.removeEventListener("keydown", onKeyDown))
})
```

### 双击切换

视频区域绑定：

```tsx
onDblClick={toggleFullscreen}
```

控制栏按钮需要阻止双击冒泡，避免用户双击控制按钮时误切换全屏。

## 控制栏显示规则

普通模式：

- 鼠标进入播放器时显示。
- 鼠标离开时保持一段时间后隐藏。
- 暂停状态始终显示。

全屏模式：

- 鼠标移动时显示。
- 正在播放且若干秒无操作后隐藏。
- 控制栏隐藏时同时隐藏鼠标光标。
- 暂停、结束或发生错误时保持显示。

建议延迟为 2500ms，计时器必须在组件卸载时清理。

键盘焦点位于控制栏内时不能自动隐藏控制栏。

## 样式设计

新增语义类：

```css
.studio-video-player-anchor {}
.studio-video-player {}
.studio-video-player.fullscreen {}
.studio-video-player-media {}
.studio-video-player-controls {}
.studio-video-player-progress {}
.studio-video-player-button {}
.studio-video-player-volume {}
.studio-video-player-time {}
.studio-video-player-error {}
```

核心规则：

```css
.studio-video-player {
  position: fixed;
  z-index: 20;
  overflow: hidden;
  border-radius: 6px;
  background: #000;
}

.studio-video-player.fullscreen {
  inset: 0;
  z-index: 1000;
  width: auto;
  height: auto;
  border-radius: 0;
}

.studio-video-player-media {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.studio-video-player-controls {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
}
```

普通模式下播放器的位置由 JSX 中的动态 `top/left/width/height` 设置。其他颜色、尺寸和布局仍统一放 CSS。

不要给播放器祖先添加 `transform`，否则可能改变 fixed 定位参照。Portal 到 `document.body` 可以避免 Studio 布局容器中的 transform 和 overflow 裁切。

## 图标

优先使用现有 `@opencode-ai/ui/icon` 支持的图标。如果没有播放、音量和全屏图标，则在组件内使用简单 SVG：

- SVG 使用 `currentColor`。
- 不新增字体图标。
- 不使用文本字符模拟三角形或音量图标。
- 图标组件保持在 `studio-video-player.tsx` 内，暂不抽成公共 UI。

## 媒体源切换

Studio 切换画布标签时，`src` 会变化。

处理规则：

- 退出全屏。
- 新视频从 `0` 开始。
- 清理上一个视频的错误和时长状态。
- 不自动播放新视频。

```ts
createEffect(
  on(
    () => props.src,
    () => {
      setFullscreen(false)
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      setError()
      videoRef?.load()
    },
    { defer: true },
  ),
)
```

## 异常处理

至少覆盖：

- 视频 URL 无法访问。
- Electron 网络请求失败。
- 视频编码不受 Chromium 支持。
- `play()` 因用户手势策略失败。
- duration 为 `Infinity` 或 `NaN`。
- 视频组件在全屏时被卸载。

错误状态显示在视频中央，并保留退出全屏按钮：

```text
视频加载失败，请重试或下载后查看
```

不要让错误遮罩阻挡退出全屏操作。

## 可访问性

- 所有按钮使用原生 `<button type="button">`。
- 提供动态 `aria-label`，例如“播放”“暂停”“进入全屏”“退出全屏”。
- 进度条提供 `aria-label="视频进度"`。
- 音量条提供 `aria-label="音量"`。
- 按钮支持 `:focus-visible`。
- `Space` 在焦点位于播放器画面时切换播放。
- `Escape` 只在全屏时消费。
- 不覆盖用户在 input/range 上的方向键行为。

## 与现有代码的集成

### studio-conversation.tsx

调整 `StudioMediaPreview`：

- 图片继续使用 `<img>`。
- 非交互视频缩略图继续使用无 controls 的 `<video muted>`。
- 画布视频改用 `StudioVideoPlayer`。

`StudioResultCanvas` 中：

```tsx
<div class="studio-canvas-stage">
  <Show
    when={isVideoMedia(image())}
    fallback={<StudioMediaPreview image={image()} class="studio-canvas-image" />}
  >
    <StudioVideoPlayer
      src={image().remoteUrl ?? image().url}
      poster={image().thumbnailUrl}
      class="studio-canvas-image"
    />
  </Show>
</div>
```

### studio-03.css

- 保留 `.studio-canvas-stage` 作为播放器 anchor 的布局区域。
- 将视频尺寸约束迁移到 `.studio-video-player-anchor`。
- 新增播放器和全屏控制栏样式。
- 图片继续使用 `.studio-canvas-image` 的现有阴影和圆角。

## Electron 权限

窗口内 Portal 全屏不调用 Fullscreen API，因此不依赖 Electron 的 `fullscreen` permission。

现有 Electron `fullscreen` 权限白名单可以保留，以免应用其他页面使用标准 Fullscreen API 时被拒绝，但 Studio 自定义播放器不依赖它。

不启用：

```ts
webviewTag: true
```

不新增：

```ts
BrowserWindow.setFullScreen(true)
```

## 测试方案

### 单元测试

为可独立测试的纯函数补测试：

- 时间格式化。
- duration 为 `NaN`、`Infinity` 时的处理。
- 音量恢复值计算。
- 播放器坐标转换。

DOM 媒体播放能力不在 happy-dom 中模拟，不为 `HTMLMediaElement.play()` 编写脆弱 mock 测试。

### 浏览器交互测试

使用本地 mock 视频验证：

1. 视频可以播放和暂停。
2. 进度条可拖动。
3. 音量与静音可切换。
4. 点击全屏后播放器覆盖 Electron 内容区。
5. Electron 窗口本身不进入系统全屏。
6. `Escape` 能退出。
7. 双击视频进入和退出全屏。
8. 全屏前后播放进度不变。
9. 全屏播放中切换 Studio tab 时安全退出并加载新视频。
10. 全屏时关闭 Studio 页面不会遗留 body 滚动锁。
11. 调整左侧栏宽度后普通播放器仍与画布对齐。
12. 最大化、还原和缩放 Electron 窗口后位置正确。

### 回归验证

- 图片画布展示不变。
- 视频结果卡缩略图不出现完整控制栏。
- 详情面板视频缩略图不抢占键盘焦点。
- 下载按钮行为不变。
- Studio 风险弹窗、菜单和 Toast 层级不受普通模式播放器影响。

## 实施顺序

1. 新增 `StudioVideoPlayer`，完成播放、暂停、进度和音量。
2. 在 Studio 画布接入，先不实现全屏。
3. 增加 anchor 测量和 Portal 普通模式定位。
4. 增加全屏状态、`Escape`、双击和 body 滚动锁。
5. 增加控制栏自动隐藏。
6. 补错误状态和可访问性。
7. 执行 `bun typecheck`，目录为 `packages/app`。
8. 执行 `bun run build`，目录为 `packages/app`。
9. 启动 Electron，完成窗口缩放和全屏交互验证。

## 验收标准

- Studio 画布不再展示 Chromium 原生视频控制栏。
- 播放器控制栏中的全屏按钮始终可用。
- 全屏后视频覆盖 Electron 当前窗口内容区域。
- Electron BrowserWindow 不进入系统全屏状态。
- 全屏前后使用同一个视频实例，播放进度、音量和缓冲不丢失。
- `Escape`、双击和退出按钮都能退出全屏。
- 页面切换或组件卸载不会遗留 Portal、事件监听、计时器或 body 样式。
- 图片展示、视频缩略图和下载功能无回归。
