import { expect, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ThumbnailMap } from "../session-thumbnail"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-board-header-dom-test",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid component could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { StudioBoardHeader } = await import("./studio-board-header")

function session(id: string, title: string): Session {
  return {
    id,
    title,
    slug: id,
    projectID: "test",
    directory: "/test",
    version: "test",
    agent: "octo_studio",
    studio_mode: "board",
    sort_order: 0,
    pinned: false,
    time: { created: 1, updated: 2 },
  }
}
function setup() {
  const [state, setState] = createStore({
    title: "商业广告短片制作",
    failRename: false,
    failList: false,
    pending: false,
    failed: false,
    thumbnails: {} as ThumbnailMap,
  })
  const renamed: string[] = []
  const selected: (string | undefined)[] = []
  const cursors: (string | undefined)[] = []
  const thumbnails: string[][] = []
  const actions: string[] = []
  const container = document.createElement("div")
  document.body.append(container)
  const unmount = render(
    () =>
      createComponent(StudioBoardHeader, {
        get title() {
          return state.title
        },
        sessionID: "current",
        status: "已保存",
        get pending() {
          return state.pending
        },
        get failed() {
          return state.failed
        },
        disabled: false,
        get thumbnails() {
          return state.thumbnails
        },
        mediaURL: (value) => value,
        loadSessions: async (cursor) => {
          cursors.push(cursor)
          if (state.failList) throw new Error("列表读取失败")
          return cursor
            ? { sessions: [session("older", "旧画布")] }
            : { sessions: [session("current", state.title), session("other", "其他画布")], nextCursor: "page-2" }
        },
        loadThumbnails: (sessions) => thumbnails.push(sessions.map((session) => session.id)),
        onRename: async (title) => {
          renamed.push(title)
          if (state.failRename) throw new Error("名称保存失败")
          setState("title", title)
        },
        onSelect: (id) => selected.push(id),
        onExit: () => actions.push("exit"),
        onSave: () => actions.push("save"),
      }),
    container,
  )
  return {
    container,
    state,
    setState,
    renamed,
    selected,
    cursors,
    thumbnails,
    actions,
    dispose: () => {
      unmount()
      container.remove()
    },
  }
}
const tick = () => Bun.sleep(0)
function button(container: HTMLElement, label: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    (element) => element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  )
  if (!element) throw new Error(`Missing button ${label}`)
  return element
}

test("board title selects all text, saves trimmed edits, cancels and keeps failed edits for retry", async () => {
  const value = setup()
  try {
    value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
    await tick()
    const input = value.container.querySelector<HTMLInputElement>('[aria-label="画布名称"]')!
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(value.state.title.length)
    input.value = "  新的画布名称  "
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await tick()
    expect(value.renamed).toEqual(["新的画布名称"])
    expect(value.container.querySelector(".studio-board-name")?.textContent).toBe("新的画布名称")
    value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
    await tick()
    const cancelled = value.container.querySelector<HTMLInputElement>("input")!
    cancelled.value = "不要保存"
    cancelled.dispatchEvent(new Event("input", { bubbles: true }))
    cancelled.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await tick()
    expect(value.renamed).toHaveLength(1)
    expect(value.container.querySelector(".studio-board-name")?.textContent).toBe("新的画布名称")
    value.setState("failRename", true)
    value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
    await tick()
    const retry = value.container.querySelector<HTMLInputElement>("input")!
    retry.value = "重试的名称"
    retry.dispatchEvent(new Event("input", { bubbles: true }))
    retry.blur()
    await tick()
    expect(value.container.querySelector('[role="alert"]')?.textContent).toContain("名称保存失败")
    expect(retry.value).toBe("重试的名称")
    expect(retry.disabled).toBe(false)
    value.setState("failRename", false)
    retry.focus()
    retry.blur()
    await tick()
    expect(value.container.querySelector(".studio-board-name")?.textContent).toBe("重试的名称")
    expect(value.container.querySelector('[role="alert"]')).toBeNull()
    value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
    await tick()
    const blank = value.container.querySelector<HTMLInputElement>("input")!
    blank.value = " "
    blank.dispatchEvent(new Event("input", { bubbles: true }))
    blank.blur()
    await tick()
    expect(value.renamed).toEqual(["新的画布名称", "重试的名称", "重试的名称"])
    expect(value.container.querySelector(".studio-board-name")?.textContent).toBe("重试的名称")
  } finally {
    value.dispose()
  }
})

test("board menu loads pages and thumbnails, marks the current canvas and supports switching and creation", async () => {
  const value = setup()
  try {
    button(value.container, "切换画布").click()
    await tick()
    expect(value.cursors).toEqual([undefined])
    expect(value.thumbnails).toEqual([["current", "other"]])
    expect(value.container.querySelector('[aria-checked="true"]')?.textContent).toContain(value.state.title)
    expect(value.container.querySelectorAll(".studio-board-session-placeholder")).toHaveLength(2)
    value.setState("thumbnails", {
      current: { url: "https://example.test/latest.webp", updatedAt: 1, generationAt: 10 },
      other: { url: "https://example.test/latest.mp4", kind: "video", updatedAt: 1, generationAt: 20 },
    })
    expect(value.container.querySelector<HTMLImageElement>(".studio-board-session-thumb img")?.src).toBe(
      "https://example.test/latest.webp",
    )
    expect(value.container.querySelector<HTMLVideoElement>(".studio-board-session-thumb video")?.src).toBe(
      "https://example.test/latest.mp4",
    )
    button(value.container, "加载更多").click()
    await tick()
    expect(value.cursors).toEqual([undefined, "page-2"])
    expect(value.container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
    button(value.container, "旧画布").click()
    expect(value.selected).toEqual(["older"])
    expect(value.container.querySelector('[role="menu"]')).toBeNull()
    button(value.container, "切换画布").click()
    await tick()
    button(value.container, "新建画布").click()
    expect(value.selected).toEqual(["older", undefined])
    expect(value.container.querySelector('[role="menu"]')).toBeNull()
    button(value.container, "保存画布").click()
    button(value.container, "退出画布").click()
    expect(value.actions).toEqual(["save", "exit"])
    value.setState("pending", true)
    expect(value.container.querySelector(".studio-board-cloud.pending")).not.toBeNull()
    value.setState("failed", true)
    expect(value.container.querySelector(".studio-board-cloud.failed")).not.toBeNull()
  } finally {
    value.dispose()
  }
})

test("board menu retries the failed page and closes with outside focus or Escape", async () => {
  const value = setup()
  try {
    button(value.container, "切换画布").click()
    await tick()
    value.setState("failList", true)
    button(value.container, "加载更多").click()
    await tick()
    expect(value.container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2)
    value.setState("failList", false)
    button(value.container, "加载失败，点击重试").click()
    await tick()
    expect(value.cursors).toEqual([undefined, "page-2", "page-2"])
    const menu = value.container.querySelector<HTMLElement>('[role="menu"]')!
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio")
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(value.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(button(value.container, "切换画布"))
    button(value.container, "切换画布").click()
    await tick()
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(value.container.querySelector('[role="menu"]')).toBeNull()
    button(value.container, "切换画布").click()
    await tick()
    const outside = document.createElement("input")
    document.body.append(outside)
    outside.focus()
    expect(value.container.querySelector('[role="menu"]')).toBeNull()
    outside.remove()
  } finally {
    value.dispose()
  }
})
