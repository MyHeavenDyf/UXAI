import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createRecommendationMode } from "./studio-recommendation-mode"
import type { StudioCapability } from "./types"

function setup() {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      key: "A", enabled: true, busy: false, ready: true,
      global: "image.generate" as StudioCapability,
      entries: {} as Record<string, StudioCapability>,
    })
    const mode = createRecommendationMode({
      key: () => state.key,
      enabled: () => state.key === "A" && state.enabled,
      busy: () => state.busy,
      ready: () => state.ready,
      entries: () => state.entries,
      save: (key, value) => setState("entries", key, value),
      global: () => state.global,
      setGlobal: (value) => setState("global", value),
    })
    return { state, setState, mode, dispose }
  })
}

test("image recommendation is suspended in video and editor capabilities and restored on return", () => {
  const value = setup()
  try {
    expect(value.mode.active()).toBe(true)
    expect(value.mode.taskBlocked()).toBe(false)
    expect(value.mode.hideTemplate("A")).toBe(true)
    for (const capability of ["video.generate", "image.upscale", "image.cutout", "image.inpaint", "image.outpaint"] as const) {
      value.mode.select(capability)
      expect(value.mode.capability()).toBe(capability)
      expect(value.mode.active()).toBe(false)
      expect(value.mode.hideTemplate("A")).toBe(false)
      expect(value.state.enabled).toBe(true)
    }
    value.mode.select("image.generate")
    expect(value.mode.active()).toBe(true)
    value.setState("enabled", false)
    expect(value.mode.active()).toBe(false)
    expect(value.mode.hideTemplate("A")).toBe(false)
  } finally { value.dispose() }
})

test("recommendation sessions remember their selected capability across other sessions", () => {
  const value = setup()
  try {
    value.mode.select("image.upscale")
    value.setState("key", "B")
    value.mode.select("video.generate")
    value.setState("key", "A")
    expect(value.mode.capability()).toBe("image.upscale")
    expect(value.mode.active()).toBe(false)
    expect(value.mode.hideTemplate("B")).toBe(true)
    expect(value.state.global).toBe("video.generate")
  } finally { value.dispose() }
})

test("only real task occupancy blocks capability selection", () => {
  const value = setup()
  try {
    value.setState("busy", true)
    value.mode.select("video.generate")
    expect(value.mode.capability()).toBe("image.generate")
    expect(value.mode.taskBlocked()).toBe(true)
    value.setState("busy", false)
    value.mode.select("video.generate")
    expect(value.mode.capability()).toBe("video.generate")
    value.setState("ready", false)
    expect(value.mode.taskBlocked()).toBe(true)
  } finally { value.dispose() }
})

test("async session captures work while recommended and reject A to B to A visits", () => {
  const value = setup()
  try {
    const captured = value.mode.capture()
    expect(captured()).toBe(true)
    value.setState("enabled", false)
    expect(captured()).toBe(true)
    value.setState("key", "B")
    value.setState("key", "A")
    expect(captured()).toBe(false)
  } finally { value.dispose() }
})
