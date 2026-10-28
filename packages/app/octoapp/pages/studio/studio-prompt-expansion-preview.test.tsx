import { expect, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { Part } from "@opencode-ai/sdk/v2/client"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-preview-dom-test",
  setup(build) {
    build.onLoad({ filter: /(?:studio-prompt-expansion-preview|markdown|helper|marked)\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid view could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioPromptExpansionPreview } = await import("./studio-prompt-expansion-preview")
const { MarkedProvider } = await import("@opencode-ai/ui/context/marked")

const part = {
  id: "preview", messageID: "assistant", sessionID: "session", type: "text", text: "",
  time: { start: 1 }, metadata: { studioPromptExpansionPreview: { version: 1, attempt: 1, resultPartID: "result" } },
} satisfies Extract<Part, { type: "text" }>

test("body preview is temporary: streams while running and disappears for every other state", async () => {
  const [state, setState] = createStore<{ status: string; part: Extract<Part, { type: "text" }> }>({
    status: "running", part: structuredClone(part),
  })
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => createComponent(MarkedProvider, {
    get children() {
      return createComponent(StudioPromptExpansionPreview, {
        get status() { return state.status },
        get part() { return state.part },
      })
    },
  }), container)
  try {
    expect(container.querySelector('[data-component="reasoning-part"]')).toBeNull()
    setState("part", "text", "先考虑**构图**")
    await waitFor(() => container.textContent?.includes("先考虑构图") === true)
    expect(container.textContent).toContain("先考虑构图")
    expect(container.querySelector('[data-component="reasoning-part"][data-streaming]')).not.toBeNull()
    setState("part", "text", "先考虑**构图**，再补充光线")
    await waitFor(() => container.textContent?.includes("再补充光线") === true)
    expect(container.textContent).toContain("再补充光线")
    setState("part", "time", { start: 1, end: 2 })
    await waitFor(() => container.textContent?.includes("再补充光线") === true)
    expect(container.textContent).toContain("再补充光线")
    setState("part", { ...part, id: "repair", text: "", time: { start: 3, end: undefined }, metadata: { studioPromptExpansionPreview: { version: 1, attempt: 2, resultPartID: "result" } } })
    expect(container.querySelector('[data-component="reasoning-part"]')).toBeNull()
    setState("part", "text", "修复后的正文")
    await waitFor(() => container.textContent?.includes("修复后的正文") === true)
    expect(container.textContent).toContain("修复后的正文")
    expect(container.textContent).not.toContain("再补充光线")
    for (const status of ["completed", "cancelling", "failed", "cancelled"]) {
      setState("status", status)
      expect(container.querySelector('[data-component="reasoning-part"]')).toBeNull()
      setState("part", "text", `迟到的内容 ${status}`)
      await Bun.sleep(10)
      expect(container.textContent).toBe("")
    }
    expect(container.querySelector("button")).toBeNull()
  } finally {
    dispose()
    container.remove()
  }
})

test("historical preview is hidden immediately and empty streams have no container", () => {
  const container = document.createElement("div")
  const dispose = render(() => createComponent(StudioPromptExpansionPreview, {
    status: "completed", part: { ...part, text: "历史预览" },
  }), container)
  expect(container.textContent).toBe("")
  expect(container.children).toHaveLength(0)
  dispose()
})


async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check() && Date.now() < deadline) await Bun.sleep(5)
  expect(check()).toBe(true)
}

test("a prefilled first chunk starts empty and is played across multiple frames, including emoji", async () => {
  const initial = "城市😀".repeat(80)
  const [state, setState] = createStore<{ status: string; part: Extract<Part, { type: "text" }> }>({
    status: "running", part: { ...structuredClone(part), text: initial, time: { start: 1, end: 2 } },
  })
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => createComponent(MarkedProvider, {
    get children() {
      return createComponent(StudioPromptExpansionPreview, {
        get status() { return state.status },
        get part() { return state.part },
      })
    },
  }), container)
  try {
    expect(container.textContent).toBe("")
    await waitFor(() => (container.textContent?.length ?? 0) > 0)
    const firstFrame = container.textContent?.trim() ?? ""
    expect(firstFrame.length).toBeLessThan(initial.length)
    expect(initial.startsWith(firstFrame)).toBe(true)
    expect(firstFrame).not.toMatch(/[\uD800-\uDBFF]$/)
    await waitFor(() => (container.textContent?.length ?? 0) > firstFrame.length)
    const nextFrame = container.textContent?.trim() ?? ""
    expect(nextFrame.startsWith(firstFrame)).toBe(true)
    expect(initial.startsWith(nextFrame)).toBe(true)
    const full = initial + "新增的光线与构图细节"
    setState("part", "text", full)
    expect(container.textContent).not.toBe(full)
    await waitFor(() => container.textContent?.trim() === full)

    setState("part", { ...structuredClone(part), id: "repair-chunk", text: "修复正文".repeat(60) })
    expect(container.textContent).toBe("")
    await waitFor(() => (container.textContent?.length ?? 0) > 0)
    expect(container.textContent).not.toContain("城市")
    expect(container.textContent).not.toContain("新增")
    expect(container.textContent?.length).toBeLessThan("修复正文".repeat(60).length)
    setState("status", "completed")
    expect(container.children).toHaveLength(0)
    await Bun.sleep(75)
    expect(container.textContent).toBe("")
  } finally {
    dispose()
    container.remove()
  }
})

test("unmounting cancels a pending playback before another part starts", async () => {
  const container = document.createElement("div")
  const dispose = render(() => createComponent(MarkedProvider, {
    get children() {
      return createComponent(StudioPromptExpansionPreview, {
        status: "running", part: { ...structuredClone(part), text: "大段正文".repeat(100) },
      })
    },
  }), container)
  expect(container.textContent).toBe("")
  dispose()
  await Bun.sleep(75)
  expect(container.textContent).toBe("")
})
