import { expect, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { StudioTurnData } from "./turns"
import { studioTurnAnchorID, studioTurnAnchorText } from "./studio-turn-anchor"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-anchor-dom-test",
  setup(build) {
    build.onLoad({ filter: /studio-turn-anchor-nav\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid view could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioTurnAnchorNav } = await import("./studio-turn-anchor-nav")

function turn(id: string): StudioTurnData {
  return { id, userText: `需求 ${id}`, assistantText: "", createdAt: 1, isLatest: false }
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 1000
  while (!check() && Date.now() < deadline) await Bun.sleep(5)
  expect(check()).toBe(true)
}

function mount(turns = [turn("one"), turn("two"), turn("three")], layout?: { scrollHeight: number; lastTurnHeight: number }) {
  const [state, setState] = createStore({ turns, sessionID: "session-one", navigations: 0, following: false })
  const container = document.createElement("div")
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  const offsets = [0, 600, 1200, 1800]
  const scrolls: ScrollToOptions[] = []
  viewport.append(content)
  document.body.append(viewport, container)
  // Happy DOM has no layout or smooth scrolling; supply viewport geometry only.
  Object.defineProperties(viewport, {
    clientHeight: { value: 400 },
    scrollHeight: { value: layout?.scrollHeight ?? 2400 },
    scrollTo: { value: (options: ScrollToOptions) => {
      scrolls.push(options)
      viewport.scrollTop = options.top ?? 0
      viewport.dispatchEvent(new Event("scroll"))
    } },
  })
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400)
  turns.forEach((item, index) => {
    const el = document.createElement("div")
    el.dataset.studioTurnId = studioTurnAnchorID(item)
    el.getBoundingClientRect = () => new DOMRect(0, offsets[index] - viewport.scrollTop, 300,
      index === turns.length - 1 ? layout?.lastTurnHeight ?? 500 : 500)
    content.append(el)
  })
  const dispose = render(() => createComponent(StudioTurnAnchorNav, {
    get turns() { return state.turns },
    get sessionID() { return state.sessionID },
    get following() { return state.following },
    viewport: () => viewport,
    content: () => content,
    onNavigate: () => setState("navigations", (value) => value + 1),
  }), container)
  return {
    state, setState, container, viewport, content, offsets, scrolls,
    dispose: () => { dispose(); viewport.remove(); container.remove() },
  }
}

test("generation and editor identities survive replacement of the displayed turn", () => {
  const result = {
    id: "generation-one", status: "running", capability: "image.generate", prompt: "猫",
    provider: "internel", model: "qwen", aspectRatio: "1:1", images: [], createdAt: 1,
  } satisfies NonNullable<StudioTurnData["result"]>
  expect(studioTurnAnchorID({ ...turn("pending"), result })).toBe(
    studioTurnAnchorID({ ...turn("completed-tool"), result: { ...result, status: "succeeded" } }),
  )
  expect(studioTurnAnchorID({ ...turn("local"), editorEntryID: "editor-one" })).toBe(
    studioTurnAnchorID({ ...turn("persisted"), editorEntryID: "editor-one" }),
  )
  expect(studioTurnAnchorID(turn("another"))).not.toBe(studioTurnAnchorID(turn("pending")))
})

test("tooltips show user demand and meaningful labels for hidden internal prompts", () => {
  expect(studioTurnAnchorText({ ...turn("one"), userText: "内部上下文\n用户需求：画一只猫\n能力：图片生成" })).toBe("画一只猫")
  expect(studioTurnAnchorText({ ...turn("one"), userText: "@参考图\u200B  猫" })).toBe("@参考图 猫")
  expect(studioTurnAnchorText({ ...turn("one"), hideUserBubble: true, editCapability: "image.inpaint" })).toBe("智能重绘")
  expect(studioTurnAnchorText({ ...turn("one"), hideUserBubble: true, recommendation: { kind: "result", status: "completed" } })).toBe("提示词扩写")
  expect(studioTurnAnchorText({ ...turn("one"), userText: "" })).toBe("[附件]")
})

test("only shows navigation after three content turns, excluding recommendation guides", () => {
  const view = mount([turn("one"), turn("two"), { ...turn("guide"), recommendation: { kind: "guide", status: "completed" } }])
  try {
    expect(view.container.querySelector(".studio-turn-anchor-nav")).toBeNull()
    view.setState("turns", [turn("one"), turn("two"), turn("three")])
    expect(view.container.querySelectorAll("button")).toHaveLength(3)
  } finally { view.dispose() }
})

test("click locates the matching Studio turn and corrects an expanded historical turn", async () => {
  const view = mount()
  try {
    view.container.querySelectorAll<HTMLButtonElement>("button")[1].click()
    expect(view.state.navigations).toBe(1)
    expect(view.scrolls[0]).toEqual({ top: 600, behavior: "smooth" })
    view.offsets[1] = 720
    await waitFor(() => view.viewport.scrollTop === 720)
    expect(view.scrolls.at(-1)).toEqual({ top: 720, behavior: "instant" })
    expect(view.container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toContain("需求 two")
  } finally { view.dispose() }
})

test("manual scrolling releases clicked selection and follows the visible turn", async () => {
  const view = mount()
  try {
    view.container.querySelectorAll<HTMLButtonElement>("button")[1].click()
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 two") === true)
    view.viewport.dispatchEvent(new WheelEvent("wheel"))
    view.viewport.scrollTop = 0
    view.viewport.dispatchEvent(new Event("scroll"))
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 one") === true)
  } finally { view.dispose() }
})

test("equal-length turn replacements and session switches clear stale selection and tooltips", async () => {
  const view = mount()
  try {
    const button = view.container.querySelector<HTMLButtonElement>("button")!
    button.focus()
    expect(view.container.querySelector(".studio-turn-anchor-tip")?.textContent).toBe("需求 one")
    view.setState("turns", 0, turn("replacement"))
    view.content.firstElementChild?.setAttribute("data-studio-turn-id", studioTurnAnchorID(turn("replacement")))
    view.setState("sessionID", "session-two")
    expect(view.container.querySelector(".studio-turn-anchor-tip")).toBeNull()
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 replacement") === true)
  } finally { view.dispose() }
})

test("resuming latest-content following releases the previous navigation target", async () => {
  const view = mount()
  try {
    view.container.querySelectorAll<HTMLButtonElement>("button")[2].click()
    await Bun.sleep(30)
    view.setState("following", true)
    view.viewport.scrollTop = 1000
    view.viewport.dispatchEvent(new Event("scroll"))
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 two") === true)
  } finally { view.dispose() }
})

test("a short final turn is active at the bottom, including fractional scroll positions", async () => {
  const view = mount(undefined, { scrollHeight: 1422, lastTurnHeight: 200 })
  try {
    view.viewport.scrollTop = view.viewport.scrollHeight - view.viewport.clientHeight
    view.viewport.dispatchEvent(new Event("scroll"))
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 three") === true)
    expect(view.content.lastElementChild?.getBoundingClientRect().top).toBe(178)
    view.viewport.scrollTop -= 1.5
    view.viewport.dispatchEvent(new Event("scroll"))
    await Bun.sleep(30)
    expect(view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")).toContain("需求 three")
    view.viewport.scrollTop -= 4
    view.viewport.dispatchEvent(new Event("scroll"))
    await waitFor(() => view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")?.includes("需求 two") === true)
  } finally { view.dispose() }
})

test("releasing a clicked final anchor at the bottom does not select the penultimate turn", async () => {
  const view = mount(undefined, { scrollHeight: 1422, lastTurnHeight: 200 })
  try {
    view.container.querySelectorAll<HTMLButtonElement>("button")[2].click()
    await Bun.sleep(30)
    view.viewport.dispatchEvent(new WheelEvent("wheel"))
    view.setState("following", true)
    view.viewport.dispatchEvent(new Event("scroll"))
    await Bun.sleep(30)
    expect(view.viewport.scrollTop).toBe(view.viewport.scrollHeight - view.viewport.clientHeight)
    expect(view.container.querySelector('[data-active="true"]')?.getAttribute("aria-label")).toContain("需求 three")
  } finally { view.dispose() }
})
