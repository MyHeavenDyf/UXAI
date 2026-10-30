import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createRecommendationMode } from "./studio-recommendation-mode"
import type { StudioCapability } from "./types"

test("recommendation A stays image while ordinary B remembers video, including after completion", async () => {
  await new Promise<void>((resolve, reject) =>
    createRoot((dispose) => {
      const [state, setState] = createStore({
        key: "A",
        active: true,
        ready: true,
        global: "image.generate" as StudioCapability,
        entries: {} as Record<string, StudioCapability>,
      })
      const mode = createRecommendationMode({
        key: () => state.key,
        active: () => state.key === "A" && state.active,
        ready: () => state.ready,
        entries: () => state.entries,
        save: (key, value) => setState("entries", key, value),
        global: () => state.global,
        setGlobal: (value) => setState("global", value),
      })
      // Effects run after root setup.
      queueMicrotask(() => {
        try {
          expect(mode.locked()).toBe(true)
          mode.select("video.generate")
          expect(mode.capability()).toBe("image.generate")
          setState("key", "B")
          mode.select("video.generate")
          expect(state.global).toBe("video.generate")
          const canRestoreB = mode.capture()
          setState("key", "A")
          expect(mode.capability()).toBe("image.generate")
          expect(mode.hideTemplate("B")).toBe(true)
          setState("active", false)
          expect(mode.locked()).toBe(false)
          expect(mode.capability()).toBe("image.generate")
          expect(mode.hideTemplate("B")).toBe(true)
          expect(mode.hideTemplate("A")).toBe(false)
          expect(state.global).toBe("video.generate")
          setState("key", "B")
          expect(mode.capability()).toBe("video.generate")
          setState("key", "A")
          mode.select("image.upscale")
          expect(mode.capability()).toBe("image.upscale")
          setState("key", "B")
          expect(canRestoreB()).toBe(false)
          expect(mode.capability()).toBe("image.upscale")
          resolve()
        } catch (error) {
          reject(error)
        } finally {
          dispose()
        }
      })
    }),
  )
})

test("restored session override locks only while its recommendation state is loading", () => {
  createRoot((dispose) => {
    const [state, setState] = createStore({ ready: false })
    const mode = createRecommendationMode({
      key: () => "server/user/dir/A",
      active: () => false,
      ready: () => state.ready,
      entries: () => ({ "server/user/dir/A": "image.generate" }),
      save: () => {},
      global: () => "video.generate",
      setGlobal: () => {},
    })
    expect(mode.locked()).toBe(true)
    expect(mode.capability()).toBe("image.generate")
    setState("ready", true)
    expect(mode.locked()).toBe(false)
    dispose()
  })
})

test("persistent mode locks capability choices but completed results may generate", () => {
  createRoot((dispose) => {
    const [state, setState] = createStore({ enabled: true, active: false })
    const mode = createRecommendationMode({
      key: () => "A",
      enabled: () => state.enabled,
      active: () => state.active,
      ready: () => true,
      entries: () => ({}),
      save: () => {},
      global: () => "video.generate",
      setGlobal: () => {
        throw new Error("must not change global")
      },
    })
    expect(mode.locked()).toBe(true)
    expect(mode.taskLocked()).toBe(false)
    expect(mode.capability()).toBe("image.generate")
    expect(mode.hideTemplate("A")).toBe(true)
    const captured = mode.capture()
    mode.select("video.generate")
    setState("enabled", false)
    setState("enabled", true)
    expect(captured()).toBe(false)
    setState("active", true)
    expect(mode.taskLocked()).toBe(true)
    dispose()
  })
})
