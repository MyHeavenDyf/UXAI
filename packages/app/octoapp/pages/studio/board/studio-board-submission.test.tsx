import { afterAll, expect, spyOn, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"
import { BoardDocument, emptyBoard, newBoardCard, type BoardSubmission } from "@opencode-ai/core/studio-board"
import { STUDIO_STYLE_MODEL_CONFIG, defaultStudioStyleModel } from "@opencode-ai/core/studio/model-availability"
import { styleModelLabel } from "../data"
import { clearStudioPermissionCache, ensureStudioPermission } from "../studio-permission-store"
import type { BoardGenerationRequest } from "./studio-board-api"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-board-submission-dom-test",
  setup(build) {
    build.onLoad({ filter: /\.(svg|png)$/ }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)}`,
      loader: "js",
    }))
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result: unknown = await Reflect.apply(transform, undefined, [await Bun.file(args.path).text(), args.path])
      if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
        throw new Error("Solid component could not be compiled")
      return { contents: result.code, loader: "ts" }
    })
  },
})
const { default: StudioBoard } = await import("./studio-board")
const { PlatformProvider } = await import("@/context/platform")

// Happy DOM has SVG points but does not implement their matrix transform.
const pointPrototype = Object.getPrototypeOf(
  document.createElementNS("http://www.w3.org/2000/svg", "svg").createSVGPoint(),
)
Object.defineProperty(pointPrototype, "matrixTransform", {
  configurable: true,
  value(this: DOMPoint, matrix: DOMMatrix) {
    return new DOMPoint(
      matrix.a * this.x + matrix.c * this.y + matrix.e,
      matrix.b * this.x + matrix.d * this.y + matrix.f,
    )
  },
})
afterAll(() => {
  delete pointPrototype.matrixTransform
})

async function setup(
  options: {
    failure?: boolean
    reject?: number | "save" | "network"
    seedream?: boolean
    backup?: boolean
    accepted?: boolean
    concurrent?: boolean
    reboot?: boolean
    running?: boolean
    rebootResponse?: Promise<Response>
    fresh?: boolean
    demo?: boolean
    document?: BoardDocument
    revision?: number
    userIdx?: string
    createResponse?: Promise<string | undefined>
    creationFailures?: number
    saveFailures?: number
    saveResponse?: Promise<void>
    loadFailures?: number
    acceptResponse?: Promise<void>
    readbackFailures?: number
    acceptedRunning?: boolean
    backupReboot?: boolean
    backupValue?: string
    backupReadFailures?: number
    uploadResponses?: Promise<Response>[]
    unmountOnExit?: boolean
  } = {},
) {
  const requests: BoardGenerationRequest[] = []
  const saves: { revision: number; document: BoardDocument }[] = []
  const rebootRequests: string[] = []
  const creations: string[] = []
  const bindings: string[] = []
  const exits: string[] = []
  const uploads: string[] = []
  const loads: string[] = []
  let creationFailures = options.creationFailures ?? 0
  let saveFailures = options.saveFailures ?? 0
  let loadFailures = options.loadFailures ?? 0
  let readbackFailures = options.readbackFailures ?? 0
  let backupReadFailures = options.backupReadFailures ?? 0
  const operationID = crypto.randomUUID()
  const stored = { document: options.document ?? emptyBoard(), revision: options.revision ?? 0 }
  const failed = {
    id: "old-failed",
    status: "failed",
    capability: "image.generate",
    provider: "internel",
    model: "seedream-5-pro",
    taskId: "provider-old",
    prompt: "原始提示词",
    error: "原任务失败原因",
    images: [],
    createdAt: 1,
  }
  if (options.failure) {
    const card = newBoardCard("failed-card", "image")
    card.draft.prompt = "新提示词"
    card.currentGenerationID = failed.id
    card.taskLinks.push({
      generationID: failed.id,
      submissionID: crypto.randomUUID(),
      visible: true,
      snapshot: { prompt: failed.prompt, settings: { ...card.draft.settings }, references: [] },
    })
    stored.document.cards.push(card)
  }
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://board.test").pathname
        if (path.endsWith("/permissions/check"))
          return Response.json({ code: 200, data: [true, options.seedream ?? true, false] })
        if (path.endsWith("/board")) {
          if (init?.method !== "PUT") loads.push(path)
          if (init?.method !== "PUT" && loadFailures > 0) {
            loadFailures--
            return Response.json({ error: "画板读取失败" }, { status: 503 })
          }
          if (init?.method !== "PUT" && requests.length && readbackFailures > 0) {
            readbackFailures--
            return Response.json({ error: "任务关联读取失败" }, { status: 503 })
          }
          if (init?.method === "PUT") {
            if (options.saveResponse) await options.saveResponse
            if (saveFailures > 0) {
              saveFailures--
              return Response.json({ error: "画板写入失败" }, { status: 503 })
            }
            if (options.reject === "save") return Response.json({ error: "保存冲突" }, { status: 409 })
            const body = JSON.parse(String(init.body)) as { revision: number; document: BoardDocument }
            saves.push(body)
            if (body.revision !== stored.revision) return Response.json({ error: "画板版本冲突" }, { status: 409 })
            stored.document = BoardDocument.parse(body.document)
            stored.revision++
          }
          return Response.json({
            sessionID: "test-board",
            ...stored,
            pendingReboots:
              options.reboot &&
              rebootRequests.length === 0 &&
              stored.document.cards.some((card) => card.id === "failed-card")
                ? [{ cardID: "failed-card", generationID: failed.id, operationID }]
                : [],
          })
        }
        if (path === "/studio/generations") {
          requests.push(JSON.parse(String(init?.body)) as (typeof requests)[number])
          if (options.reject === "network") throw new TypeError("网络中断")
          if (options.accepted) {
            const submission = requests.at(-1)!.board
            const previous = stored.document.cards.some((card) =>
              card.taskLinks.some((link) => link.submissionID === submission.submissionID),
            )
            if (previous)
              return Response.json({
                ...failed,
                id: "accepted-new",
                status: options.acceptedRunning ? "running" : "failed",
              })
            if (submission.revision !== stored.revision)
              return Response.json({ error: "提交版本冲突" }, { status: 409 })
            const card = stored.document.cards.find((card) => card.id === submission.cardID)!
            card.currentGenerationID = "accepted-new"
            card.taskLinks = card.taskLinks.map((link) =>
              link.generationID === submission.replacedGenerationID ? { ...link, visible: false } : link,
            )
            card.taskLinks.push({
              generationID: "accepted-new",
              submissionID: submission.submissionID,
              visible: true,
              snapshot: submission.snapshot,
            })
            stored.revision++
            if (options.concurrent) {
              card.draft.prompt = "其他窗口的提示词"
              card.position = { x: 400, y: 500 }
              stored.revision++
            }
            if (options.acceptResponse) await options.acceptResponse
            return Response.json({
              ...failed,
              id: "accepted-new",
              status: options.acceptedRunning ? "running" : "failed",
            })
          }
          return Response.json(
            { error: "测试拒绝" },
            { status: typeof options.reject === "number" ? options.reject : 400 },
          )
        }
        if (path === "/studio/generations/old-failed")
          return Response.json(options.running ? { ...failed, status: "running", progress: 20 } : failed)
        if (path === "/studio/generations/accepted-new")
          return Response.json({
            ...failed,
            id: "accepted-new",
            status: options.acceptedRunning ? "running" : "failed",
          })
        if (path === "/studio/generations/source-success")
          return Response.json({
            ...failed,
            id: "source-success",
            status: "succeeded",
            images: [{ id: "source-image", url: "https://example.test/source.png" }],
          })
        if (path === "/studio/generations/old-failed/reboot") {
          rebootRequests.push(new URL(String(input)).searchParams.get("operationID") ?? "")
          if (options.rebootResponse) return options.rebootResponse
          return Response.json(failed)
        }
        if (path === "/artifact/upload") {
          uploads.push(String(init?.body))
          return (
            options.uploadResponses?.[uploads.length - 1] ??
            Response.json({ path: "/test/.octo/test-board/uploads/frame.png" })
          )
        }
        return Response.json({})
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  localStorage.clear()
  if (options.backup) {
    const document = structuredClone(stored.document)
    document.cards[0].draft.prompt = "未保存的本地草稿"
    localStorage.setItem(
      `studio.board.backup:http://board.test:/test:${options.fresh ? "new" : "test-board"}`,
      JSON.stringify({
        creationID: crypto.randomUUID(),
        revision: 0,
        document,
        suppressed: [],
        reboots: options.backupReboot ? [{ cardID: "failed-card", operationID }] : [],
        pending: [],
      }),
    )
  }
  if (options.backupValue)
    localStorage.setItem(
      `studio.board.backup:http://board.test:/test:${options.fresh ? "new" : "test-board"}`,
      options.backupValue,
    )
  clearStudioPermissionCache()
  await ensureStudioPermission({ url: "http://board.test" }, "current-user")
  const getItem = localStorage.getItem
  if (options.backupReadFailures)
    Object.defineProperty(localStorage, "getItem", {
      configurable: true,
      writable: true,
      value: (key: string) => {
        if (
          key === `studio.board.backup:http://board.test:/test:${options.fresh ? "new" : "test-board"}` &&
          backupReadFailures > 0
        ) {
          backupReadFailures--
          throw new DOMException("Storage temporarily unavailable", "SecurityError")
        }
        return getItem.call(localStorage, key)
      },
    })
  const container = document.createElement("div")
  document.body.append(container)
  const noop = () => {}
  const unmount = render(
    () =>
      createComponent(PlatformProvider, {
        value: {
          platform: "web",
          openLink: noop,
          restart: async () => {},
          back: noop,
          forward: noop,
          notify: async () => {},
        },
        get children() {
          return createComponent(StudioBoard, {
            directory: "/test",
            http: { url: "http://board.test" },
            sessionID: options.fresh ? undefined : "test-board",
            demo: options.demo,
            get userIdx() {
              return options.userIdx ?? "current-user"
            },
            createSession: async (id) => {
              creations.push(id)
              if (creationFailures > 0) {
                creationFailures--
                throw new Error("创建画布会话失败")
              }
              return options.createResponse ?? "test-board"
            },
            onSessionCreated: (id) => bindings.push(id),
            onExit: () => {
              exits.push(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board") ?? "")
              if (options.unmountOnExit) unmount()
            },
            onRetryPermission: noop,
          })
        },
      }),
    container,
  )
  await Bun.sleep(30)
  return {
    container,
    requests,
    stored,
    saves,
    rebootRequests,
    operationID,
    creations,
    bindings,
    exits,
    uploads,
    loads,
    dispose: () => {
      unmount()
      container.remove()
      if (options.backupReadFailures)
        Object.defineProperty(localStorage, "getItem", { configurable: true, writable: true, value: getItem })
      fetch.mockRestore()
      clearStudioPermissionCache()
      localStorage.clear()
    },
  }
}

