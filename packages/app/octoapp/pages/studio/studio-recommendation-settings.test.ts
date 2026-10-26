import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { makePersisted } from "@solid-primitives/storage"
import { createRecommendationMode } from "./studio-recommendation-mode"
import { createRecommendationSettings, type RecommendationImageSettings } from "./studio-recommendation-settings"
import type { StudioCapability } from "./types"

const image: RecommendationImageSettings = {
  aspectRatio: "3:4", count: 4, customWidth: 1200, customHeight: 1600, isCustom: true,
}

function setup(cached?: RecommendationImageSettings, video = false, options?: {
  last?: RecommendationImageSettings
  active?: boolean
  ready?: boolean
  storage?: string
}) {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      session: "A", active: options?.active ?? true, ready: options?.ready ?? true, globalCapability: (video ? "video.generate" : "image.generate") as StudioCapability,
      shared: video ? { ...image, aspectRatio: "21:9" as const, count: 1 as const, isCustom: false } : { ...image },
      modes: {} as Record<string, StudioCapability>,
      settings: (cached ? { A: cached } : {}) as Record<string, RecommendationImageSettings>,
    })
    const lastStore = createStore<{ value?: RecommendationImageSettings }>({ value: options?.last })
    const last = options?.storage
      ? makePersisted(lastStore, { name: options.storage, storage: localStorage })
      : lastStore
    const mode = createRecommendationMode({
      key: () => state.session, active: () => state.session === "A" && state.active,
      ready: () => true, entries: () => state.modes,
      save: (key, value) => setState("modes", key, value),
      global: () => state.globalCapability, setGlobal: (value) => setState("globalCapability", value),
    })
    const settings = createRecommendationSettings({
      key: () => state.session,
      enabled: () => mode.capability() === "image.generate" && Boolean(state.modes[state.session] || mode.locked()),
      entries: () => state.settings,
      ready: () => state.ready,
      imageActive: () => mode.capability() === "image.generate",
      lastImage: () => last[0].value,
      saveImage: (value) => last[1]("value", value),
      fallback: () => state.globalCapability === "video.generate"
        ? { ...image, customWidth: 0, customHeight: 0, isCustom: false } : state.shared,
      global: () => state.shared, setGlobal: (value) => setState("shared", value),
      save: (key, value) => setState("settings", key, value),
    })
    return { state, setState, mode, settings, last, dispose }
  })
}

test("A restores all image settings after B changes video ratio and count, including after expansion ends", () => {
  const api = setup()
  try {
    api.settings.set("aspectRatio", "2:3")
    api.settings.set("count", 3)
    api.settings.set("customWidth", 1024)
    api.settings.set("customHeight", 1536)
    const expected = { ...api.settings.current() }
    api.setState("session", "B")
    api.mode.select("video.generate")
    api.settings.set("aspectRatio", "21:9")
    api.settings.set("count", 1)
    api.settings.set("isCustom", false)
    api.settings.set("customWidth", 0)
    api.settings.set("customHeight", 0)
    api.setState("session", "A")
    expect(api.mode.capability()).toBe("image.generate")
    expect(api.settings.current()).toEqual(expected)
    api.setState("active", false)
    expect(api.settings.current()).toEqual(expected)
    api.setState("session", "B")
    expect(api.settings.current()).toMatchObject({ aspectRatio: "21:9", count: 1, isCustom: false })
    api.setState("session", "A")
    api.mode.select("video.generate")
    api.settings.set("aspectRatio", "16:9")
    api.mode.select("image.generate")
    expect(api.settings.current()).toEqual(expected)
  } finally { api.dispose() }
})

test("cached recommendation image settings survive a new page instance and exclude video-only ratios", () => {
  const api = setup({ ...image, aspectRatio: "21:9" })
  try {
    expect(api.settings.current()).toEqual(image)
    api.settings.set("aspectRatio", "1:1")
    const cached = { ...api.state.settings.A }
    const restored = setup(cached)
    try { expect(restored.settings.current()).toEqual({ ...image, aspectRatio: "1:1" }) }
    finally { restored.dispose() }
  } finally { api.dispose() }
})

