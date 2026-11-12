import { expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createStudioDraftCapture, restoreStudioDraft } from "./studio-draft-restore"
import type { StudioAsset, StudioCapability } from "./types"

const asset = (id: string): StudioAsset => ({ id, name: `${id}.png`, mime: "image/png", dataUrl: `data:image/png;base64,${id}` })

function setup(capability: StudioCapability) {
  return createRoot((dispose) => {
    const [state, setState] = createStore({
      session: "A", revision: 0, prompt: "任务 A", capability,
      assets: [asset("A")], ratio: "3:4", recipe: "原模板正文",
    })
    const [frames, setFrames] = createStore<{ first?: StudioAsset; last?: StudioAsset }>({
      first: asset("A-first"), last: asset("A-last"),
    })
    const capture = createStudioDraftCapture(() => ({
      session: state.session, revision: state.revision, prompt: state.prompt,
      capability: state.capability, assets: state.assets, ratio: state.ratio, recipe: state.recipe,
    }), () => frames)
    const observed: { prompt: string; image: string | undefined; first: string | undefined; ratio: string }[] = []
    createEffect(() => observed.push({
      prompt: state.prompt, image: state.assets[0]?.id, first: frames.first?.id, ratio: state.ratio,
    }))
    const restore = (prepare: () => Promise<{ assets: StudioAsset[]; frames: { first?: StudioAsset; last?: StudioAsset } }>) => {
      const valid = capture()
      return restoreStudioDraft({
        prepare,
        valid,
        apply: (prepared) => {
          setState("prompt", "任务 B")
          setState("ratio", "16:9")
          setState("assets", reconcile(prepared.assets))
          setFrames(reconcile(prepared.frames))
        },
      })
    }
    return { state, setState, frames, setFrames, capture, observed, restore, dispose }
  })
}

const prepared = () => ({ assets: [asset("B")], frames: { first: asset("B-first"), last: asset("B-last") } })

test.each(["image.generate", "video.generate"] as const)("%s waits for media before atomically replacing the whole draft", async (capability) => {
  const value = setup(capability)
  const loading = Promise.withResolvers<ReturnType<typeof prepared>>()
  try {
    const restoring = value.restore(() => loading.promise)
    expect(value.state.prompt).toBe("任务 A")
    expect(value.state.assets[0].id).toBe("A")
    expect(value.frames.first?.id).toBe("A-first")
    loading.resolve(prepared())
    expect(await restoring).toBe(true)
    expect(value.observed).toEqual([
      { prompt: "任务 A", image: "A", first: "A-first", ratio: "3:4" },
      { prompt: "任务 B", image: "B", first: "B-first", ratio: "16:9" },
    ])
  } finally { value.dispose() }
})

test.each(["image.generate", "video.generate"] as const)("%s keeps the user's current draft intact when text changes while media loads", async (capability) => {
  const value = setup(capability)
  const loading = Promise.withResolvers<ReturnType<typeof prepared>>()
  try {
    const restoring = value.restore(() => loading.promise)
    value.setState("prompt", "用户修改的 A")
    loading.resolve(prepared())
    expect(await restoring).toBe(false)
    expect(value.state.prompt).toBe("用户修改的 A")
    expect(value.state.ratio).toBe("3:4")
    expect(value.state.assets[0].id).toBe("A")
    expect(value.frames.first?.id).toBe("A-first")
  } finally { value.dispose() }
})

test.each(["first", "last"] as const)("in-place replacement of the existing %s frame invalidates a pending restore", async (slot) => {
  const value = setup("video.generate")
  const loading = Promise.withResolvers<ReturnType<typeof prepared>>()
  try {
    const restoring = value.restore(() => loading.promise)
    const previous = value.frames[slot]
    value.setFrames(slot, asset("user-picked"))
    expect(value.frames[slot]).toBe(previous)
    loading.resolve(prepared())
    expect(await restoring).toBe(false)
    expect(value.frames[slot]?.id).toBe("user-picked")
    expect(value.state.prompt).toBe("任务 A")
  } finally { value.dispose() }
})

test("changing frame content with the same asset id also invalidates the capture", () => {
  const value = setup("video.generate")
  try {
    const valid = value.capture()
    value.setFrames("first", "dataUrl", "data:image/png;base64,new-content")
    expect(valid()).toBe(false)
  } finally { value.dispose() }
})

test("A to B to A navigation and newer restore actions invalidate old captures", () => {
  const value = setup("image.generate")
  try {
    const session = value.capture()
    value.setState("session", "B")
    value.setState("session", "A")
    expect(session()).toBe(false)
    const previous = value.capture()
    value.setState("revision", (revision) => revision + 1)
    expect(previous()).toBe(false)
  } finally { value.dispose() }
})

test("a media loading failure does not partially change the draft", async () => {
  const value = setup("image.generate")
  try {
    await expect(value.restore(() => Promise.reject(new Error("unavailable")))).rejects.toThrow("unavailable")
    expect(value.state.prompt).toBe("任务 A")
    expect(value.state.assets[0].id).toBe("A")
    expect(value.state.ratio).toBe("3:4")
  } finally { value.dispose() }
})

test("DOM restoration runs after the batched draft update has flushed", async () => {
  const value = setup("image.generate")
  try {
    const result = await restoreStudioDraft({
      prepare: async () => "任务 B",
      valid: value.capture(),
      apply: (prompt) => value.setState("prompt", prompt),
      afterApply: () => expect(value.observed.at(-1)?.prompt).toBe("任务 B"),
    })
    expect(result).toBe(true)
  } finally { value.dispose() }
})