function button(container: HTMLElement, label: string) {
  const value = Array.from(container.querySelectorAll("button")).find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  )
  if (!value) throw new Error(`Missing button: ${label}. ${container.textContent}`)
  return value
}

test.each([false, true])("exit waits for every reference upload, including when one fails=%s", async (failure) => {
  const response = Promise.withResolvers<Response>()
  const value = await setup({
    uploadResponses: [
      Promise.resolve(
        failure
          ? Response.json({ error: "第一张上传失败" }, { status: 503 })
          : Response.json({ path: "/test/.octo/test-board/uploads/first.png" }),
      ),
      response.promise,
    ],
    unmountOnExit: true,
  })
  const saved = await (async () => {
    try {
      button(value.container, "新建图片卡片").click()
      await Bun.sleep(30)
      button(value.container, "引用参考").click()
      button(value.container, "上传参考图").click()
      const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
      const transfer = new DataTransfer()
      transfer.items.add(new File(["first"], "first.png", { type: "image/png" }))
      transfer.items.add(new File(["second"], "second.png", { type: "image/png" }))
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await Bun.sleep(30)
      expect(value.uploads).toHaveLength(2)
      expect(value.container.textContent).toContain("上传中")
      const exit = button(value.container, "← 退出画布")
      exit.click()
      exit.click()
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await Bun.sleep(30)
      expect(exit.disabled).toBe(true)
      expect(value.exits).toHaveLength(0)
      expect(value.uploads).toHaveLength(2)
      response.resolve(Response.json({ path: "/test/.octo/test-board/uploads/second.png" }))
      await Bun.sleep(50)
      expect(value.exits).toHaveLength(1)
      expect(value.container.children).toHaveLength(0)
      const assets = value.stored.document.cards[0].draft.assets
      expect(assets).toHaveLength(failure ? 1 : 2)
      expect(assets.some((asset) => asset.url.endsWith("/second.png"))).toBe(true)
      expect(JSON.parse(value.exits[0]).document.cards[0].draft.assets).toEqual(assets)
      return structuredClone(value.stored.document)
    } finally {
      response.resolve(Response.json({ path: "/test/.octo/test-board/uploads/second.png" }))
      value.dispose()
    }
  })()
  const reopened = await setup({ document: saved })
  try {
    reopened.container
      .querySelector(".x6-node")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    expect(reopened.container.querySelectorAll(".studio-board-references img")).toHaveLength(failure ? 1 : 2)
  } finally {
    reopened.dispose()
  }
})

test("video frame upload finishes registration before exit saves and unmounts", async () => {
  const response = Promise.withResolvers<Response>()
  const value = await setup({ uploadResponses: [response.promise], unmountOnExit: true })
  try {
    button(value.container, "新建视频卡片").click()
    button(value.container, "＋ 上传首帧").click()
    const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const transfer = new DataTransfer()
    transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
    input.files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Bun.sleep(30)
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    expect(value.exits).toHaveLength(0)
    response.resolve(Response.json({ path: "/test/.octo/test-board/uploads/frame.png" }))
    await Bun.sleep(50)
    expect(value.exits).toHaveLength(1)
    expect(value.stored.document.cards[0].draft).toMatchObject({
      assets: [{ role: "firstFrame" }],
      settings: { videoMode: "first_last_frame" },
    })
  } finally {
    response.resolve(Response.json({}))
    value.dispose()
  }
})

test("an unresolved frame edge still disables uploading into the same slot", async () => {
  const source = newBoardCard("unloaded-source", "image")
  source.cover = { generationID: "unloaded-generation", mediaID: "unloaded-image" }
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [source, newBoardCard("video", "video")],
      draftEdges: [{ id: "frame-edge", sourceID: source.id, targetID: "video", role: "firstFrame" }],
    },
  })
  try {
    // X6 mounts nodes asynchronously; wait for the expected DOM under load.
    for (let attempt = 0; attempt < 50 && value.container.querySelectorAll(".x6-node").length < 2; attempt++)
      await Bun.sleep(10)
    expect(value.container.querySelectorAll(".x6-node")).toHaveLength(2)
    value.container
      .querySelectorAll(".x6-node")[1]
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    expect(value.container.querySelectorAll(".studio-board-references img")).toHaveLength(0)
    expect(button(value.container, "＋ 上传首帧").disabled).toBe(true)
    expect(button(value.container, "＋ 上传尾帧").disabled).toBe(false)
    expect(value.uploads).toHaveLength(0)
  } finally {
    value.dispose()
  }
})