test("ordinary sessions keep shared parameters without creating recommendation snapshots", () => {
  const api = setup()
  try {
    api.setState("session", "B")
    api.settings.set("aspectRatio", "16:9")
    expect(api.state.shared.aspectRatio).toBe("16:9")
    expect(api.state.settings.B).toBeUndefined()
  } finally { api.dispose() }
})


test("a recommendation without an earlier snapshot uses image defaults when the shared controls belong to video", () => {
  const api = setup(undefined, true)
  try {
    expect(api.settings.current()).toEqual({
      aspectRatio: "3:4", count: 4, customWidth: 0, customHeight: 0, isCustom: false,
    })
    expect(api.state.shared.aspectRatio).toBe("21:9")
    expect(api.state.globalCapability).toBe("video.generate")
  } finally { api.dispose() }
})


test("ordinary image changes save a complete record that video controls cannot overwrite", () => {
  const api = setup(undefined, false, { active: false })
  try {
    api.settings.set("aspectRatio", "2:3")
    api.settings.set("count", 2)
    api.settings.set("customWidth", 1024)
    api.settings.set("customHeight", 1536)
    api.settings.set("isCustom", true)
    const expected = { ...api.settings.current() }
    expect(api.last[0].value).toEqual(expected)
    api.mode.select("video.generate")
    api.settings.set("aspectRatio", "21:9")
    api.settings.set("count", 1)
    api.settings.set("isCustom", false)
    api.settings.set("customWidth", 0)
    api.settings.set("customHeight", 0)
    expect(api.settings.current().aspectRatio).toBe("21:9")
    expect(api.settings.image()).toEqual(expected)
    expect(api.last[0].value).toEqual(expected)
  } finally { api.dispose() }
})

test("completed history in video mode reads session image settings before the last image record", () => {
  const cached = { ...image, aspectRatio: "2:3" as const, count: 2 as const }
  const api = setup(cached, true, { active: false, last: image })
  try {
    expect(api.mode.capability()).toBe("video.generate")
    expect(api.settings.current().aspectRatio).toBe("21:9")
    expect(api.settings.image()).toEqual(cached)
    expect(api.state.globalCapability).toBe("video.generate")
  } finally { api.dispose() }
})

test("history with no session snapshot uses the saved image settings without switching video mode", () => {
  const api = setup(undefined, true, { active: false, last: image })
  try {
    expect(api.settings.image()).toEqual(image)
    expect(api.settings.current().aspectRatio).toBe("21:9")
    expect(api.state.settings.A).toBeUndefined()
    expect(api.state.globalCapability).toBe("video.generate")
  } finally { api.dispose() }
})

test("first use in video mode gets image defaults rather than video parameters", () => {
  const api = setup(undefined, true, { active: false })
  try {
    expect(api.settings.image()).toEqual({
      aspectRatio: "3:4", count: 4, customWidth: 0, customHeight: 0, isCustom: false,
    })
    expect(api.last[0].value).toBeUndefined()
  } finally { api.dispose() }
})

test("initial migration waits for persisted image parameters before seeding a recommendation", () => {
  const api = setup(undefined, true, { ready: false })
  try {
    expect(api.state.settings.A).toBeUndefined()
    expect(api.last[0].value).toBeUndefined()
    api.last[1]("value", image)
    api.setState("ready", true)
    expect(api.settings.image()).toEqual(image)
    expect(api.state.settings.A).toEqual(image)
  } finally { api.dispose() }
})

test("the last image record restores its custom dimensions after a new page instance opens in video mode", async () => {
  const key = `last-image-settings-test:${crypto.randomUUID()}`
  const first = setup(undefined, false, { active: false, storage: key })
  try {
    first.settings.set("aspectRatio", "2:3")
    first.settings.set("count", 3)
    first.settings.set("customWidth", 1024)
    first.settings.set("customHeight", 1536)
    first.settings.set("isCustom", true)
    await Bun.sleep(0)
    expect(localStorage.getItem(key)).toContain("1536")
  } finally { first.dispose() }
  const second = setup(undefined, true, { active: false, storage: key })
  try {
    expect(second.settings.image()).toEqual({
      aspectRatio: "2:3", count: 3, customWidth: 1024, customHeight: 1536, isCustom: true,
    })
    expect(second.mode.capability()).toBe("video.generate")
    expect(second.state.shared.aspectRatio).toBe("21:9")
  } finally {
    second.dispose()
    localStorage.removeItem(key)
  }
})
