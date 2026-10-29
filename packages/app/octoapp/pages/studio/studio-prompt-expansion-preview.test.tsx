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


test("protocol tags remain visible as text across chunks in both channels", async () => {
  const [state, setState] = createStore<{ status: string; parts: Extract<Part, { type: "text" | "reasoning" }>[] }>({
    status: "running", parts: [{ ...part, text: "<expanded" }, { ...part, id: "reason-tags", type: "reasoning", text: "准备使用 <expandedPrompt> 标签" }],
  })
  const view = mount(state)
  try {
    await waitFor(() => view.container.textContent?.includes("<expanded") === true)
    setState("parts", 0, "text", "<expandedPrompt>城市**雨景** & 灯光</expandedPrompt>\n<tags>场景：城市</tags>")
    await waitFor(() => view.container.textContent?.includes("<tags>场景：城市</tags>") === true)
    expect(view.container.textContent).toContain("<expandedPrompt>城市雨景 & 灯光</expandedPrompt>")
    expect(view.container.textContent).toContain("准备使用 <expandedPrompt> 标签")
    expect(view.container.querySelector("expandedprompt, tags")).toBeNull()
    expect(view.container.querySelector("strong")?.textContent).toBe("雨景")
    expect(state.parts[0].text).toContain("城市**雨景**")
    setState("status", "completed")
    expect(view.container.textContent).toBe("")
  } finally { view.dispose() }
})


test("streaming follows the bottom, pauses on user scroll and resumes at the bottom", async () => {
  const [state, setState] = createStore({ status: "running", parts: [{ ...part, text: "初始正文" }] })
  const view = mount(state)
  try {
    const region = view.container.querySelector<HTMLDivElement>(".studio-prompt-expansion-preview")!
    // Happy DOM does not lay out content; provide viewport geometry while testing real DOM updates/events.
    let height = 900
    let top = 0
    Object.defineProperties(region, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 500 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 500)) } },
    })
    await waitFor(() => view.container.textContent?.includes("初始正文") === true && top === 400)
    height = 1100
    setState("parts", 0, "text", "初始正文，新增的流式内容")
    await waitFor(() => view.container.textContent?.includes("新增的流式内容") === true && top === 600)

    region.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }))
    region.scrollTop = 100
    region.dispatchEvent(new Event("scroll"))
    height = 1400
    setState("parts", 0, "text", "初始正文，新增的流式内容，查看历史时继续输出")
    await waitFor(() => view.container.textContent?.includes("查看历史时继续输出") === true)
    await Bun.sleep(40)
    expect(top).toBe(100)

    region.scrollTop = height - 500
    region.dispatchEvent(new Event("scroll"))
    height = 1700
    setState("parts", 0, "text", "初始正文，新增的流式内容，查看历史时继续输出，回到底部后恢复跟随")
    await waitFor(() => view.container.textContent?.includes("恢复跟随") === true && top === 1200)
    setState("status", "completed")
    expect(view.container.children).toHaveLength(0)
    await Bun.sleep(40)
    expect(top).toBe(1200)
  } finally { view.dispose() }
})