test("historical preview leaves the current failed task reboot available", async () => {
  const card = newBoardCard("history-card", "image")
  card.currentGenerationID = "old-failed"
  card.cover = { generationID: "source-success", mediaID: "source-image" }
  card.taskLinks = ["source-success", "old-failed"].map((generationID) => ({
    generationID,
    submissionID: crypto.randomUUID(),
    visible: true,
    snapshot: { prompt: "原始提示词", settings: { ...card.draft.settings }, references: [] },
  }))
  const value = await setup({ document: { ...emptyBoard(), cards: [card] } })
  try {
    expect(button(value.container, "重新生成").disabled).toBe(false)
    button(value.container, "查看结果 1").click()
    button(value.container, "预览").click()
    button(value.container, "关闭").click()
    expect(value.container.querySelector(".studio-board-card-media img")).not.toBeNull()
    expect(value.container.textContent).not.toContain("原任务失败原因")
    expect(button(value.container, "重新生成").disabled).toBe(false)
    button(value.container, "重新生成").click()
    await Bun.sleep(30)
    expect(value.rebootRequests).toHaveLength(1)
    expect(value.requests).toHaveLength(0)
    expect(value.stored.document.cards[0].currentGenerationID).toBe("old-failed")
    expect(value.container.textContent).toContain("原任务失败原因")
  } finally {
    value.dispose()
  }
})

test.each(["图片", "视频"])(
  "creating the first empty %s card saves and can reopen without generating",
  async (kind) => {
    const value = await setup({ fresh: true })
    const document = await (async () => {
      try {
        await Bun.sleep(550)
        expect(value.creations).toEqual([])
        expect(value.saves).toEqual([])
        button(value.container, `新建${kind}卡片`).click()
        await Bun.sleep(30)
        expect(value.creations).toHaveLength(1)
        expect(value.bindings).toEqual(["test-board"])
        expect(value.saves).toHaveLength(1)
        expect(value.stored.document.cards).toHaveLength(1)
        expect(value.stored.document.cards[0].draft.prompt).toBe("")
        expect(value.stored.document.cards[0].taskLinks).toEqual([])
        expect(value.stored.document.cards[0].kind).toBe(kind === "图片" ? "image" : "video")
        expect(value.requests).toEqual([])
        expect(localStorage.getItem("studio.board.backup:http://board.test:/test:new")).toBeNull()
        return structuredClone(value.stored.document)
      } finally {
        value.dispose()
      }
    })()
    const reopened = await setup({ document })
    try {
      expect(reopened.container.querySelectorAll(".x6-node")).toHaveLength(1)
      expect(reopened.stored.document).toEqual(document)
      expect(reopened.creations).toEqual([])
      expect(reopened.requests).toEqual([])
    } finally {
      reopened.dispose()
    }
  },
)

test("extracted card views keep one composer across selection, then dispose a removed card", async () => {
  const value = await setup()
  try {
    button(value.container, "新建图片卡片").click()
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(30)
    const first = value.container.querySelectorAll(".x6-node")[0]
    const article = first.querySelector("article")!
    const selectCard = (title: string) => {
      const node = Array.from(value.container.querySelectorAll(".studio-board-card"))
        .find((card) => card.getAttribute("aria-label") === title)!
        .closest(".x6-node")!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    }
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "第二张卡片的草稿"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    first.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("第二张卡片的草稿")
    expect(value.container.querySelectorAll(".studio-board-composer")).toHaveLength(1)
    selectCard("图片 01")
    expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("")
    button(value.container, "图片设置").click()
    expect(value.container.querySelectorAll(".studio-image-settings-menu")).toHaveLength(1)
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "2100"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "2100"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    selectCard("图片 02")
    expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("第二张卡片的草稿")
    selectCard("图片 01")
    button(value.container, "图片设置").click()
    expect(value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')?.value).toBe("2100")
    expect(value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')?.value).toBe("2100")
    article.querySelector<HTMLButtonElement>("footer button")!.click()
    expect(value.container.querySelector(".studio-board-results")?.textContent).toContain("暂无成功结果")
    button(value.container, "关闭").click()
    const removedID = value.stored.document.cards[0].id
    button(value.container, "移除图片 01").click()
    expect(article.isConnected).toBe(false)
    expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(1)
    expect(value.container.querySelectorAll(".studio-board-composer")).toHaveLength(0)
    expect(value.container.querySelector(".studio-image-settings-menu")).toBeNull()
    selectCard("图片 02")
    expect(value.container.querySelectorAll(".studio-board-composer")).toHaveLength(1)
    expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("第二张卡片的草稿")
    await Bun.sleep(550)
    expect(value.stored.document.cards).toHaveLength(1)
    expect(value.stored.document.cards[0].draft.prompt).toBe("第二张卡片的草稿")
    expect(value.stored.document.removedCardIDs).toContain(removedID)
  } finally {
    value.dispose()
  }
})

test("adding cards saves immediately while prompt edits remain debounced", async () => {
  const value = await setup({ fresh: true })
  try {
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(30)
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(30)
    expect(value.saves).toHaveLength(2)
    expect(value.stored.document.cards).toHaveLength(2)
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "连续编辑的第一段"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    await Bun.sleep(250)
    prompt.value = "连续编辑的最终内容"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    await Bun.sleep(300)
    expect(value.saves).toHaveLength(2)
    await Bun.sleep(250)
    expect(value.saves).toHaveLength(3)
    expect(value.stored.document.cards[1].draft.prompt).toBe("连续编辑的最终内容")
    expect(value.creations).toHaveLength(1)
    expect(value.requests).toEqual([])
  } finally {
    value.dispose()
  }
})

test("edits made while the first board write is in flight are saved after it finishes", async () => {
  const response = Promise.withResolvers<void>()
  const value = await setup({ fresh: true, saveResponse: response.promise })
  try {
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(30)
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "保存请求期间的修改"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    await Bun.sleep(550)
    expect(value.saves).toEqual([])
    response.resolve()
    await Bun.sleep(30)
    expect(value.saves).toHaveLength(1)
    expect(value.stored.document.cards[0].draft.prompt).toBe("")
    expect(value.container.querySelector(".studio-board-save")?.textContent).toContain("未保存")
    await Bun.sleep(550)
    expect(value.saves).toHaveLength(2)
    expect(value.stored.document.cards[0].draft.prompt).toBe("保存请求期间的修改")
    expect(value.container.querySelector(".studio-board-save")?.textContent).toContain("已保存")
    expect(value.creations).toHaveLength(1)
  } finally {
    response.resolve()
    value.dispose()
  }
})

test("restoring a temporary card draft starts autosave without requiring another card or a generation", async () => {
  const confirm = spyOn(window, "confirm").mockReturnValue(true)
  const value = await setup({
    fresh: true,
    backup: true,
    document: { ...emptyBoard(), cards: [newBoardCard("draft-card", "image")] },
  })
  try {
    await Bun.sleep(600)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(value.creations).toHaveLength(1)
    expect(value.saves).toHaveLength(1)
    expect(value.stored.document.cards[0].id).toBe("draft-card")
    expect(value.stored.document.cards[0].draft.prompt).toBe("未保存的本地草稿")
    expect(value.requests).toEqual([])
  } finally {
    value.dispose()
    confirm.mockRestore()
  }
})

test("cards added and submitted during initial creation share one session and serialized saves", async () => {
  const creation = Promise.withResolvers<string | undefined>()
  const value = await setup({ fresh: true, accepted: true, createResponse: creation.promise })
  try {
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(10)
    button(value.container, "新建图片卡片").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "会话创建期间编辑并生成"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(10)
    expect(value.creations).toHaveLength(1)
    expect(value.saves).toEqual([])
    expect(value.requests).toEqual([])
    creation.resolve("test-board")
    await Bun.sleep(30)
    expect(value.creations).toHaveLength(1)
    expect(value.bindings).toEqual(["test-board"])
    expect(value.requests).toHaveLength(1)
    expect(value.stored.document.cards).toHaveLength(2)
    expect(value.stored.document.cards[1].draft.prompt).toBe("会话创建期间编辑并生成")
    expect(value.requests[0].board.cardID).toBe(value.stored.document.cards[1].id)
    expect(value.saves.map((save) => save.revision)).toEqual([0, 1, 2])
    expect(value.requests[0].board.revision).toBe(3)
  } finally {
    creation.resolve("test-board")
    value.dispose()
  }
})

test.each(["creation", "save"])(
  "a failed first %s preserves the card backup and supports explicit retry",
  async (failure) => {
    const value = await setup({
      fresh: true,
      creationFailures: failure === "creation" ? 1 : 0,
      saveFailures: failure === "save" ? 1 : 0,
    })
    try {
      button(value.container, "新建图片卡片").click()
      await Bun.sleep(600)
      expect(value.container.textContent).toContain(failure === "creation" ? "创建画布会话失败" : "画板写入失败")
      expect(value.saves).toEqual([])
      expect(value.creations).toHaveLength(1)
      const key = `studio.board.backup:http://board.test:/test:${failure === "creation" ? "new" : "test-board"}`
      expect(JSON.parse(localStorage.getItem(key)!).document.cards).toHaveLength(1)
      button(value.container, "重试保存").click()
      await Bun.sleep(30)
      expect(value.saves).toHaveLength(1)
      expect(value.stored.document.cards).toHaveLength(1)
      expect(value.bindings).toEqual(["test-board"])
      expect(new Set(value.creations).size).toBe(1)
      expect(value.creations).toHaveLength(failure === "creation" ? 2 : 1)
      expect(value.requests).toEqual([])
    } finally {
      value.dispose()
    }
  },
)

test("adding demo cards stays in memory without creating or saving a session", async () => {
  const value = await setup({ fresh: true, demo: true })
  try {
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(600)
    expect(value.container.querySelectorAll(".x6-node")).toHaveLength(1)
    expect(value.creations).toEqual([])
    expect(value.saves).toEqual([])
    expect(value.requests).toEqual([])
    expect(localStorage.getItem("studio.board.backup:http://board.test:/test:new")).toBeNull()
  } finally {
    value.dispose()
  }
})

test("sending closes the actual settings popup and commits custom dimensions and user identity", async () => {
  const value = await setup()
  try {
    button(value.container, "新建图片卡片").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "自定义尺寸"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "图片设置").click()
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "2100"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "2100"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].extra?.userIdx).toBe("current-user")
    expect(value.requests[0].board.snapshot.settings).toMatchObject({ isCustom: true, width: 2100, height: 2100 })
    expect(value.container.querySelector('[role="dialog"]')).toBeNull()
    expect(button(value.container, "发送新任务").disabled).toBe(false)
  } finally {
    value.dispose()
  }
})

