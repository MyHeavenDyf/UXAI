import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"

const CONTROL_HIDE_DELAY_MS = 2500

export function formatStudioMediaTime(value: number) {
  if (!Number.isFinite(value)) return "00:00"
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export function StudioVideoPlayer(props: {
  src: string
  poster?: string
  class?: string
}): JSX.Element {
  const [playing, setPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(1)
  const [muted, setMuted] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [controlsVisible, setControlsVisible] = createSignal(true)
  const [focused, setFocused] = createSignal(false)
  const [error, setError] = createSignal("")
  const [position, setPosition] = createSignal({ top: 0, left: 0, width: 0, height: 0, visible: false })
  const [mediaRatio, setMediaRatio] = createSignal(16 / 9)
  let anchorRef!: HTMLDivElement
  let videoRef!: HTMLVideoElement
  let positionFrame = 0
  let controlsTimer: ReturnType<typeof setTimeout> | undefined

  function updatePosition() {
    cancelAnimationFrame(positionFrame)
    positionFrame = requestAnimationFrame(() => {
      if (!anchorRef) return
      const parent = anchorRef.parentElement
      if (!parent) return
      const style = getComputedStyle(parent)
      const availableWidth = Math.max(0, parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
      const availableHeight = Math.max(0, parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))
      const maxWidth = Math.min(520, availableWidth)
      const maxHeight = Math.min(420, availableHeight)
      const width = maxWidth / maxHeight > mediaRatio() ? maxHeight * mediaRatio() : maxWidth
      const height = width / mediaRatio()
      anchorRef.style.width = `${width}px`
      anchorRef.style.height = `${height}px`
      const rect = anchorRef.getBoundingClientRect()
      setPosition({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      })
    })
  }

  function clearControlsTimer() {
    if (!controlsTimer) return
    clearTimeout(controlsTimer)
    controlsTimer = undefined
  }

  function scheduleControlsHide() {
    clearControlsTimer()
    setControlsVisible(true)
    if (!fullscreen() || !playing() || focused()) return
    controlsTimer = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY_MS)
  }

  function togglePlayback() {
    if (!videoRef.paused) {
      videoRef.pause()
      return
    }
    setError("")
    void videoRef.play().catch(() => setError("视频播放失败，请重试"))
  }

  function toggleMuted() {
    if (videoRef.muted || videoRef.volume === 0) {
      videoRef.muted = false
      videoRef.volume = volume() > 0 ? volume() : 1
      return
    }
    videoRef.muted = true
  }

  function toggleFullscreen() {
    setFullscreen((value) => !value)
    setControlsVisible(true)
  }

  onMount(() => {
    const observer = new ResizeObserver(updatePosition)
    observer.observe(anchorRef)
    if (anchorRef.parentElement) observer.observe(anchorRef.parentElement)
    window.addEventListener("resize", updatePosition)
    document.addEventListener("scroll", updatePosition, true)
    updatePosition()
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
      document.removeEventListener("scroll", updatePosition, true)
      cancelAnimationFrame(positionFrame)
      clearControlsTimer()
    })
  })

  createEffect(on(mediaRatio, updatePosition, { defer: true }))

  createEffect(
    on(
      () => props.src,
      () => {
        setFullscreen(false)
        setPlaying(false)
        setCurrentTime(0)
        setDuration(0)
        setError("")
        if (videoRef) videoRef.load()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!fullscreen()) {
      clearControlsTimer()
      setControlsVisible(true)
      queueMicrotask(updatePosition)
      return
    }
    const overflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setFullscreen(false)
    }
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKeyDown)
    scheduleControlsHide()
    onCleanup(() => {
      document.body.style.overflow = overflow
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  return (
    <>
      <div ref={anchorRef!} class="studio-video-player-anchor" />
      <Portal mount={document.body}>
        <div
          class="studio-video-player"
          classList={{
            fullscreen: fullscreen(),
            "controls-hidden": !controlsVisible(),
          }}
          style={fullscreen() ? undefined : {
            top: `${position().top}px`,
            left: `${position().left}px`,
            width: `${position().width}px`,
            height: `${position().height}px`,
            visibility: position().visible ? "visible" : "hidden",
          }}
          onMouseMove={scheduleControlsHide}
          onMouseLeave={() => {
            if (fullscreen() && playing() && !focused()) setControlsVisible(false)
          }}
          onFocusIn={() => {
            setFocused(true)
            clearControlsTimer()
            setControlsVisible(true)
          }}
          onFocusOut={() => {
            setFocused(false)
            scheduleControlsHide()
          }}
        >
          <video
            ref={videoRef!}
            src={props.src}
            poster={props.poster}
            class={`studio-video-player-media ${props.class ?? ""}`}
            playsinline
            preload="metadata"
            onDblClick={toggleFullscreen}
            onPlay={() => {
              setPlaying(true)
              scheduleControlsHide()
            }}
            onPause={() => {
              setPlaying(false)
              setControlsVisible(true)
              clearControlsTimer()
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onLoadedMetadata={(event) => {
              if (!event.currentTarget.videoWidth || !event.currentTarget.videoHeight) return
              setMediaRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)
            }}
            onVolumeChange={(event) => {
              if (event.currentTarget.volume > 0) setVolume(event.currentTarget.volume)
              setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)
            }}
            onEnded={() => {
              setPlaying(false)
              setControlsVisible(true)
            }}
            onError={(event) => setError(event.currentTarget.error ? "视频加载失败，请重试或下载后查看" : "视频加载失败")}
          />

          <Show when={!playing() && !error()}>
            <button type="button" class="studio-video-player-center-play" aria-label="播放" onClick={togglePlayback}>
              <PlayIcon />
            </button>
          </Show>

          <Show when={error()}>
            <div class="studio-video-player-error" role="alert">{error()}</div>
          </Show>

          <div class="studio-video-player-controls">
            <input
              type="range"
              class="studio-video-player-progress"
              min="0"
              max={Math.max(duration(), 0)}
              step="0.01"
              value={Math.min(currentTime(), duration() || 0)}
              aria-label="视频进度"
              style={{ "--studio-video-progress": `${duration() ? currentTime() / duration() * 100 : 0}%` }}
              onInput={(event) => {
                videoRef.currentTime = Number(event.currentTarget.value)
                setCurrentTime(videoRef.currentTime)
              }}
            />
            <div class="studio-video-player-control-row">
              <button
                type="button"
                class="studio-video-player-button"
                aria-label={playing() ? "暂停" : "播放"}
                title={playing() ? "暂停" : "播放"}
                onClick={togglePlayback}
              >
                <Show when={playing()} fallback={<PlayIcon />}>
                  <PauseIcon />
                </Show>
              </button>
              <button
                type="button"
                class="studio-video-player-button"
                aria-label={muted() ? "取消静音" : "静音"}
                title={muted() ? "取消静音" : "静音"}
                onClick={toggleMuted}
              >
                <VolumeIcon muted={muted()} />
              </button>
              <input
                type="range"
                class="studio-video-player-volume"
                min="0"
                max="1"
                step="0.01"
                value={muted() ? 0 : volume()}
                aria-label="音量"
                style={{ "--studio-video-volume": `${(muted() ? 0 : volume()) * 100}%` }}
                onInput={(event) => {
                  videoRef.volume = Number(event.currentTarget.value)
                  videoRef.muted = videoRef.volume === 0
                }}
              />
              <span class="studio-video-player-time">
                {formatStudioMediaTime(currentTime())} / {formatStudioMediaTime(duration())}
              </span>
              <button
                type="button"
                class="studio-video-player-button studio-video-player-fullscreen"
                aria-label={fullscreen() ? "退出全屏" : "进入全屏"}
                title={fullscreen() ? "退出全屏" : "进入全屏"}
                onClick={toggleFullscreen}
              >
                <FullscreenIcon active={fullscreen()} />
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" />
    </svg>
  )
}

function VolumeIcon(props: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
      <Show
        when={props.muted}
        fallback={<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />}
      >
        <path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </Show>
    </svg>
  )
}

function FullscreenIcon(props: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <Show
        when={props.active}
        fallback={<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />}
      >
        <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
    </svg>
  )
}
