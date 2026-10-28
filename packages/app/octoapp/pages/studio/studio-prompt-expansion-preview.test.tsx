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


async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check() && Date.now() < deadline) await Bun.sleep(5)
  expect(check()).toBe(true)
}

function mount(state: { status: string; parts: Extract<Part, { type: "text" | "reasoning" }>[] }) {
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => createComponent(MarkedProvider, {
    get children() {
      return createComponent(StudioPromptExpansionPreview, {
        get status() { return state.status },
        get parts() { return state.parts },
      })
    },
  }), container)
  return { container, dispose: () => { dispose(); container.remove() } }
}

test("shows raw JSON and model reasoning separately as soon as either arrives", async () => {
  const [state, setState] = createStore<{ status: string; parts: Extract<Part, { type: "text" | "reasoning" }>[] }>({
    status: "running", parts: [{ ...part }],
  })
  const view = mount(state)
  try {
    expect(view.container.children).toHaveLength(0)
    setState("parts", [{ ...part, id: "reason", type: "reasoning", text: "先考虑**构图**" }])
    await waitFor(() => view.container.textContent?.includes("先考虑构图") === true)
    expect(view.container.querySelector('[data-component="reasoning-part"][data-streaming]')).not.toBeNull()
    expect(view.container.querySelector('[data-component="text-part"]')).toBeNull()
    setState("parts", 1, { ...part, text: '{"expandedPrompt":"城市' })
    await waitFor(() => view.container.textContent?.includes('{"expandedPrompt":"城市') === true)
    expect(view.container.querySelector('[data-component="text-part"]')).not.toBeNull()
    expect(view.container.textContent).toContain("先考虑构图")
    setState("parts", 0, "text", "先考虑**构图**，再考虑光线")
    setState("parts", 1, "text", '{"expandedPrompt":"城市雨景","tags":[')
    await waitFor(() => view.container.textContent?.includes('"tags":') === true && view.container.textContent.includes("再考虑光线"))
    for (const status of ["completed", "cancelling", "failed", "cancelled"]) {
      setState("status", status)
      expect(view.container.children).toHaveLength(0)
      setState("parts", 1, "text", `迟到内容 ${status}`)
      await Bun.sleep(30)
      expect(view.container.textContent).toBe("")
    }
  } finally { view.dispose() }
})

test("body-only output is visible immediately and appended chunks are paced", async () => {
  const [state, setState] = createStore({ status: "running", parts: [{ ...part, text: "城市😀" }] })
  const view = mount(state)
  try {
    await waitFor(() => view.container.textContent?.trim() === "城市😀")
    const full = "城市😀".repeat(80)
    setState("parts", 0, "text", full)
    await waitFor(() => (view.container.textContent?.trim().length ?? 0) > "城市😀".length)
    const firstFrame = view.container.textContent?.trim() ?? ""
    expect(firstFrame.length).toBeLessThan(full.length)
    expect(full.startsWith(firstFrame)).toBe(true)
    expect(firstFrame).not.toMatch(/[\uD800-\uDBFF]$/)
    await waitFor(() => view.container.textContent?.trim() === full)
    expect(view.container.querySelector('[data-component="reasoning-part"]')).toBeNull()
  } finally { view.dispose() }
})

test("repair clears both previous channels and completion cancels unfinished playback", async () => {
  const [state, setState] = createStore<{ status: string; parts: Extract<Part, { type: "text" | "reasoning" }>[] }>({
    status: "running", parts: [
      { ...part, id: "r1", type: "reasoning", text: "首轮思考" },
      { ...part, id: "t1", text: "首轮正文" },
    ],
  })
  const view = mount(state)
  try {
    await waitFor(() => view.container.textContent?.includes("首轮正文") === true)
    setState("parts", [{ ...part, id: "repair", text: "" }])
    expect(view.container.textContent).toBe("")
    setState("parts", 0, "text", "修复正文")
    await waitFor(() => view.container.textContent?.trim() === "修复正文")
    setState("parts", 0, "text", "修复正文".repeat(100))
    setState("status", "completed")
    expect(view.container.children).toHaveLength(0)
    await Bun.sleep(75)
    expect(view.container.textContent).toBe("")
  } finally { view.dispose() }
})

test("historical previews stay hidden and unmount cancels playback", async () => {
  const [state, setState] = createStore({ status: "completed", parts: [{ ...part, text: "历史预览" }] })
  const view = mount(state)
  expect(view.container.children).toHaveLength(0)
  setState("status", "running")
  await waitFor(() => view.container.textContent?.includes("历史预览") === true)
  setState("parts", 0, "text", "历史预览".repeat(100))
  view.dispose()
  await Bun.sleep(75)
  expect(view.container.textContent).toBe("")
})