test.each([400, 409, "save"] as const)(
  "a definitive %s rejection restores the failed task and reboot action",
  async (reject) => {
    const value = await setup({ failure: true, reject })
    try {
      value.container
        .querySelector(".x6-node")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      expect(value.container.textContent).toContain("原任务失败原因")
      button(value.container, "发送新任务").click()
      await Bun.sleep(30)
      expect(value.requests).toHaveLength(reject === "save" ? 0 : 1)
      expect(value.container.textContent).toContain("原任务失败原因")
      expect(button(value.container, "重新生成").disabled).toBe(false)
      expect(value.container.textContent).not.toContain("请求结果待核对")
      expect(value.stored.document.cards[0].taskLinks[0].visible).toBe(true)
      expect(
        JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).suppressed,
      ).not.toContain("old-failed")
    } finally {
      value.dispose()
    }
  },
)

test("an uncertain submission keeps the old failure suppressed and requires reconciliation", async () => {
  const value = await setup({ failure: true, reject: "network" })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.requests).toHaveLength(1)
    expect(value.container.textContent).toContain("请求结果待核对")
    expect(value.container.textContent).not.toContain("原任务失败原因")
    expect(button(value.container, "发送新任务").disabled).toBe(true)
    expect(button(value.container, "刷新状态").disabled).toBe(false)
  } finally {
    value.dispose()
  }
})

test("video-only permission exposes separate frame uploads and submits them without an image mention entry", async () => {
  const value = await setup({ seedream: false })
  try {
    button(value.container, "新建视频卡片").click()
    expect(value.container.querySelector(".studio-composer-icon-at")).toBeNull()
    expect(button(value.container, "＋ 上传尾帧").disabled).toBe(false)
    button(value.container, "＋ 上传首帧").click()
    const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const transfer = new DataTransfer()
    transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
    input.files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Bun.sleep(30)
    expect(input.multiple).toBe(false)
    expect(button(value.container, "＋ 上传首帧").disabled).toBe(true)
    button(value.container, "＋ 上传尾帧").click()
    const last = new DataTransfer()
    last.items.add(new File(["last frame"], "last.png", { type: "image/png" }))
    input.files = last.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Bun.sleep(30)
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "从首帧开始的视频"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].board.snapshot.references).toMatchObject([
      { role: "firstFrame", title: "frame.png" },
      { role: "lastFrame", title: "last.png" },
    ])
    expect(value.requests[0].board.snapshot.settings.videoMode).toBe("first_last_frame")
  } finally {
    value.dispose()
  }
})

test("loading a board preserves its unsaved backup until the recovery choice is made", async () => {
  const value = await setup({ failure: true, backup: true })
  try {
    expect(value.container.textContent).toContain("发现本地未保存的修改")
    expect(button(value.container, "保存").disabled).toBe(true)
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    expect(prompt.disabled).toBe(true)
    expect(button(value.container, "图片设置").disabled).toBe(true)
    expect(button(value.container, "引用参考").disabled).toBe(true)
    expect(button(value.container, "移除图片").disabled).toBe(true)
    prompt.value = "恢复期间不应接受的编辑"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "← 退出画布").click()
    await Bun.sleep(600)
    expect(value.saves).toHaveLength(0)
    expect(
      JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document.cards[0]
        .draft.prompt,
    ).toBe("未保存的本地草稿")
  } finally {
    value.dispose()
  }
})

test.each([false, true])("backup read retry initializes the board with an existing session=%s", async (existing) => {
  const value = await setup({ fresh: !existing, backupReadFailures: 1 })
  try {
    expect(value.container.textContent).toContain("本地草稿备份格式异常")
    expect(button(value.container, "新建图片卡片").disabled).toBe(true)
    expect(value.loads).toEqual([])
    const retry = button(value.container, "重试")
    retry.click()
    retry.click()
    await Bun.sleep(30)
    expect(button(value.container, "新建图片卡片").disabled).toBe(false)
    expect(value.container.textContent).not.toContain("本地草稿备份格式异常")
    expect(value.loads).toHaveLength(existing ? 1 : 0)
    expect(value.creations).toEqual([])
    expect(value.saves).toEqual([])
  } finally {
    value.dispose()
  }
})

