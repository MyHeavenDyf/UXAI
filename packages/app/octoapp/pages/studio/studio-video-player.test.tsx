import { expect, spyOn, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-video-player-dom-test",
  setup(build) {
    build.onLoad({ filter: /studio-video-player\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid view could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioVideoPlayer } = await import("./studio-video-player")

function mount(inline = false) {
  const metadata: { width: number; height: number; duration: number }[] = []
  const plays: HTMLVideoElement[] = []
  const [state, setState] = createStore({ boardOpen: false, hidden: false })
  const page = document.createElement("div")
  const container = document.createElement("div")
  page.append(container)
  document.body.append(page)
  // Happy DOM has no layout; supply only geometry and deterministic animation frames.
  container.style.padding = "0px"
  Object.defineProperties(container, {
    clientWidth: { get: () => (state.hidden ? 0 : 640) },
    clientHeight: { get: () => (state.hidden ? 0 : 360) },
  })
  page.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 700)
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  const request = spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id)
  })
  const dispose = render(
    () =>
      createComponent(Show, {
        keyed: true,
        get when() {
          return !state.boardOpen
        },
        get children() {
          return createComponent(StudioVideoPlayer, {
            src: "video.mp4",
            mount: () => page,
            inline,
            onMetadata: (value) => metadata.push(value),
            onPlay: (video) => plays.push(video),
          })
        },
      }),
    container,
  )
  const anchor = () => {
    const element = container.querySelector<HTMLElement>(".studio-video-player-anchor")!
    element.getBoundingClientRect = () => (state.hidden ? new DOMRect() : new DOMRect(100, 50, 640, 360))
  }
  anchor()
  const flush = () => {
    const pending = Array.from(frames.values())
    frames.clear()
    pending.forEach((callback) => callback(performance.now()))
  }
  return {
    page,
    container,
    frames,
    setState,
    flush,
    anchor,
    metadata,
    plays,
    player: () => page.querySelector<HTMLElement>(".studio-video-player")!,
    video: () => page.querySelector("video")!,
    measure: async () => {
      await Bun.sleep(0)
      flush()
      flush()
    },
    dispose: () => {
      dispose()
      page.remove()
      request.mockRestore()
      cancel.mockRestore()
    },
  }
}

test("inline playback reports real dimensions and preserves the video through fullscreen without dragging its card", async () => {
  const view = mount(true)
  try {
    await view.measure()
    const video = view.video()
    expect(view.container.contains(view.player())).toBe(true)
    expect(view.container.querySelector(".studio-video-player-inline-anchor")).not.toBeNull()
    expect(view.player().classList.contains("studio-video-player-inline")).toBe(true)
    expect(view.container.querySelector(".inline")).toBeNull()
    expect(view.player().classList.contains("compact")).toBe(true)
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 },
      duration: { configurable: true, value: 12 },
    })
    video.dispatchEvent(new Event("loadedmetadata"))
    expect(view.metadata).toEqual([{ width: 1080, height: 1920, duration: 12 }])
    view.player().dispatchEvent(new MouseEvent("mouseenter"))
    expect(video.paused).toBe(true)
    const drags: Event[] = []
    view.container.addEventListener("mousedown", (event) => drags.push(event))
    view.player().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    expect(drags).toHaveLength(0)
    await video.play()
    expect(view.plays).toEqual([video])
    video.currentTime = 4
    view.player().querySelector<HTMLButtonElement>('[aria-label="进入全屏"]')!.click()
    expect(view.container.contains(view.player())).toBe(false)
    expect(view.player().classList.contains("fullscreen")).toBe(true)
    expect(view.video()).toBe(video)
    expect(video.currentTime).toBe(4)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(view.container.contains(view.player())).toBe(true)
    expect(view.video()).toBe(video)
    expect(video.currentTime).toBe(4)
    view.setState("boardOpen", true)
    expect(video.paused).toBe(true)
    expect(view.page.querySelector(".studio-video-player-inline-host")).toBeNull()
  } finally {
    view.dispose()
  }
})

test("entering the board removes the portaled preview, stops playback, and allows a fresh preview on return", async () => {
  const view = mount()
  try {
    await view.measure()
    expect(view.player().style.visibility).toBe("visible")
    expect(view.container.contains(view.player())).toBe(false)
    const video = view.video()
    view.player().dispatchEvent(new MouseEvent("mouseenter"))
    expect(video.paused).toBe(false)

    view.setState("boardOpen", true)
    expect(view.page.querySelector(".studio-video-player")).toBeNull()
    expect(video.paused).toBe(true)
    await Bun.sleep(0)
    expect(view.frames.size).toBe(0)

    view.setState("boardOpen", false)
    view.anchor()
    await view.measure()
    expect(view.page.querySelectorAll(".studio-video-player")).toHaveLength(1)
    expect(view.video()).not.toBe(video)
    expect(view.player().style.visibility).toBe("visible")
  } finally {
    view.dispose()
  }
})

test("a hidden preview container hides the portal, pauses media, and cancels a pending playback click", async () => {
  const view = mount()
  try {
    await view.measure()
    view.player().dispatchEvent(new MouseEvent("mouseenter"))
    expect(view.video().paused).toBe(false)
    view.video().click()
    view.setState("hidden", true)
    view.container.style.display = "none"
    window.dispatchEvent(new Event("resize"))
    await view.measure()
    expect(view.player().style.visibility).toBe("hidden")
    expect(view.video().paused).toBe(true)
    await Bun.sleep(250)
    expect(view.video().paused).toBe(true)

    view.setState("hidden", false)
    view.container.style.display = ""
    window.dispatchEvent(new Event("resize"))
    await view.measure()
    expect(view.player().style.visibility).toBe("visible")
  } finally {
    view.dispose()
  }
})

test("unmount between the two measurement frames cancels the inner frame and delayed playback", async () => {
  const view = mount()
  try {
    await Bun.sleep(0)
    view.video().click()
    const video = view.video()
    const play = spyOn(video, "play")
    view.flush()
    expect(view.frames.size).toBe(1)
    view.setState("boardOpen", true)
    expect(view.frames.size).toBe(0)
    await Bun.sleep(250)
    expect(play).not.toHaveBeenCalled()
    expect(view.frames.size).toBe(0)
    play.mockRestore()
  } finally {
    view.dispose()
  }
})