test("initialization retries preserve a malformed draft until the repaired backup can be read", async () => {
  const confirm = spyOn(window, "confirm").mockReturnValue(false)
  const backup = "{invalid draft"
  const value = await setup({ fresh: true, backupValue: backup })
  try {
    button(value.container, "重试").click()
    await Bun.sleep(30)
    expect(value.container.textContent).toContain("本地草稿备份格式异常")
    expect(button(value.container, "新建图片卡片").disabled).toBe(true)
    expect(localStorage.getItem("studio.board.backup:http://board.test:/test:new")).toBe(backup)
    expect(confirm).not.toHaveBeenCalled()
    localStorage.setItem(
      "studio.board.backup:http://board.test:/test:new",
      JSON.stringify({
        creationID: crypto.randomUUID(),
        revision: 0,
        document: emptyBoard(),
        pending: [],
      }),
    )
    button(value.container, "重试").click()
    await Bun.sleep(30)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(button(value.container, "新建图片卡片").disabled).toBe(false)
    expect(value.container.textContent).not.toContain("本地草稿备份格式异常")
    expect(value.loads).toEqual([])
    expect(value.creations).toEqual([])
    expect(value.saves).toEqual([])
  } finally {
    value.dispose()
    confirm.mockRestore()
  }
})

test("initialization retry restores a temporary draft through the original recovery flow", async () => {
  const confirm = spyOn(window, "confirm").mockReturnValue(true)
  const value = await setup({
    fresh: true,
    backup: true,
    backupReadFailures: 1,
    document: { ...emptyBoard(), cards: [newBoardCard("draft-card", "image")] },
  })
  try {
    const backup = localStorage.getItem("studio.board.backup:http://board.test:/test:new")
    expect(value.container.textContent).toContain("本地草稿备份格式异常")
    expect(confirm).not.toHaveBeenCalled()
    expect(value.creations).toEqual([])
    button(value.container, "重试").click()
    await Bun.sleep(30)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(value.container.querySelectorAll(".x6-node")).toHaveLength(1)
    expect(value.creations).toEqual([])
    expect(value.loads).toEqual([])
    expect(JSON.parse(backup!).document.cards[0].draft.prompt).toBe("未保存的本地草稿")
    await Bun.sleep(600)
    expect(value.creations).toHaveLength(1)
    expect(value.saves).toHaveLength(1)
    expect(value.stored.document.cards[0].draft.prompt).toBe("未保存的本地草稿")
  } finally {
    value.dispose()
    confirm.mockRestore()
  }
})

test.each(["恢复草稿", "保留服务端版本"])(
  "%s deliberately replaces the backup while retaining server task history",
  async (choice) => {
    const value = await setup({ failure: true, backup: true })
    try {
      const history = structuredClone(value.stored.document.cards[0].taskLinks)
      button(value.container, choice).click()
      await Bun.sleep(600)
      const expected = choice === "恢复草稿" ? "未保存的本地草稿" : "新提示词"
      expect(value.container.textContent).not.toContain("发现本地未保存的修改")
      expect(value.stored.document.cards[0].draft.prompt).toBe(expected)
      expect(value.stored.document.cards[0].taskLinks).toEqual(history)
      expect(
        JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document.cards[0]
          .draft.prompt,
      ).toBe(expected)
      value.container
        .querySelector(".x6-node")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
      expect(prompt.disabled).toBe(false)
      expect(prompt.value).toBe(expected)
      prompt.value = "恢复完成后的编辑"
      prompt.dispatchEvent(new Event("input", { bubbles: true }))
      button(value.container, "保存").click()
      await Bun.sleep(30)
      expect(value.stored.document.cards[0].draft.prompt).toBe("恢复完成后的编辑")
    } finally {
      value.dispose()
    }
  },
)

test("a newer revision after acceptance blocks autosave and allows explicit draft recovery", async () => {
  const value = await setup({ failure: true, accepted: true, concurrent: true })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(700)
    expect(value.requests).toHaveLength(1)
    expect(value.saves).toHaveLength(1)
    expect(value.stored.document.cards[0].draft.prompt).toBe("其他窗口的提示词")
    expect(value.stored.document.cards[0].position).toEqual({ x: 400, y: 500 })
    expect(value.container.textContent).toContain("画板已被其他窗口更新")
    expect(button(value.container, "发送新任务").disabled).toBe(true)
    button(value.container, "重新加载").click()
    await Bun.sleep(30)
    expect(value.container.textContent).toContain("发现本地未保存的修改")
    expect(
      JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document.cards[0]
        .draft.prompt,
    ).toBe("新提示词")
    button(value.container, "保留服务端版本").click()
    await Bun.sleep(600)
    expect(value.saves).toHaveLength(1)
    expect(value.stored.document.cards[0].draft.prompt).toBe("其他窗口的提示词")
  } finally {
    value.dispose()
  }
})

test("the expected attachment revision releases submission without creating an extra save", async () => {
  const value = await setup({ failure: true, accepted: true })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(700)
    expect(value.requests).toHaveLength(1)
    expect(value.saves).toHaveLength(1)
    expect(value.container.textContent).not.toContain("其他窗口")
    expect(button(value.container, "发送新任务").disabled).toBe(false)
    expect(value.stored.document.cards[0].taskLinks.map((link) => link.visible)).toEqual([false, true])
  } finally {
    value.dispose()
  }
})

test("server pending reboots restore the original reconciliation operation without a local backup", async () => {
  const value = await setup({ failure: true, reboot: true })
  try {
    expect(value.container.textContent).toContain("请求结果待核对")
    button(value.container, "刷新状态").click()
    await Bun.sleep(30)
    expect(value.rebootRequests).toEqual([value.operationID])
    expect(value.container.textContent).not.toContain("请求结果待核对")
    expect(button(value.container, "重新生成").disabled).toBe(false)
  } finally {
    value.dispose()
  }
})

test.each(["reboot", "running", "submission"] as const)(
  "reload drops a removed card's %s lock and allows new work",
  async (kind) => {
    const value = await setup({
      failure: true,
      reboot: kind === "reboot",
      running: kind === "running",
      reject: kind === "submission" ? "network" : undefined,
    })
    try {
      if (kind === "submission") {
        value.container
          .querySelector(".x6-node")!
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
        button(value.container, "发送新任务").click()
        await Bun.sleep(30)
        expect(value.container.textContent).toContain("请求结果待核对")
      }
      value.stored.document.cards = []
      value.stored.revision++
      button(value.container, "← 退出画布").click()
      await Bun.sleep(30)
      button(value.container, "重新加载").click()
      await Bun.sleep(30)
      button(value.container, "保留服务端版本").click()
      expect(value.container.querySelector(".x6-node")).toBeNull()
      expect(value.container.textContent).not.toContain("刷新状态")
      expect(button(value.container, "保存").disabled).toBe(false)
      button(value.container, "新建图片卡片").click()
      const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
      prompt.value = "删除旧卡片后的新任务"
      prompt.dispatchEvent(new Event("input", { bubbles: true }))
      expect(button(value.container, "发送新任务").disabled).toBe(false)
      button(value.container, "保存").click()
      await Bun.sleep(30)
      const backup = JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!)
      expect(backup.pending).toEqual([])
      expect(backup.reboots).toEqual([])
      expect(value.stored.document.cards).toHaveLength(1)
    } finally {
      value.dispose()
    }
  },
)

test("reload retains an existing card's uncertain reboot and original operation ID", async () => {
  const value = await setup({ failure: true, reboot: true })
  try {
    value.stored.revision++
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    button(value.container, "重新加载").click()
    await Bun.sleep(30)
    expect(value.container.textContent).toContain("请求结果待核对")
    expect(button(value.container, "保存").disabled).toBe(true)
    button(value.container, "刷新状态").click()
    await Bun.sleep(30)
    expect(value.rebootRequests).toEqual([value.operationID])
    expect(button(value.container, "保存").disabled).toBe(false)
  } finally {
    value.dispose()
  }
})

test("a late reboot response cannot restore the lock of a remotely removed card", async () => {
  const response = Promise.withResolvers<Response>()
  const value = await setup({ failure: true, reboot: true, rebootResponse: response.promise })
  try {
    button(value.container, "刷新状态").click()
    await Bun.sleep(10)
    value.stored.document.cards = []
    value.stored.revision++
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    button(value.container, "重新加载").click()
    await Bun.sleep(30)
    button(value.container, "保留服务端版本").click()
    response.resolve(Response.json({ error: "仍待核对" }, { status: 409 }))
    await Bun.sleep(30)
    expect(button(value.container, "保存").disabled).toBe(false)
    const backup = JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!)
    expect(backup.reboots).toEqual([])
  } finally {
    response.resolve(Response.json({}))
    value.dispose()
  }
})

test.each(["恢复草稿", "保留服务端版本"])(
  "a failed initial load preserves the backup until a successful retry and %s",
  async (choice) => {
    const value = await setup({ failure: true, backup: true, loadFailures: 2 })
    try {
      const key = "studio.board.backup:http://board.test:/test:test-board"
      const original = localStorage.getItem(key)
      expect(value.container.textContent).toContain("画板读取失败")
      expect(value.container.textContent).not.toContain("恢复草稿")
      expect(button(value.container, "保存").disabled).toBe(true)
      button(value.container, "新建图片卡片").click()
      button(value.container, "重试").click()
      await Bun.sleep(600)
      expect(value.container.textContent).toContain("画板读取失败")
      expect(value.container.textContent).not.toContain("恢复草稿")
      expect(localStorage.getItem(key)).toBe(original)
      expect(value.saves).toHaveLength(0)
      button(value.container, "重试").click()
      await Bun.sleep(30)
      expect(value.container.textContent).toContain("恢复草稿")
      expect(localStorage.getItem(key)).toBe(original)
      button(value.container, choice).click()
      await Bun.sleep(600)
      expect(value.stored.document.cards[0].draft.prompt).toBe(choice === "恢复草稿" ? "未保存的本地草稿" : "新提示词")
      expect(value.stored.document.cards[0].taskLinks).toHaveLength(1)
    } finally {
      value.dispose()
    }
  },
)

test("a failed initial load retains reboot metadata for reconciliation after retry", async () => {
  const value = await setup({ failure: true, backup: true, backupReboot: true, loadFailures: 1 })
  try {
    button(value.container, "重试").click()
    await Bun.sleep(30)
    expect(value.container.textContent).toContain("请求结果待核对")
    button(value.container, "恢复草稿").click()
    await Bun.sleep(30)
    button(value.container, "刷新状态").click()
    await Bun.sleep(30)
    expect(value.rebootRequests).toEqual([value.operationID])
    expect(value.container.textContent).not.toContain("请求结果待核对")
  } finally {
    value.dispose()
  }
})

test.each([false, true])(
  "adding a card waits for submission attachment, then saves while running=%s",
  async (running) => {
    const accepted = Promise.withResolvers<void>()
    const value = await setup({
      failure: true,
      accepted: true,
      acceptResponse: accepted.promise,
      acceptedRunning: running,
    })
    try {
      value.container
        .querySelector(".x6-node")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      button(value.container, "发送新任务").click()
      await Bun.sleep(30)
      expect(value.stored.revision).toBe(2)
      button(value.container, "新建图片卡片").click()
      await Bun.sleep(30)
      expect(value.saves).toHaveLength(1)
      expect(value.container.textContent).not.toContain("冲突")
      const backup = JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!)
      expect(backup.document.cards).toHaveLength(2)
      accepted.resolve()
      await Bun.sleep(30)
      expect(value.stored.document.cards).toHaveLength(2)
      expect(value.saves.map((save) => save.revision)).toEqual([0, 2])
      expect(value.container.textContent).not.toContain("冲突")
      expect(value.requests).toHaveLength(1)
      expect(value.stored.document.cards[0].currentGenerationID).toBe("accepted-new")
    } finally {
      accepted.resolve()
      value.dispose()
    }
  },
)

test.each(["network", "readback"])(
  "a %s uncertainty defers card writes until the same submission is reconciled",
  async (kind) => {
    const options: NonNullable<Parameters<typeof setup>[0]> = {
      failure: true,
      accepted: kind === "readback",
      reject: kind === "network" ? "network" : undefined,
      readbackFailures: kind === "readback" ? 1 : 0,
      userIdx: "original-user",
    }
    const value = await setup(options)
    try {
      value.container
        .querySelector(".x6-node")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      button(value.container, "发送新任务").click()
      await Bun.sleep(30)
      expect(value.container.textContent).toContain("请求结果待核对")
      const submissionID = value.requests[0].board.submissionID
      button(value.container, "新建图片卡片").click()
      await Bun.sleep(550)
      expect(value.saves).toHaveLength(1)
      expect(value.container.textContent).not.toContain("冲突")
      options.reject = undefined
      options.accepted = true
      options.userIdx = "another-user"
      button(value.container, "刷新状态").click()
      await Bun.sleep(600)
      expect(value.requests.map((request) => request.board.submissionID)).toEqual([submissionID, submissionID])
      expect(value.requests[1]).toEqual(value.requests[0])
      expect(value.requests[1].extra?.userIdx).toBe("original-user")
      expect(value.stored.document.cards).toHaveLength(2)
      expect(value.stored.document.cards[0].taskLinks).toHaveLength(2)
      expect(value.container.textContent).not.toContain("请求结果待核对")
      expect(value.container.textContent).not.toContain("冲突")
    } finally {
      value.dispose()
    }
  },
)

test("the board model menu reads the shared active configuration", async () => {
  const value = await setup({ seedream: true })
  try {
    button(value.container, "新建图片卡片").click()
    button(value.container, styleModelLabel(defaultStudioStyleModel())).click()
    STUDIO_STYLE_MODEL_CONFIG.forEach((model) => {
      expect(button(value.container, model.label)).toBeDefined()
    })
    expect(value.container.querySelector(".studio-menu")?.textContent).not.toContain("Seedream 5.0 Lite")
    button(value.container, "千问").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "统一配置模型"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.requests[0].board.snapshot.settings.styleModel).toBe("qwen")
  } finally {
    value.dispose()
  }
})

test.each([2100, 1280])("switching a %spx custom size to Qwen keeps only valid settings", async (size) => {
  const value = await setup()
  try {
    button(value.container, "新建图片卡片").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "切换模型后的尺寸"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "图片设置").click()
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = String(size)
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = String(size)
    height.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "Seedream 5.0 Pro").click()
    button(value.container, "千问").click()
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].board.snapshot.settings.styleModel).toBe("qwen")
    expect(value.requests[0].board.snapshot.settings.isCustom).toBe(size === 1280)
    expect(value.requests[0].board.snapshot.settings.width).toBe(size === 1280 ? 1280 : undefined)
    expect(value.requests[0].board.snapshot.settings.height).toBe(size === 1280 ? 1280 : undefined)
  } finally {
    value.dispose()
  }
})

test("legacy invalid custom drafts are repaired without rewriting task snapshots", async () => {
  const card = newBoardCard("legacy-card", "image")
  card.draft.settings = { ...card.draft.settings, styleModel: "qwen", isCustom: true }
  card.taskLinks = [
    {
      generationID: "old-failed",
      submissionID: crypto.randomUUID(),
      visible: true,
      snapshot: { prompt: "原始任务", settings: { ...card.draft.settings }, references: [] },
    },
  ]
  const value = await setup({ document: { ...emptyBoard(), cards: [card] } })
  try {
    await Bun.sleep(600)
    expect(value.stored.document.cards[0].draft.settings.isCustom).toBe(false)
    expect(value.stored.document.cards[0].taskLinks[0].snapshot.settings.isCustom).toBe(true)
    expect(value.container.textContent).not.toContain("读取失败")
  } finally {
    value.dispose()
  }
})

test.each(["network", "readback", "reboot"] as const)(
  "exit backs up a %s uncertainty and reopens with the original operation",
  async (kind) => {
    const value = await setup({
      failure: true,
      reject: kind === "network" ? "network" : undefined,
      accepted: kind === "readback",
      readbackFailures: kind === "readback" ? 1 : 0,
      reboot: kind === "reboot",
    })
    const saved = await (async () => {
      try {
        if (kind !== "reboot") {
          value.container
            .querySelector(".x6-node")!
            .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
          button(value.container, "发送新任务").click()
          await Bun.sleep(30)
        }
        expect(value.container.textContent).toContain("请求结果待核对")
        const writes = value.saves.length
        button(value.container, "新建图片卡片").click()
        const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
        prompt.value = "退出前尚未保存的新卡草稿"
        prompt.dispatchEvent(new Event("input", { bubbles: true }))
        button(value.container, "← 退出画布").click()
        await Bun.sleep(30)
        expect(value.exits).toHaveLength(1)
        expect(value.saves).toHaveLength(writes)
        expect(value.container.textContent).not.toContain("保存失败")
        const backup = JSON.parse(value.exits[0])
        expect(backup.document.cards[1].draft.prompt).toBe("退出前尚未保存的新卡草稿")
        expect(backup.reboots).toEqual(
          kind === "reboot" ? [{ cardID: "failed-card", operationID: value.operationID }] : [],
        )
        expect(backup.pending.map((item: BoardGenerationRequest) => item.board.submissionID)).toEqual(
          kind === "reboot" ? [] : [value.requests[0].board.submissionID],
        )
        return {
          backup: value.exits[0],
          document: structuredClone(value.stored.document),
          operationID: value.operationID,
        }
      } finally {
        value.dispose()
      }
    })()
    const reopened = await setup({ document: saved.document, backupValue: saved.backup, accepted: true })
    try {
      button(reopened.container, "恢复草稿").click()
      await Bun.sleep(30)
      if (kind !== "readback") {
        expect(reopened.container.textContent).toContain("请求结果待核对")
        button(reopened.container, "刷新状态").click()
        await Bun.sleep(30)
      }
      if (kind === "network")
        expect(reopened.requests[0].board.submissionID).toBe(JSON.parse(saved.backup).pending[0].board.submissionID)
      if (kind === "reboot") expect(reopened.rebootRequests).toEqual([saved.operationID])
      await Bun.sleep(600)
      expect(reopened.container.textContent).not.toContain("请求结果待核对")
      expect(reopened.stored.document.cards[1].draft.prompt).toBe("退出前尚未保存的新卡草稿")
    } finally {
      reopened.dispose()
    }
  },
)

test.each([false, true])(
  "reopening legacy=%s pending requests retries the complete original request",
  async (legacy) => {
    const value = await setup({ failure: true, reject: "network", userIdx: "original-user" })
    const saved = await (async () => {
      try {
        value.container
          .querySelector(".x6-node")!
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
        button(value.container, "发送新任务").click()
        await Bun.sleep(30)
        button(value.container, "← 退出画布").click()
        await Bun.sleep(30)
        expect(value.exits).toHaveLength(1)
        const backup = JSON.parse(value.exits[0])
        expect(backup.pending).toEqual(value.requests)
        if (legacy)
          backup.pending = value.requests.map((body) => ({ cardID: body.board.cardID, body, submission: body.board }))
        return {
          backup: JSON.stringify(backup),
          request: value.requests[0],
          document: structuredClone(value.stored.document),
          revision: value.stored.revision,
        }
      } finally {
        value.dispose()
      }
    })()
    const reopened = await setup({
      document: saved.document,
      revision: saved.revision,
      backupValue: saved.backup,
      accepted: true,
      userIdx: "another-user",
    })
    try {
      expect(reopened.container.textContent).toContain("请求结果待核对")
      button(reopened.container, "刷新状态").click()
      await Bun.sleep(30)
      expect(reopened.requests).toEqual([saved.request])
      expect(reopened.requests[0].extra?.userIdx).toBe("original-user")
      expect(reopened.stored.document.cards[0].currentGenerationID).toBe("accepted-new")
      expect(reopened.container.textContent).not.toContain("请求结果待核对")
    } finally {
      reopened.dispose()
    }
  },
)

test("a conflicting legacy request blocks restore and retry without overwriting the draft backup", async () => {
  const card = newBoardCard("pending-card", "image")
  card.draft.prompt = "应保留的本地输入"
  const submission: BoardSubmission = {
    cardID: card.id,
    submissionID: crypto.randomUUID(),
    revision: 0,
    snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
  }
  const backup = JSON.stringify({
    creationID: crypto.randomUUID(),
    revision: 0,
    document: { ...emptyBoard(), cards: [card] },
    pending: [
      {
        cardID: card.id,
        body: { sessionID: "test-board", capability: "image.generate", prompt: card.draft.prompt, board: submission },
        submission: { ...submission, submissionID: crypto.randomUUID() },
      },
    ],
  })
  const value = await setup({ backupValue: backup })
  try {
    expect(value.container.textContent).toContain("提交信息不一致")
    expect(button(value.container, "新建图片卡片").disabled).toBe(true)
    button(value.container, "重试").click()
    await Bun.sleep(550)
    expect(value.container.textContent).toContain("提交信息不一致")
    expect(value.requests).toEqual([])
    expect(value.saves).toEqual([])
    expect(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")).toBe(backup)
  } finally {
    value.dispose()
  }
})

test("exit waits for an in-flight submission before backing up its uncertain outcome", async () => {
  const accepted = Promise.withResolvers<void>()
  const value = await setup({ failure: true, accepted: true, acceptResponse: accepted.promise, readbackFailures: 1 })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    expect(value.exits).toEqual([])
    accepted.resolve()
    await Bun.sleep(30)
    expect(value.exits).toHaveLength(1)
    expect(JSON.parse(value.exits[0]).pending[0].board.submissionID).toBe(value.requests[0].board.submissionID)
    expect(value.saves).toHaveLength(1)
  } finally {
    accepted.resolve()
    value.dispose()
  }
})

test("an uncertain exit keeps the editor open if its backup cannot be written", async () => {
  const value = await setup({ failure: true, reject: "network" })
  const setItem = localStorage.setItem
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    Object.defineProperty(localStorage, "setItem", {
      configurable: true,
      value: () => {
        throw new DOMException("Storage is full", "QuotaExceededError")
      },
    })
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    expect(value.exits).toEqual([])
    expect(value.container.textContent).toContain("本地草稿备份失败")
    Object.defineProperty(localStorage, "setItem", { configurable: true, value: setItem })
    button(value.container, "← 退出画布").click()
    await Bun.sleep(30)
    expect(value.exits).toHaveLength(1)
  } finally {
    Object.defineProperty(localStorage, "setItem", { configurable: true, value: setItem })
    value.dispose()
  }
})

test("reboot closes and commits the settings popup before locking draft writes", async () => {
  const response = Promise.withResolvers<Response>()
  const options = { failure: true, rebootResponse: response.promise as Promise<Response> | undefined }
  const value = await setup(options)
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button(value.container, "图片设置").click()
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "2100"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "2100"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    const ratio = button(value.container, "16:9")
    button(value.container, "重新生成").click()
    expect(value.container.querySelector(".studio-image-settings-menu")).toBeNull()
    await Bun.sleep(30)
    expect(button(value.container, "图片设置").disabled).toBe(true)
    const key = "studio.board.backup:http://board.test:/test:test-board"
    const before = JSON.parse(localStorage.getItem(key)!)
    expect(before.document.cards[0].draft.settings).toMatchObject({ isCustom: true, width: 2100, height: 2100 })
    expect(before.document.cards[0].taskLinks[0].snapshot.settings.isCustom).toBe(false)
    ratio.click()
    await Bun.sleep(30)
    expect(JSON.parse(localStorage.getItem(key)!).document.cards[0].draft.settings).toEqual(
      before.document.cards[0].draft.settings,
    )
    response.resolve(Response.json({ error: "请求结果待核对" }, { status: 409 }))
    await Bun.sleep(30)
    ratio.click()
    await Bun.sleep(30)
    expect(JSON.parse(localStorage.getItem(key)!).document.cards[0].draft.settings).toEqual(
      before.document.cards[0].draft.settings,
    )
    options.rebootResponse = undefined
    button(value.container, "刷新状态").click()
    await Bun.sleep(30)
    expect(value.rebootRequests).toEqual([before.reboots[0].operationID, before.reboots[0].operationID])
    expect(button(value.container, "图片设置").disabled).toBe(false)
    button(value.container, "图片设置").click()
    button(value.container, "16:9").click()
    await Bun.sleep(30)
    const after = JSON.parse(localStorage.getItem(key)!)
    expect(after.document.cards[0].draft.settings.aspectRatio).toBe("16:9")
    expect(after.document.cards[0].taskLinks[0].snapshot).toEqual(before.document.cards[0].taskLinks[0].snapshot)
  } finally {
    response.resolve(Response.json({}))
    value.dispose()
  }
})

test("alignment guides clear when dragging ends or is interrupted and reappear on the next drag", async () => {
  const { Graph } = await import("@antv/x6")
  const captured: { graph?: InstanceType<typeof Graph> } = {}
  const original = Graph.prototype.addNode
  const addNode = spyOn(Graph.prototype, "addNode").mockImplementation(function (
    this: InstanceType<typeof Graph>,
    node: Parameters<InstanceType<typeof Graph>["createNode"]>[0] | Parameters<typeof original>[0],
    options?: Parameters<typeof original>[1],
  ) {
    captured.graph = this
    return Reflect.apply(original, this, [node, options])
  })
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [
        newBoardCard("aligned", "image", { x: 100, y: 100 }),
        newBoardCard("moving", "image", { x: 300, y: 300 }),
      ],
    },
  })
  try {
    const graph = captured.graph!
    const node = graph.getCellById("moving")!
    if (!node.isNode()) throw new Error("Expected a card node")
    ;["node:moved", "pointerup", "pointercancel", "blur"].forEach((event) => {
      node.position(103, 102)
      Reflect.apply(graph.trigger, graph, ["node:moving", { node }])
      expect(value.container.querySelectorAll(".studio-board-guide")).toHaveLength(2)
      expect(node.position()).toEqual({ x: 100, y: 100 })
      if (event === "node:moved") Reflect.apply(graph.trigger, graph, [event, { node }])
      if (event === "pointerup" || event === "pointercancel")
        document.dispatchEvent(new PointerEvent(event, { bubbles: true }))
      if (event === "blur") window.dispatchEvent(new Event(event))
      expect(value.container.querySelectorAll(".studio-board-guide")).toHaveLength(0)
    })
    await Bun.sleep(30)
    const backup = JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!)
    expect(backup.document.cards.find((card: { id: string }) => card.id === "moving").position).toEqual({
      x: 100,
      y: 100,
    })
  } finally {
    value.dispose()
    addNode.mockRestore()
  }
})

test("X6 rejects references to an operation-locked card and accepts them again after reconciliation", async () => {
  const { Graph } = await import("@antv/x6")
  const captured: { graph?: InstanceType<typeof Graph> } = {}
  const original = Graph.prototype.addNode
  const addNode = spyOn(Graph.prototype, "addNode").mockImplementation(function (
    this: InstanceType<typeof Graph>,
    node: Parameters<InstanceType<typeof Graph>["createNode"]>[0] | Parameters<typeof original>[0],
    options?: Parameters<typeof original>[1],
  ) {
    captured.graph = this
    return Reflect.apply(original, this, [node, options])
  })
  const source = newBoardCard("source-card", "image")
  source.cover = { generationID: "source-success", mediaID: "source-image" }
  source.taskLinks = [
    {
      generationID: "source-success",
      submissionID: crypto.randomUUID(),
      visible: true,
      snapshot: { prompt: "来源图", settings: source.draft.settings, references: [] },
    },
  ]
  const options: NonNullable<Parameters<typeof setup>[0]> = {
    failure: true,
    reject: "network",
    document: { ...emptyBoard(), cards: [source] },
  }
  const value = await setup(options)
  try {
    const graph = captured.graph!
    const target = graph.getCellById("failed-card")
    Reflect.apply(graph.trigger, graph, [
      "node:mousedown",
      { node: target, e: new MouseEvent("mousedown", { button: 0 }) },
    ])
    button(value.container, "发送新任务").click()
    await Bun.sleep(30)
    expect(value.container.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true)
    const validate = () =>
      Reflect.apply(graph.options.connecting.validateConnection!, graph, [
        { sourceCell: graph.getCellById(source.id), targetCell: target, sourcePort: "output", targetPort: "reference" },
      ])
    expect(validate()).toBe(false)
    const edge = graph.addEdge({
      source: { cell: source.id, port: "output" },
      target: { cell: "failed-card", port: "reference" },
    })
    Reflect.apply(graph.trigger, graph, ["edge:connected", { edge }])
    expect(graph.getCellById(edge.id)).toBeNull()
    const key = "studio.board.backup:http://board.test:/test:test-board"
    await Bun.sleep(30)
    expect(JSON.parse(localStorage.getItem(key)!).document.draftEdges).toHaveLength(0)
    options.reject = 400
    button(value.container, "刷新状态").click()
    await Bun.sleep(30)
    expect(validate()).toBe(true)
    const next = graph.addEdge({
      source: { cell: source.id, port: "output" },
      target: { cell: "failed-card", port: "reference" },
    })
    Reflect.apply(graph.trigger, graph, ["edge:connected", { edge: next }])
    await Bun.sleep(30)
    expect(JSON.parse(localStorage.getItem(key)!).document.draftEdges).toHaveLength(1)
  } finally {
    value.dispose()
    addNode.mockRestore()
  }
})
