import { STUDIO_OUTPAINT_PROMPT } from "@opencode-ai/core/studio-outpaint"
import { afterAll, expect, spyOn, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { BoardDocument, BoardSnapshot, BOARD_CUTOUT_PROMPT, BOARD_UPSCALE_PROMPT, emptyBoard, newBoardCard, type BoardSubmission } from "@opencode-ai/core/studio-board"
import { STUDIO_STYLE_MODEL_CONFIG, defaultStudioStyleModel } from "@opencode-ai/core/studio/model-availability"
import { styleModelLabel } from "../data"
import { clearStudioPermissionCache, ensureStudioPermission } from "../studio-permission-store"
import type { BoardGenerationRequest } from "./studio-board-api"
import type { StudioGenerationResult } from "../types"
import type { BoardOperation } from "./studio-board-operations"

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
const { StudioBoardCardView } = await import("./studio-board-card")
const { StudioResultCard } = await import("../studio-result-card")
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
    video?: boolean
    backup?: boolean
    accepted?: boolean
    acceptedResult?: StudioGenerationResult
    concurrent?: boolean
    reboot?: boolean
    running?: boolean
    rebootResponse?: Promise<Response>
    fresh?: boolean
    demo?: boolean
    document?: BoardDocument
    results?: Record<string, StudioGenerationResult>
    media?: Record<string, Response>
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
    header?: Pick<Parameters<typeof StudioBoard>[0], "title" | "loadSessions" | "onRenameSession" | "onSelectSession" | "onThumbnail" | "thumbnails">
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
  const downloads: string[] = []
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
        const media = options.media?.[String(input)]
        if (media) {
          downloads.push(String(input))
          return media.clone()
        }
        const path = new URL(String(input), "http://board.test").pathname
        const generation = options.results?.[path.replace("/studio/generations/", "")]
        if (generation && (!init?.method || init.method === "GET")) return Response.json(generation)
        if (path.endsWith("/permissions/check"))
          return Response.json({ code: 200, data: [options.video ?? true, options.seedream ?? true, false] })
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
                ...options.acceptedResult,
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
              ...options.acceptedResult,
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
            ...options.acceptedResult,
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
            Response.json({ path: String(init?.body).includes("inpaint-composite")
              ? "/test/.octo/test-board/uploads/composite.png" : "/test/.octo/test-board/uploads/frame.png" })
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
            ...options.header,
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
    downloads,
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
    (node) =>
      node.getAttribute("aria-label") === label ||
      node.getAttribute("title") === label ||
      node.textContent?.trim() === label,
  )
  if (!value) throw new Error(`Missing button: ${label}. ${container.textContent}`)
  return value
}

test.each(["image", "video"] as const)("%s card uses real task status without changing selection", (kind) => {
  const [state, setState] = createStore({
    card: { ...newBoardCard(`status-${kind}`, kind), currentGenerationID: "studio_gen_status" as string | undefined },
    result: {
      id: "studio_gen_status",
      status: "queued",
      capability: kind === "image" ? "image.generate" : "video.generate",
      provider: "internel",
      taskId: "provider-task",
      model: "seedream-5-pro",
      prompt: "状态测试",
      aspectRatio: "1:1",
      images: [],
      order: 5,
      progress: 0,
      createdAt: 1,
    } as StudioGenerationResult,
    operation: undefined as BoardOperation | undefined,
  })
  const actions: string[] = []
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () =>
      createComponent(StudioBoardCardView, {
        get card() {
          return state.card
        },
        get results() {
          return { [state.result.id]: state.result }
        },
        get operation() {
          return state.operation
        },
        get locked() {
          return (
            !!state.operation ||
            (["creating", "queued", "running", "abnormal"].includes(state.result.status) &&
              !!state.card.currentGenerationID)
          )
        },
        get editingBlocked() {
          return this.locked
        },
        selected: false,
        historyCover: false,
        failureSuppressed: false,
        rebootBlocked: false,
        mediaURL: (url) => url,
        onOperate: (action) => actions.push(action),
        onRefresh: () => actions.push("refresh"),
        onRemove: () => actions.push("remove"),
        onResults: () => actions.push("results"),
        onPlay: () => {},
      }),
    container,
  )
  const conversation = document.createElement("div")
  const disposeConversation = render(
    () =>
      createComponent(StudioResultCard, {
        get turn() {
          return {
            id: "status-turn",
            userText: "",
            assistantText: "",
            result: state.result,
            createdAt: 1,
            isLatest: true,
          }
        },
        busy: false,
        actionBusy: false,
        cancelling: false,
        rebooting: false,
        refreshing: false,
        onCancelGeneration: () => {},
        onEditGeneration: () => {},
        onRebootGeneration: () => {},
        onRefreshGeneration: () => {},
        onSelectImage: () => {},
      }),
    conversation,
  )
  try {
    const toolbar = () => container.querySelector(".studio-board-card-task-actions")!
    const title = () => container.querySelector(".studio-board-card-task-title")?.textContent
    expect(toolbar().textContent).toContain("当前排队 5 人")
    expect(container.textContent).not.toContain("预计")
    expect(title()).toBe("正在创作中…")
    setState("result", "order", 0)
    expect(toolbar().textContent).toContain("当前排队 0 人")
    expect(conversation.querySelector(".studio-result-queue-count")?.textContent).toBe("当前排队 0 人")
    setState("result", "order", undefined)
    expect(toolbar().textContent).toContain("排队中")
    expect(toolbar().textContent).not.toContain("人")
    expect(conversation.querySelector(".studio-result-queue-count")?.textContent).toBe("排队中")
    setState("result", { status: "running", progress: 49.6 })
    expect(toolbar().textContent).toContain("50%")
    expect(conversation.querySelector(".studio-result-progress-percent")?.textContent).toBe("50%")
    setState("result", "progress", 150)
    expect(toolbar().textContent).toContain("100%")
    setState("result", "progress", undefined)
    expect(toolbar().textContent).not.toContain("%")
    button(container, "取消生成").click()
    expect(actions).toEqual(["cancel"])
    setState("operation", "cancelling")
    expect(button(container, "取消生成").disabled).toBe(true)
    expect(title()).toBe("取消中…")
    expect(container.textContent).not.toContain("生成失败")
    setState("operation", "unknown")
    expect(title()).toBe("请求结果待核对")
    expect(container.textContent).not.toContain("生成失败")
    button(container, "刷新状态").click()
    expect(actions).toEqual(["cancel", "refresh"])
    setState("operation", undefined)
    setState("result", { status: "abnormal", error: "轮询原始错误不应作为失败展示" })
    expect(container.textContent).not.toContain("轮询原始错误不应作为失败展示")
    expect(title()).toBe("请求结果待核对")
    setState("result", { status: "failed", error: "供应商返回的实际失败原因" })
    expect(title()).toBe("生成失败")
    expect(container.querySelector(".studio-board-card-task-reason")?.textContent).toBe("供应商返回的实际失败原因")
    expect(conversation.querySelector(".studio-result-error")?.textContent?.trim()).toBe("供应商返回的实际失败原因")
    button(container, "重新生成").click()
    expect(actions).toEqual(["cancel", "refresh", "reboot"])
    setState("result", "rawStatus", "4")
    expect(container.querySelector(".studio-board-card-task-reason")?.textContent).toBe("用户取消生成")
    expect(conversation.querySelector(".studio-result-error")?.textContent?.trim()).toBe("用户取消生成")
    setState("result", { status: "create_failed", taskId: undefined })
    expect(container.querySelector(".studio-board-card-task-actions")).toBeNull()
    expect(container.querySelector(".studio-board-card-task-reason")?.textContent).toBe("用户取消生成")
    expect(container.querySelector(".studio-board-card")?.classList.contains("selected")).toBe(false)
    setState("card", "currentGenerationID", undefined)
    expect(container.querySelector(".studio-board-card-task")).toBeNull()
    expect(container.querySelector(".studio-board-card-empty-icon")).not.toBeNull()
  } finally {
    disposeConversation()
    dispose()
    container.remove()
  }
})

test.each(["image", "video"] as const)(
  "%s card resizes the graph to decoded media and follows cover changes",
  async (kind) => {
    const card = newBoardCard("actual-ratio", kind, { x: 100, y: 100 })
    card.currentGenerationID = "real-size"
    card.cover = { generationID: "real-size", mediaID: "wide" }
    card.taskLinks = [
      {
        generationID: "real-size",
        submissionID: crypto.randomUUID(),
        visible: true,
        snapshot: { prompt: "真实尺寸", settings: card.draft.settings, references: [] },
      },
    ]
    const value = await setup({
      document: { ...emptyBoard(), cards: [card] },
      results: {
        "real-size": {
          id: "real-size",
          status: "succeeded",
          capability: kind === "image" ? "image.generate" : "video.generate",
          provider: "internel",
          model: "seedream-5-pro",
          prompt: "真实尺寸",
          aspectRatio: "1:1",
          width: 1024,
          height: 1024,
          createdAt: 1,
          images: ["wide", "tall"].map((id) => ({
            id,
            kind,
            url: `https://example.test/${id}.${kind === "video" ? "mp4" : "png"}`,
            thumbnailUrl: "https://example.test/square-thumbnail.png",
          })),
        },
      },
    })
    try {
      const node = value.container.querySelector('[data-cell-id="actual-ratio"]')!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const decode = (width: number, height: number) => {
        const media = node.querySelector(kind === "image" ? "img" : "video")!
        Object.defineProperties(
          media,
          kind === "image"
            ? {
                naturalWidth: { configurable: true, value: width },
                naturalHeight: { configurable: true, value: height },
              }
            : {
                videoWidth: { configurable: true, value: width },
                videoHeight: { configurable: true, value: height },
              },
        )
        media.dispatchEvent(new Event(kind === "image" ? "load" : "loadedmetadata"))
      }
      expect(node.querySelector(kind === "image" ? "img" : "video")?.getAttribute("src")).toContain("/wide.")
      decode(1200, 800)
      await Bun.sleep(30)
      expect(node.querySelector("foreignObject")?.getAttribute("width")).toBe("304")
      expect(node.querySelector("foreignObject")?.getAttribute("height")).toBe("230")
      expect(node.querySelector(".x6-port-input")?.getAttribute("transform")).toBe("matrix(1,0,0,1,-21,115)")
      const wideAnchor = value.container.querySelector<HTMLDivElement>(".studio-board-composer")!.style.top
      const cover = (index: number) => {
        node.querySelector<HTMLButtonElement>("footer button")!.click()
        const figure = value.container.querySelectorAll<HTMLElement>(".studio-board-results figure")[index]
        button(figure, figure.textContent?.includes("当前封面") ? "当前封面" : "设为封面").click()
        button(value.container.querySelector<HTMLElement>(".studio-board-results")!, "关闭").click()
      }
      cover(1)
      expect(node.querySelector(kind === "image" ? "img" : "video")?.getAttribute("src")).toContain("/tall.")
      decode(800, 1200)
      await Bun.sleep(30)
      expect(node.querySelector("foreignObject")?.getAttribute("width")).toBe("204")
      expect(node.querySelector("foreignObject")?.getAttribute("height")).toBe("330")
      expect(value.container.querySelector<HTMLDivElement>(".studio-board-composer")!.style.top).not.toBe(wideAnchor)
      cover(0)
      await Bun.sleep(30)
      expect(node.querySelector("foreignObject")?.getAttribute("width")).toBe("304")
      expect(node.querySelector("foreignObject")?.getAttribute("height")).toBe("230")
      expect(value.stored.document.cards[0].draft.settings.aspectRatio).toBe("1:1")
    } finally {
      value.dispose()
    }
  },
)

test.each(["image", "video"] as const)(
  "%s result preview is full-screen and only choosing a cover changes the card",
  async (kind) => {
    const card = newBoardCard("preview-source", kind)
    card.draft.prompt = "尚未提交的新输入"
    card.currentGenerationID = "preview-result"
    card.cover = { generationID: "preview-result", mediaID: "first" }
    card.preview = { ...card.cover }
    card.taskLinks = [
      {
        generationID: "preview-result",
        submissionID: crypto.randomUUID(),
        visible: true,
        snapshot: { prompt: "这次生成的输入", settings: { ...card.draft.settings }, references: [] },
      },
    ]
    const value = await setup({
      document: {
        ...emptyBoard(),
        cards: [card, newBoardCard("preview-target", "image", { x: 500, y: 0 })],
        draftEdges:
          kind === "image"
            ? [{ id: "preview-edge", sourceID: card.id, targetID: "preview-target", role: "reference" }]
            : [],
      },
      results: {
        "preview-result": {
          id: "preview-result",
          status: "succeeded",
          capability: kind === "image" ? "image.generate" : "video.generate",
          provider: "internel",
          model: "seedream-5-pro",
          prompt: "这次生成的输入",
          aspectRatio: "1:1",
          createdAt: 1,
          images: ["first", "second"].map((id) => ({
            id,
            kind,
            url: `https://example.test/${id}.${kind === "video" ? "mp4" : "png"}`,
            remoteUrl: `https://example.test/original-${id}.${kind === "video" ? "mp4" : "png"}`,
            thumbnailUrl: `https://example.test/thumb-${id}.png`,
          })),
        },
      },
    })
    try {
      const cardMedia = () =>
        value.container.querySelector(".studio-board-card-media")!.querySelector(kind === "image" ? "img" : "video")!
      const initial = cardMedia().getAttribute("src")
      const source = value.container.querySelector('[data-cell-id="preview-source"]')!
      source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      source.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const open = () => button(value.container, "查看结果 2").click()
      open()
      const figures = value.container.querySelectorAll<HTMLElement>(".studio-board-results figure")
      button(figures[1], "本次输入").click()
      expect(value.container.querySelector(".studio-board-results details")?.textContent).toContain("这次生成的输入")
      button(figures[1], "预览").click()
      const preview =
        kind === "image"
          ? value.container.querySelector(".studio-fullscreen-image")!
          : value.container.querySelector(".studio-video-player.fullscreen video")!
      expect(preview.getAttribute("src")).toContain("/original-second.")
      expect(cardMedia().getAttribute("src")).toBe(initial)
      preview.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, shiftKey: true, clientX: 30, clientY: 30 }))
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }))
      expect(value.container.querySelector(".studio-board-marquee")).toBeNull()
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      value.container.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }))
      expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(2)
      if (kind === "video") await (preview as HTMLVideoElement).play()
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      expect(value.container.querySelector(".studio-fullscreen-image, .studio-video-player.fullscreen")).toBeNull()
      expect(value.container.querySelector(".studio-board-results")).not.toBeNull()
      if (kind === "video") expect((preview as HTMLVideoElement).paused).toBe(true)
      await Bun.sleep(550)
      expect(value.saves).toHaveLength(0)
      expect(value.stored.document.cards[0]).toMatchObject({
        cover: card.cover,
        preview: card.preview,
        draft: card.draft,
      })

      button(figures[1], "设为封面").click()
      expect(cardMedia().getAttribute("src")).toContain("/second.")
      expect(button(figures[1], "当前封面")).not.toBeNull()
      button(value.container, "关闭").click()
      await Bun.sleep(550)
      expect(value.stored.document.cards[0]).toMatchObject({
        cover: { generationID: "preview-result", mediaID: "second" },
        preview: { generationID: "preview-result", mediaID: "second" },
        currentGenerationID: "preview-result",
        draft: card.draft,
      })
      if (kind === "image") {
        const node = value.container.querySelector('[data-cell-id="preview-target"]')!
        node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
        node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
        expect(value.container.querySelector(".studio-board-composer img")?.getAttribute("src")).toContain(
          "/original-second.",
        )
      }
    } finally {
      value.dispose()
    }
  },
)

test.each(
  (["image", "video"] as const).flatMap((kind) =>
    (["saved", "cancelled", "fetch-failed", "write-failed"] as const).map((outcome) => [kind, outcome] as const),
  ),
)(
  "%s toolbar download follows the displayed original media and handles %s",
  async (kind, outcome) => {
    const card = newBoardCard("download-card", kind)
    card.currentGenerationID = "download-result"
    card.cover = { generationID: "download-result", mediaID: "cover" }
    card.preview = outcome === "cancelled" ? undefined : { generationID: "download-result", mediaID: "preview" }
    card.taskLinks = [{
      generationID: "download-result",
      submissionID: crypto.randomUUID(),
      visible: true,
      snapshot: { prompt: "图片下载", settings: { ...card.draft.settings }, references: [] },
    }]
    const extension = kind === "video" ? "mp4" : "png"
    const filename = kind === "video" ? "original.mp4" : "original.webp"
    const source = outcome === "cancelled"
      ? `http://board.test/artifact/serve?directory=%2Ftest&path=cover.${extension}&sessionId=test-board`
      : `https://example.test/original-preview.${extension}`
    const value = await setup({
      document: { ...emptyBoard(), cards: [card] },
      results: {
        "download-result": {
          id: "download-result",
          status: "succeeded",
          capability: kind === "video" ? "video.generate" : "image.generate",
          provider: "internel",
          model: "seedream-5-pro",
          prompt: "图片下载",
          aspectRatio: "1:1",
          createdAt: 1,
          images: [
            { id: "cover", kind, url: `.octo/test-board/cover.${extension}` },
            { id: "preview", kind, url: `https://example.test/cached-preview.${extension}`, remoteUrl: source },
          ],
        },
      },
      media: {
        [source]: new Response(outcome === "fetch-failed" ? null : new Uint8Array([1, 2, 3]), {
          status: outcome === "fetch-failed" ? 503 : 200,
          headers: {
            "content-type": kind === "video" ? "video/mp4" : "image/webp",
            "content-disposition": `attachment; filename="${filename}"`,
          },
        }),
      },
    })
    const api = Object.getOwnPropertyDescriptor(window, "api")
    const picks: string[] = []
    const writes: { path: string; bytes: number[] }[] = []
    const links: { href: string; label: string }[] = []
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      links.push({ href: this.href, label: this.download })
    })
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        saveFilePicker: async (options: { defaultPath: string }) => {
          picks.push(options.defaultPath)
          return outcome === "cancelled" ? null : `/downloads/${filename}`
        },
        writeFileBuffer: async (path: string, buffer: ArrayBuffer) => {
          if (outcome === "write-failed") throw new Error("Disk unavailable")
          writes.push({ path, bytes: [...new Uint8Array(buffer)] })
        },
      },
    })
    try {
      const node = value.container.querySelector(".x6-node")!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const toolbar = value.container.querySelector<HTMLElement>(".studio-board-media-toolbar")!
      expect(toolbar.getAttribute("aria-label")).toBe(kind === "video" ? "视频操作" : "图片操作")
      expect([...toolbar.querySelectorAll("button")].map((item) => item.textContent)).toEqual(
        kind === "video" ? ["再次生成", "下载"]
          : ["再次生成", "视频生成", "变清晰", "抠图", "智能重绘", "扩图", "下载"],
      )
      expect(value.downloads).toEqual([])
      button(toolbar, "下载").click()
      await Bun.sleep(30)
      expect(value.downloads).toEqual([source])
      expect(picks).toEqual(outcome === "fetch-failed" ? [] : [filename])
      expect(writes).toEqual(outcome === "saved" ? [{ path: `/downloads/${filename}`, bytes: [1, 2, 3] }] : [])
      expect(links).toEqual(
        outcome === "fetch-failed" || outcome === "write-failed"
          ? [{ href: source, label: outcome === "fetch-failed" ? `original-preview.${extension}` : filename }]
          : [],
      )
      expect(value.container.querySelector(".studio-board-notice")?.textContent ?? "").toBe(
        outcome === "saved" ? "下载成功"
          : outcome === "cancelled" ? ""
          : "部分文件无法保存，已转交浏览器下载，请注意浏览器下载列表",
      )
      expect(value.container.querySelector(".studio-board-composer")).not.toBeNull()
      expect(value.requests).toEqual([])
      expect(value.saves).toEqual([])
    } finally {
      if (api) Object.defineProperty(window, "api", api)
      if (!api) Reflect.deleteProperty(window, "api")
      click.mockRestore()
      value.dispose()
    }
  },
)

test.each(["image", "video"] as const)("reopening a %s card preserves its chosen historical cover", async (kind) => {
  const card = newBoardCard("saved-cover", kind)
  card.currentGenerationID = "latest"
  card.cover = { generationID: "historical", mediaID: "historical" }
  card.preview = { ...card.cover }
  card.taskLinks = ["historical", "latest"].map((generationID) => ({
    generationID,
    submissionID: crypto.randomUUID(),
    visible: true,
    snapshot: { prompt: generationID, settings: { ...card.draft.settings }, references: [] },
  }))
  const value = await setup({
    document: { ...emptyBoard(), cards: [card] },
    results: Object.fromEntries(
      ["historical", "latest"].map((id) => [
        id,
        {
          id,
          status: "succeeded",
          capability: kind === "image" ? "image.generate" : "video.generate",
          provider: "internel",
          model: "seedream-5-pro",
          prompt: id,
          aspectRatio: "1:1",
          createdAt: id === "latest" ? 2 : 1,
          images: [{ id, kind, url: `https://example.test/${id}.${kind === "video" ? "mp4" : "png"}` }],
        },
      ]),
    ),
  })
  try {
    expect(
      value.container
        .querySelector(".studio-board-card-media")
        ?.querySelector(kind === "image" ? "img" : "video")
        ?.getAttribute("src"),
    ).toContain("/historical.")
    expect(value.stored.document.cards[0].cover).toEqual(card.cover)
    expect(value.stored.document.cards[0].preview).toEqual(card.preview)
  } finally {
    value.dispose()
  }
})

test.each(["other-board", undefined])("switching to %s waits for current card edits to save", async (id) => {
  const response = Promise.withResolvers<void>()
  const selected: { id?: string; prompt: string }[] = []
  const value = await setup({
    document: { ...emptyBoard(), cards: [newBoardCard("switch-card", "image")] },
    saveResponse: response.promise,
    header: {
      title: "当前画布",
      loadSessions: async () => ({
        sessions: [
          {
            id: "other-board",
            title: "其他画布",
            slug: "other",
            projectID: "test",
            directory: "/test",
            version: "test",
            agent: "octo_studio",
            studio_mode: "board",
            pinned: false,
            sort_order: 0,
            time: { created: 1, updated: 2 },
          },
        ],
      }),
      onSelectSession: (next) => {
        selected.push({ id: next, prompt: value.stored.document.cards[0].draft.prompt })
      },
    },
  })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "切换之前必须保存的内容"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "切换画布").click()
    await Bun.sleep(0)
    button(value.container, id ? "其他画布" : "新建画布").click()
    await Bun.sleep(30)
    expect(selected).toEqual([])
    expect(value.container.querySelector<HTMLElement>(".studio-board")?.inert).toBe(true)
    response.resolve()
    await Bun.sleep(30)
    expect(selected).toEqual([{ id, prompt: "切换之前必须保存的内容" }])
    expect(value.container.querySelector<HTMLElement>(".studio-board")?.inert).toBe(false)
  } finally {
    response.resolve()
    value.dispose()
  }
})

test("a failed save prevents board switching and can be retried without losing edits", async () => {
  const selected: string[] = []
  const value = await setup({
    document: { ...emptyBoard(), cards: [newBoardCard("switch-card", "image")] },
    saveFailures: 1,
    header: {
      loadSessions: async () => ({
        sessions: [
          {
            id: "other-board",
            title: "其他画布",
            slug: "other",
            projectID: "test",
            directory: "/test",
            version: "test",
            agent: "octo_studio",
            studio_mode: "board",
            pinned: false,
            sort_order: 0,
            time: { created: 1, updated: 2 },
          },
        ],
      }),
      onSelectSession: (id) => {
        if (id) selected.push(id)
      },
    },
  })
  try {
    value.container.querySelector(".x6-node")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "失败时也保留"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "切换画布").click()
    await Bun.sleep(0)
    button(value.container, "其他画布").click()
    await Bun.sleep(30)
    expect(selected).toEqual([])
    expect(prompt.value).toBe("失败时也保留")
    expect(value.container.querySelector<HTMLElement>(".studio-board")?.inert).toBe(false)
    expect(value.container.textContent).toContain("无法离开画布")
    button(value.container, "切换画布").click()
    await Bun.sleep(0)
    button(value.container, "其他画布").click()
    await Bun.sleep(30)
    expect(selected).toEqual(["other-board"])
    expect(value.stored.document.cards[0].draft.prompt).toBe("失败时也保留")
  } finally {
    value.dispose()
  }
})

test("renaming a fresh empty board creates and binds one session before persisting its title", async () => {
  const renamed: string[][] = []
  const value = await setup({
    fresh: true,
    header: {
      onRenameSession: async (id, title) => {
        renamed.push([id, title])
      },
    },
  })
  try {
    value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
    await Bun.sleep(0)
    const title = value.container.querySelector<HTMLInputElement>('[aria-label="画布名称"]')!
    title.value = "空画布也可以命名"
    title.dispatchEvent(new Event("input", { bubbles: true }))
    title.blur()
    await Bun.sleep(30)
    expect(value.creations).toHaveLength(1)
    expect(value.bindings).toEqual(["test-board"])
    expect(renamed).toEqual([["test-board", "空画布也可以命名"]])
    expect(value.container.querySelector(".studio-board-name")?.textContent).toBe("空画布也可以命名")
  } finally {
    value.dispose()
  }
})

test.each([false, true])(
  "switching waits for a pending title update and preserves a failed edit=%s",
  async (failure) => {
    const rename = Promise.withResolvers<void>()
    const selected: string[] = []
    const value = await setup({
      header: {
        loadSessions: async () => ({
          sessions: [
            {
              id: "other-board",
              title: "其他画布",
              slug: "other",
              projectID: "test",
              directory: "/test",
              version: "test",
              agent: "octo_studio",
              studio_mode: "board",
              pinned: false,
              sort_order: 0,
              time: { created: 1, updated: 2 },
            },
          ],
        }),
        onRenameSession: () => rename.promise,
        onSelectSession: (id) => {
          if (id) selected.push(id)
        },
      },
    })
    try {
      value.container.querySelector<HTMLButtonElement>(".studio-board-name")!.click()
      await Bun.sleep(0)
      const title = value.container.querySelector<HTMLInputElement>('[aria-label="画布名称"]')!
      title.value = "等待保存的名称"
      title.dispatchEvent(new Event("input", { bubbles: true }))
      title.blur()
      button(value.container, "切换画布").click()
      await Bun.sleep(0)
      button(value.container, "其他画布").click()
      await Bun.sleep(10)
      expect(selected).toEqual([])
      if (failure) rename.reject(new Error("名称保存失败"))
      if (!failure) rename.resolve()
      await Bun.sleep(30)
      expect(selected).toEqual(failure ? [] : ["other-board"])
      expect(value.container.querySelector<HTMLElement>(".studio-board")?.inert).toBe(false)
      if (failure) {
        expect(title.value).toBe("等待保存的名称")
        expect(value.container.textContent).toContain("名称保存失败")
      }
    } finally {
      rename.resolve()
      value.dispose()
    }
  },
)

test("board header thumbnail notifications keep the last successful completion when the latest task fails", async () => {
  const card = newBoardCard("thumbnail", "image")
  card.currentGenerationID = "failure"
  card.taskLinks = ["slow", "fast", "failure"].map((generationID) => ({
    generationID,
    submissionID: generationID,
    visible: true,
    snapshot: { prompt: "thumbnail", settings: card.draft.settings, references: [] },
  }))
  const thumbnails: string[] = []
  const value = await setup({
    document: { ...emptyBoard(), cards: [card] },
    results: Object.fromEntries(
      ["slow", "fast", "failure"].map((id) => [
        id,
        {
          id,
          status: id === "failure" ? "failed" : "succeeded",
          capability: "image.generate",
          provider: "internel",
          model: "seedream-5-pro",
          prompt: "thumbnail",
          aspectRatio: "1:1",
          createdAt: id === "slow" ? 1 : 10,
          completedAt: id === "slow" ? 30 : 20,
          images: id === "failure" ? [] : [{ id, url: `https://example.test/${id}.png` }],
        },
      ]),
    ),
    header: {
      onThumbnail: (_, result) => {
        thumbnails.push(result.id)
      },
    },
  })
  try {
    expect(thumbnails.at(-1)).toBe("slow")
    expect(thumbnails).not.toContain("failure")
  } finally {
    value.dispose()
  }
})

test("image composer shares the reference stack, expanded upload and live parameter summary", async () => {
  const card = newBoardCard("stack", "image")
  card.draft.assets = [
    { id: "first", name: "first.png", url: "/first.png", role: "reference" },
    { id: "second", name: "second.png", url: "/second.png", role: "reference" },
  ]
  card.draft.settings.aspectRatio = "3:4"
  card.draft.settings.count = 2
  const value = await setup({ document: { ...emptyBoard(), cards: [card] } })
  try {
    value.container
      .querySelector(".x6-node")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const row = value.container.querySelector(".studio-composer-input-row.with-reference")!
    expect(row.querySelector("textarea")).not.toBeNull()
    expect(row.querySelectorAll(".studio-composer-ref-image")).toHaveLength(2)
    const stack = row.querySelector(".studio-composer-ref-stack")!
    expect(stack.classList.contains("expanded")).toBe(false)
    expect(row.querySelector(".studio-composer-ref-upload-float")).not.toBeNull()
    const move = new PointerEvent("pointermove", { bubbles: true })
    Object.defineProperty(move, "movementX", { value: 1 })
    stack.dispatchEvent(move)
    expect(stack.classList.contains("expanded")).toBe(true)
    expect(stack.querySelector(".studio-composer-ref-add")).not.toBeNull()
    expect(row.querySelector(".studio-composer-ref-upload-float")).toBeNull()
    const pick = spyOn(value.container.querySelector<HTMLInputElement>('input[type="file"]')!, "click")
    button(row as HTMLElement, "继续上传参考图").click()
    expect(pick).toHaveBeenCalledTimes(1)
    pick.mockRestore()
    button(row as HTMLElement, "删除参考图 first.png").click()
    expect(row.querySelectorAll(".studio-composer-ref-image")).toHaveLength(1)
    stack.dispatchEvent(new PointerEvent("pointerleave"))
    expect(stack.classList.contains("expanded")).toBe(false)
    button(row as HTMLElement, "删除参考图 second.png").click()
    expect(row.querySelector(".studio-composer-ref-stack")).toBeNull()
    expect(button(row as HTMLElement, "上传参考图").disabled).toBe(false)
    const settings = button(value.container, "图片设置")
    expect(settings.textContent).toBe("3:42")
    expect(settings.querySelector(".studio-composer-icon-tool-ratio-icon")).not.toBeNull()
    settings.click()
    button(value.container, "16:9").click()
    button(value.container, "4张").click()
    expect(settings.textContent).toBe("16:94")
    button(value.container, "自定义").click()
    const width = value.container.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
    const height = value.container.querySelector<HTMLInputElement>('input[placeholder="高"]')!
    width.value = "2100"
    width.dispatchEvent(new Event("input", { bubbles: true }))
    height.value = "2100"
    height.dispatchEvent(new Event("input", { bubbles: true }))
    expect(settings.textContent).toBe("16:94")
    settings.click()
    expect(settings.textContent).toBe("2100×21004")
    expect(settings.querySelector(".studio-composer-icon-tool-ratio-icon")).toBeNull()
  } finally {
    value.dispose()
  }
})

test.each(["image", "first-last-frame", "multi-reference"] as const)(
  "%s composer dismisses popups for prompt and uploads while preserving menu interactions and settings",
  async (mode) => {
    const card = newBoardCard("popup-card", mode === "image" ? "image" : "video")
    if (mode !== "image") card.draft.settings.videoInputMode = mode
    card.draft.prompt = "保留输入内容"
    const value = await setup({ document: { ...emptyBoard(), cards: [card] } })
    try {
      const node = value.container.querySelector(".x6-node")!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const composer = value.container.querySelector<HTMLElement>(".studio-board-composer")!
      const prompt = composer.querySelector<HTMLTextAreaElement>("textarea")!
      const dialog = () => composer.querySelector<HTMLElement>('[role="dialog"]')
      const activate = (element: HTMLElement) => {
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
        element.focus()
        element.click()
      }
      const settings = button(composer, mode === "image" ? "图片设置" : "视频设置")
      const primary = button(
        composer,
        mode === "image"
          ? styleModelLabel(card.draft.settings.styleModel)
          : mode === "multi-reference"
            ? "多图参考"
            : "首尾帧",
      )
      const menus = mode === "image" ? [primary, settings, button(composer, "引用参考")] : [primary, settings]
      menus.forEach((trigger) => {
        activate(trigger)
        expect(dialog()).not.toBeNull()
        dialog()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
        expect(dialog()).not.toBeNull()
        prompt.focus()
        expect(dialog()).toBeNull()
        trigger.click()
        expect(dialog()).not.toBeNull()
        prompt.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
        expect(dialog()).toBeNull()
        activate(trigger)
        activate(trigger)
        expect(dialog()).toBeNull()
      })
      activate(settings)
      activate(button(dialog()!, "16:9"))
      expect(dialog()).not.toBeNull()
      expect(settings.textContent).toContain("16:9")
      activate(primary)
      expect(dialog()?.getAttribute("aria-label")).toBe(mode === "image" ? "风格模型" : "视频输入方式")
      activate(primary)
      expect(dialog()).toBeNull()
      if (mode === "image") {
        activate(settings)
        activate(button(dialog()!, "自定义"))
        const width = dialog()!.querySelector<HTMLInputElement>('input[placeholder="宽"]')!
        const height = dialog()!.querySelector<HTMLInputElement>('input[placeholder="高"]')!
        width.focus()
        width.value = "2100"
        width.dispatchEvent(new Event("input", { bubbles: true }))
        height.focus()
        height.value = "2100"
        height.dispatchEvent(new Event("input", { bubbles: true }))
        expect(dialog()).not.toBeNull()
        prompt.focus()
        expect(dialog()).toBeNull()
        expect(settings.textContent).toContain("2100×2100")
        activate(settings)
        expect(dialog()!.querySelector<HTMLInputElement>('input[placeholder="宽"]')?.value).toBe("2100")
        expect(dialog()!.querySelector<HTMLInputElement>('input[placeholder="高"]')?.value).toBe("2100")
        prompt.focus()
      }
      const pick = spyOn(composer.querySelector<HTMLInputElement>('input[type="file"]')!, "click").mockImplementation(
        () => {
          expect(dialog()).toBeNull()
        },
      )
      try {
        menus.forEach((trigger) => {
          const uploads = mode === "first-last-frame" ? ["上传首帧", "上传尾帧"] : ["上传参考图"]
          uploads.forEach((label) => {
            activate(trigger)
            activate(button(composer, label))
            expect(dialog()).toBeNull()
          })
        })
        expect(pick).toHaveBeenCalledTimes(menus.length * (mode === "first-last-frame" ? 2 : 1))
        if (mode === "image") {
          activate(button(composer, "引用参考"))
          expect(dialog()?.textContent).toContain("你还没有添加图片")
          expect(dialog()?.querySelector("button")).toBeNull()
          prompt.focus()
          expect(dialog()).toBeNull()
          expect(pick).toHaveBeenCalledTimes(menus.length)
        }
      } finally {
        pick.mockRestore()
      }
      expect(prompt.value).toBe("保留输入内容")
      expect(composer.isConnected).toBe(true)
      activate(settings)
      value.container
        .querySelector(".studio-board-graph")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      expect(dialog()).toBeNull()
    } finally {
      value.dispose()
    }
  },
)

test("board mention popup matches the shared empty state and lists each uploaded or connected reference", async () => {
  const sources = [1, 2].map((index) => {
    const card = newBoardCard(`mention-source-${index}`, "image")
    card.title = `来源图片 ${index}`
    card.cover = { generationID: "source-success", mediaID: "source-image" }
    card.taskLinks = [
      {
        generationID: "source-success",
        submissionID: crypto.randomUUID(),
        visible: true,
        snapshot: { prompt: "source", settings: card.draft.settings, references: [] },
      },
    ]
    return card
  })
  const target = newBoardCard("mention-target", "image")
  target.draft.prompt = "保留原来的描述"
  target.draft.assets = [
    { id: "upload", name: "portrait.final.png", url: "https://example.test/upload.png", role: "reference" },
  ]
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [...sources, target, newBoardCard("empty-mention", "image")],
      draftEdges: sources.map((card) => ({
        id: `mention-${card.id}`,
        sourceID: card.id,
        targetID: target.id,
        role: "reference",
      })),
    },
  })
  try {
    const select = (id: string) => {
      const node = value.container.querySelector(`[data-cell-id="${id}"]`)!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    }
    select("empty-mention")
    button(value.container, "引用参考").click()
    const empty = value.container.querySelector<HTMLElement>(".studio-at-menu")!
    expect(empty.style.width).toBe("200px")
    expect(empty.style.height).toBe("150px")
    expect(empty.querySelector(".studio-material-title")?.textContent).toBe("可能@的内容")
    expect(empty.querySelector(".studio-at-menu-empty-text")?.textContent).toBe("你还没有添加图片")
    expect(empty.querySelector(".studio-at-menu-empty-img")).not.toBeNull()
    expect(empty.querySelector("button")).toBeNull()
    select(target.id)
    button(value.container, "引用参考").click()
    const popup = value.container.querySelector<HTMLElement>(".studio-at-menu")!
    expect(popup.style.width).toBe("200px")
    expect(popup.style.height).toBe("120px")
    expect(popup.querySelector(".scroll-view__viewport")).not.toBeNull()
    expect(popup.querySelector(".studio-at-menu-empty")).toBeNull()
    expect(Array.from(popup.querySelectorAll(".studio-at-menu-name")).map((item) => item.textContent)).toEqual([
      "来源图片 1",
      "来源图片 2",
      "portrait.final",
    ])
    expect(Array.from(popup.querySelectorAll(".studio-at-menu-thumb")).map((item) => item.getAttribute("src"))).toEqual(
      ["https://example.test/source.png", "https://example.test/source.png", "https://example.test/upload.png"],
    )
    const row = popup.querySelectorAll<HTMLElement>(".studio-at-menu-item")[1]
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(value.container.querySelector(".studio-at-menu")).toBeNull()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    expect(prompt.value).toBe("保留原来的描述 @参考图2 ")
    expect(document.activeElement).toBe(prompt)
    expect(prompt.selectionStart).toBe(prompt.value.length)
    button(value.container, "引用参考").click()
    value.container
      .querySelectorAll<HTMLElement>(".studio-at-menu-item")[2]
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    expect(prompt.value).toBe("保留原来的描述 @参考图2  @参考图3 ")
    expect(value.container.querySelector(".studio-at-menu")).toBeNull()
  } finally {
    value.dispose()
  }
})

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
      const exit = button(value.container, "退出画布")
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
    expect(reopened.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(failure ? 1 : 2)
  } finally {
    reopened.dispose()
  }
})

test("video frame upload finishes registration before exit saves and unmounts", async () => {
  const response = Promise.withResolvers<Response>()
  const value = await setup({ uploadResponses: [response.promise], unmountOnExit: true })
  try {
    button(value.container, "新建视频卡片").click()
    button(value.container, "上传首帧").click()
    const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const transfer = new DataTransfer()
    transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
    input.files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Bun.sleep(30)
    button(value.container, "退出画布").click()
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
    expect(button(value.container, "上传首帧").disabled).toBe(true)
    expect(button(value.container, "上传尾帧").disabled).toBe(false)
    expect(value.uploads).toHaveLength(0)
  } finally {
    value.dispose()
  }
})

test("full-screen preview preserves failure state and choosing a historical cover keeps reboot available", async () => {
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
    expect(value.container.querySelector(".studio-fullscreen-image")).not.toBeNull()
    expect(value.container.textContent).toContain("原任务失败原因")
    button(value.container, "关闭全屏").click()
    button(value.container, "当前封面").click()
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

test.each([
  { entry: "sidebar", near: false },
  { entry: "sidebar", near: true },
  { entry: "menu", near: false },
  { entry: "menu", near: true },
])("$entry creation stays at its anchor and staggers near-identical positions=$near", async ({ entry, near }) => {
  const origin = { x: 448, y: entry === "menu" ? 235 : 265 }
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [newBoardCard("existing", "image", {
        x: origin.x + (near ? 5 : -100),
        y: origin.y + (near ? -4 : -80),
      })],
    },
  })
  try {
    value.container.querySelector<HTMLElement>(".studio-board")!.getBoundingClientRect =
      () => new DOMRect(100, 80, 1000, 800)
    for (const index of [0, 1, 2]) {
      if (entry === "menu") {
        value.container.querySelector(".x6-graph")!.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 600,
          clientY: 400,
        }))
        button(value.container.querySelector<HTMLElement>('[role="menu"]')!, "＋ 新建图片卡片").click()
      }
      if (entry === "sidebar") button(value.container, "新建图片卡片").click()
      await Bun.sleep(30)
      const card = value.stored.document.cards.at(-1)!
      expect(card.position).toEqual({
        x: origin.x + (index + Number(near)) * 24,
        y: origin.y + (index + Number(near)) * 24,
      })
      expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(1)
      expect(value.container.querySelector(".studio-board-card.selected")?.closest(".x6-node")?.getAttribute("data-cell-id"))
        .toBe(card.id)
      expect(value.container.querySelectorAll(".x6-node").item(value.stored.document.cards.length - 1)?.getAttribute("data-cell-id"))
        .toBe(card.id)
      expect(value.stored.document.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    }
    expect(value.requests).toHaveLength(0)
  } finally {
    value.dispose()
  }
})

test("board tools show five controls, switch modes with a keyboard menu and ignore shortcuts while typing", async () => {
  const value = await setup()
  try {
    const board = value.container.querySelector<HTMLElement>(".studio-board")!
    expect(value.container.querySelectorAll(".studio-board-tools > button")).toHaveLength(5)
    expect(button(value.container, "素材库").disabled).toBe(true)
    expect(button(value.container, "上传素材").disabled).toBe(true)
    expect(board.dataset.tool).toBe("select")
    const trigger = button(value.container, "操作工具")
    trigger.click()
    await Bun.sleep(0)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const menu = value.container.querySelector<HTMLElement>('[aria-label="操作工具选项"]')!
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true")
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement?.textContent).toBe("平移画布H")
    button(menu, "平移画布H").click()
    expect(board.dataset.tool).toBe("pan")
    expect(document.activeElement).toBe(trigger)
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe("/studio/board-tool-pan.svg")
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }))
    expect(board.dataset.tool).toBe("select")
    button(value.container, "新建图片卡片").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }))
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }))
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "h", isComposing: true, bubbles: true }))
    expect(board.dataset.tool).toBe("select")
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "H", bubbles: true }))
    expect(board.dataset.tool).toBe("pan")
    button(value.container, "新建视频卡片").click()
    expect(board.dataset.tool).toBe("select")
    await Bun.sleep(30)
    expect(value.container.querySelectorAll(".studio-board-card-video")).toHaveLength(1)
    trigger.click()
    await Bun.sleep(0)
    value.container
      .querySelector('[aria-label="操作工具选项"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(1)
  } finally {
    value.dispose()
  }
})

test.each([{ demo: true }, { video: false }])("board tools retain a disabled video entry with %j", async (options) => {
  const value = await setup(options)
  try {
    expect(value.container.querySelectorAll(".studio-board-tools > button")).toHaveLength(5)
    expect(button(value.container, "新建视频卡片").disabled).toBe(true)
    button(value.container, "新建视频卡片").click()
    expect(value.container.querySelectorAll(".studio-board-card-video")).toHaveLength(0)
  } finally {
    value.dispose()
  }
})

test.each(["blank", "node", "port", "edge", "middle"])(
  "board pan gestures on %s move only the viewport",
  async (target) => {
    const { Graph } = await import("@antv/x6")
    const addNode = spyOn(Graph.prototype, "addNode")
    const value = await setup({
      document: {
        ...emptyBoard(),
        cards: [newBoardCard("a", "image", { x: 100, y: 100 }), newBoardCard("b", "image", { x: 600, y: 100 })],
        draftEdges: [{ id: "a-b", sourceID: "a", targetID: "b", role: "reference" }],
      },
    })
    try {
      const result = addNode.mock.results[0]
      if (result.type !== "return") throw new Error("Expected a real X6 node")
      const graph = result.value.model!.graph
      const board = value.container.querySelector<HTMLElement>(".studio-board")!
      const node = value.container.querySelector('[data-cell-id="a"]')!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const element =
        target === "blank"
          ? value.container.querySelector(".studio-board-graph")!
          : target === "port"
            ? node.querySelector('[port="output"]')!
            : target === "edge"
              ? value.container.querySelector('[data-cell-id="a-b"]')!
              : node
      if (target !== "middle") board.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }))
      const button = target === "middle" ? 1 : 0
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button, clientX: 40, clientY: 40 }))
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button, clientX: 40, clientY: 40 }))
      expect(graph.findViewByCell("a")?.can("nodeMovable")).toBe(false)
      expect(graph.findViewByCell("a")?.can("magnetConnectable")).toBe(false)
      document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button, clientX: 100, clientY: 90 }))
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button, clientX: 100, clientY: 90 }))
      document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button, clientX: 100, clientY: 90 }))
      expect(graph.translate()).toEqual({ tx: 60, ty: 50 })
      expect(graph.getCellById("a")?.getBBox().topLeft.toJSON()).toEqual({ x: 100, y: 100 })
      expect(
        value.container.querySelector(".studio-board-card.selected")?.closest(".x6-node")?.getAttribute("data-cell-id"),
      ).toBe("a")
      expect(graph.getEdges()).toHaveLength(1)
      expect(value.container.querySelector(".studio-board-marquee")).toBeNull()
      expect(board.dataset.tool).toBe(target === "middle" ? "select" : "pan")
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button, clientX: 100, clientY: 90 }))
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button, clientX: 100, clientY: 90 }))
      document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button, clientX: 120, clientY: 110 }))
      document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, button }))
      document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button, clientX: 150, clientY: 140 }))
      expect(graph.translate()).toEqual({ tx: 80, ty: 70 })
      board.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }))
      expect(graph.options.panning.eventTypes).toEqual(["mouseWheelDown"])
      expect(graph.findViewByCell("a")?.can("nodeMovable")).toBe(true)
    } finally {
      value.dispose()
      addNode.mockRestore()
    }
  },
)

test.each(["pointerup", "pointercancel", "blur"])(
  "board selection marquee cleans up on %s without enabling left panning",
  async (end) => {
    const value = await setup({
      document: { ...emptyBoard(), cards: [newBoardCard("a", "image", { x: 100, y: 100 })] },
    })
    try {
      const canvas = value.container.querySelector(".studio-board-graph")!
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 80, clientY: 80 }))
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 450, clientY: 460 }))
      expect(value.container.querySelector(".studio-board-marquee")).not.toBeNull()
      if (end === "blur") window.dispatchEvent(new Event(end))
      if (end !== "blur") document.dispatchEvent(new PointerEvent(end, { bubbles: true }))
      await Bun.sleep(10)
      expect(value.container.querySelector(".studio-board-marquee")).toBeNull()
      expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(end === "pointerup" ? 1 : 0)
      expect(value.container.querySelector<HTMLElement>(".studio-board")?.dataset.tool).toBe("select")
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 80, clientY: 80 }))
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 450, clientY: 460 }))
      expect(value.container.querySelector(".studio-board-marquee")).not.toBeNull()
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    } finally {
      value.dispose()
    }
  },
)

test("board selection preserves native blank clicks, additive marquee and Escape cancellation", async () => {
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [newBoardCard("a", "image", { x: 100, y: 100 }), newBoardCard("b", "image", { x: 600, y: 100 })],
    },
  })
  try {
    const canvas = value.container.querySelector(".studio-board-graph")!
    const board = value.container.querySelector<HTMLElement>(".studio-board")!
    const node = value.container.querySelector('[data-cell-id="a"]')!
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(1)
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 950,
      clientY: 50,
    })
    canvas.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 950, clientY: 50 }))
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))
    canvas.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 950, clientY: 50 }))
    expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(0)
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: 580, clientY: 80 }),
    )
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 930, clientY: 460 }))
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))
    await Bun.sleep(10)
    expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(2)
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 580, clientY: 80 }))
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 930, clientY: 460 }))
    board.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 940, clientY: 470 }))
    expect(value.container.querySelector(".studio-board-marquee")).toBeNull()
    expect(value.container.querySelectorAll(".studio-board-card.selected")).toHaveLength(0)
  } finally {
    value.dispose()
  }
})

test("extracted card views keep one composer across selection, then dispose a removed card", async () => {
  const value = await setup()
  try {
    button(value.container, "新建图片卡片").click()
    button(value.container, "新建图片卡片").click()
    await Bun.sleep(30)
    const first = value.container.querySelectorAll(".x6-node")[0]
    const article = first.querySelector("article")!
    expect(first.querySelector("foreignObject")?.getAttribute("width")).toBe("304")
    expect(first.querySelector("foreignObject")?.getAttribute("height")).toBe("330")
    expect(first.querySelector(".x6-port-input")?.getAttribute("transform")).toBe("matrix(1,0,0,1,-21,165)")
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
    expect(button(value.container, "上传尾帧").disabled).toBe(false)
    button(value.container, "上传首帧").click()
    const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const transfer = new DataTransfer()
    transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
    input.files = transfer.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Bun.sleep(30)
    expect(input.multiple).toBe(false)
    expect(button(value.container, "替换首帧").disabled).toBe(false)
    button(value.container, "上传尾帧").click()
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

test("video input modes share ordinary upload controls, preserve separate material and submit only the selected mode", async () => {
  const card = newBoardCard("video-modes", "video")
  card.draft.settings.styleModel = "portrait"
  card.draft.settings.videoInputMode = "first-last-frame"
  const value = await setup({
    document: { ...emptyBoard(), cards: [card] },
    uploadResponses: Array.from({ length: 7 }, (_, index) =>
      Promise.resolve(Response.json({ path: `/test/.octo/test-board/uploads/video-${index}.png` })),
    ),
  })
  try {
    const video = value.container.querySelector(".studio-board-card-video")!.closest(".x6-node")!
    expect(video.querySelector("foreignObject")?.getAttribute("width")).toBe("304")
    expect(video.querySelector("foreignObject")?.getAttribute("height")).toBe("330")
    expect(video.querySelector(".x6-port-output")).toBeNull()
    expect(video.querySelector(".x6-port-input circle")?.getAttribute("r")).toBe("13")
    expect(video.querySelector(".x6-port-input circle")?.getAttribute("stroke")).toBe("#e1e1e1")
    const select = () => {
      const node = value.container.querySelector('.studio-board-card[aria-label="视频"]')!.closest(".x6-node")!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    }
    select()
    expect(value.container.querySelector(".studio-board-composer.video")).not.toBeNull()
    expect(value.container.textContent).not.toContain(styleModelLabel("portrait"))
    expect(value.container.querySelectorAll(".studio-composer-video-frame")).toHaveLength(2)
    expect(button(value.container, "视频设置").textContent).toBe("1:11")
    const upload = async (label: string, names: string[]) => {
      button(value.container, label).click()
      const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
      const transfer = new DataTransfer()
      names.forEach((name) => transfer.items.add(new File([name], name, { type: "image/png" })))
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await Bun.sleep(40)
    }
    await upload("上传首帧", ["first.png"])
    await upload("上传尾帧", ["last.png"])
    button(value.container, "交换首尾帧").click()
    expect(
      Array.from(value.container.querySelectorAll(".studio-composer-video-image")).map((img) =>
        img.getAttribute("alt"),
      ),
    ).toEqual(["last.png", "first.png"])
    await upload("替换首帧", ["replacement.png"])
    expect(value.container.querySelector(".studio-composer-video-image")?.getAttribute("alt")).toBe("replacement.png")
    button(value.container, "首尾帧").click()
    button(value.container, "多图参考").click()
    expect(value.container.querySelector(".studio-composer-video-frames")).toBeNull()
    await upload("上传参考图", ["a.png", "b.png", "c.png", "d.png"])
    expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(4)
    expect(value.container.querySelector(".studio-composer-ref-upload-float")).toBeNull()
    button(value.container, "多图参考").click()
    button(value.container, "首尾帧").click()
    expect(
      Array.from(value.container.querySelectorAll(".studio-composer-video-image")).map((img) =>
        img.getAttribute("alt"),
      ),
    ).toEqual(["replacement.png", "first.png"])
    button(value.container, "新建视频卡片").click()
    expect(value.container.querySelectorAll(".studio-composer-video-image")).toHaveLength(0)
    select()
    button(value.container, "首尾帧").click()
    button(value.container, "多图参考").click()
    const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
    prompt.value = "多图生成视频"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    button(value.container, "发送新任务").click()
    await Bun.sleep(50)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].board.snapshot.settings).toMatchObject({
      videoInputMode: "multi-reference",
      videoMode: "first_last_frame",
    })
    expect(value.requests[0].board.snapshot.references.map((ref) => ref.role)).toEqual(Array(4).fill("reference"))
    expect(value.stored.document.cards[0].draft.assets).toHaveLength(6)
    expect(value.stored.document.cards[0].draft.settings.videoInputMode).toBe("multi-reference")
  } finally {
    value.dispose()
  }
})

test("same-image source cards display separate video references and each delete removes exactly one edge", async () => {
  const sources = [1, 2, 3].map((index) => {
    const card = newBoardCard(`source-${index}`, "image")
    card.title = `图片 0${index}`
    card.cover = { generationID: "source-success", mediaID: "source-image" }
    card.taskLinks = [
      {
        generationID: "source-success",
        submissionID: crypto.randomUUID(),
        visible: true,
        snapshot: { prompt: "来源图片", settings: card.draft.settings, references: [] },
      },
    ]
    return card
  })
  const target = newBoardCard("multi-video", "video")
  target.title = "多图视频"
  target.draft.prompt = "根据三个来源生成视频"
  target.draft.settings.videoInputMode = "multi-reference"
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [...sources, target],
      draftEdges: sources.map((card) => ({
        id: `edge-${card.id}`,
        sourceID: card.id,
        targetID: target.id,
        role: "reference" as const,
      })),
    },
  })
  try {
    for (let attempt = 0; attempt < 50 && value.container.querySelectorAll(".x6-node").length < 4; attempt++)
      await Bun.sleep(10)
    const node = value.container.querySelector('.studio-board-card[aria-label="多图视频"]')!.closest(".x6-node")!
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(3)
    expect(
      new Set(
        Array.from(value.container.querySelectorAll(".studio-composer-ref-image")).map((image) =>
          image.getAttribute("src"),
        ),
      ).size,
    ).toBe(1)
    expect(value.container.querySelectorAll(".x6-edge")).toHaveLength(3)
    button(value.container, "删除参考图 图片 02").click()
    await Bun.sleep(30)
    expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(2)
    expect(value.container.querySelectorAll(".x6-edge")).toHaveLength(2)
    expect(
      Array.from(value.container.querySelectorAll(".studio-composer-ref-image")).map((image) =>
        image.getAttribute("alt"),
      ),
    ).toEqual(["图片 01", "图片 03"])
    button(value.container, "发送新任务").click()
    await Bun.sleep(40)
    expect(value.requests).toHaveLength(1)
    expect(value.requests[0].board.snapshot.references.map((reference) => reference.sourceID)).toEqual([
      "source-1",
      "source-3",
    ])
    expect(value.stored.document.draftEdges.map((edge) => edge.sourceID)).toEqual(["source-1", "source-3"])
    button(value.container, "删除参考图 图片 01").click()
    expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(1)
    button(value.container, "删除参考图 图片 03").click()
    expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(0)
    expect(button(value.container, "上传参考图").disabled).toBe(false)
    await Bun.sleep(30)
    expect(value.container.querySelectorAll(".x6-edge")).toHaveLength(0)
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
    button(value.container, "退出画布").click()
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
      button(value.container, "退出画布").click()
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
    button(value.container, "退出画布").click()
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
    button(value.container, "退出画布").click()
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
        button(value.container, "退出画布").click()
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
        button(value.container, "退出画布").click()
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
    button(value.container, "退出画布").click()
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
    button(value.container, "退出画布").click()
    await Bun.sleep(30)
    expect(value.exits).toEqual([])
    expect(value.container.textContent).toContain("本地草稿备份失败")
    Object.defineProperty(localStorage, "setItem", { configurable: true, value: setItem })
    button(value.container, "退出画布").click()
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

test.each([
  ["image", "reference"],
  ["video", "reference"],
  ["video", "firstFrame"],
  ["video", "lastFrame"],
] as const)("completed edges reach the %s card border at %s while a dragged edge uses its port", async (kind, role) => {
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
  const source = newBoardCard("edge-source", "image", { x: 100, y: 100 })
  source.cover = { generationID: "edge-result", mediaID: "edge-image" }
  source.taskLinks = [
    {
      generationID: "edge-result",
      submissionID: "edge-submission",
      visible: true,
      snapshot: { prompt: "source", settings: source.draft.settings, references: [] },
    },
  ]
  const targets = ["loaded-target", "new-target"].map((id, index) => {
    const card = newBoardCard(id, kind, { x: 600, y: 100 + index * 400 })
    card.draft.settings.videoInputMode = role === "reference" ? "multi-reference" : "first-last-frame"
    return card
  })
  const value = await setup({
    document: {
      ...emptyBoard(),
      cards: [source, ...targets],
      draftEdges: [{ id: "loaded-edge", sourceID: source.id, targetID: targets[0].id, role }],
    },
    results: {
      "edge-result": {
        id: "edge-result",
        status: "succeeded",
        capability: "image.generate",
        provider: "internel",
        model: "seedream-5-pro",
        prompt: "source",
        aspectRatio: "1:1",
        createdAt: 1,
        images: [{ id: "edge-image", url: "https://example.test/source.png" }],
      },
    },
  })
  try {
    const graph = captured.graph!
    const edge = graph.getCellById("loaded-edge")!
    const sourceNode = graph.getCellById(source.id)!
    const targetNode = graph.getCellById(targets[0].id)!
    if (!edge.isEdge() || !sourceNode.isNode() || !targetNode.isNode()) throw new Error("Expected connected cards")
    const view = graph.findViewByCell(edge)!
    if (!view.isEdgeView()) throw new Error("Expected a rendered edge")
    expect(edge.getSource()).toMatchObject({ cell: source.id, port: "output" })
    expect(edge.getTarget()).toMatchObject({ cell: targets[0].id, port: role })
    expect(view.sourcePoint.x).toBe(402)
    expect(view.targetPoint.x).toBe(602)
    Reflect.apply(graph.trigger, graph, ["node:click", { node: targetNode, e: new MouseEvent("click") }])
    expect(view.targetPoint.x).toBe(602)
    Reflect.apply(graph.trigger, graph, ["blank:click", {}])
    expect(view.targetPoint.x).toBe(602)
    sourceNode.resize(204, 330)
    sourceNode.position(150, 130)
    targetNode.resize(304, 50)
    expect(view.sourcePoint.x).toBe(352)
    expect(view.targetPoint.x).toBe(602)
    expect(view.targetPoint.y).toBe(138)
    const temporary = Reflect.apply(graph.options.connecting.createEdge!, graph, [{}])
    if (!temporary?.isEdge()) throw new Error("Expected a temporary edge")
    temporary.setSource({ cell: source.id, port: "output" })
    temporary.setTarget({ x: 550, y: 500 })
    graph.addEdge(temporary)
    expect(temporary.getSource().connectionPoint).toBeUndefined()
    Reflect.apply(graph.trigger, graph, ["edge:mouseenter", { edge: temporary }])
    expect(graph.findViewByCell(temporary)?.container.classList.contains("studio-board-edge-hover")).toBe(false)
    temporary.setTarget({ cell: targets[1].id, port: role })
    expect(temporary.getSource().connectionPoint).toBeUndefined()
    Reflect.apply(graph.trigger, graph, ["edge:connected", { edge: temporary }])
    expect(temporary.getSource()).toMatchObject({
      cell: source.id,
      port: "output",
      connectionPoint: { name: "studio-board-card-border" },
    })
    expect(temporary.getTarget()).toMatchObject({
      cell: targets[1].id,
      port: role,
      connectionPoint: { name: "studio-board-card-border" },
    })
    await Bun.sleep(30)
    const connected = graph.findViewByCell(temporary)!
    if (!connected.isEdgeView()) throw new Error("Expected a completed edge")
    expect(connected.sourcePoint.x).toBe(352)
    expect(connected.targetPoint.x).toBe(602)
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    Object.defineProperty(media, "matches", { value: true })
    const matchMedia = spyOn(window, "matchMedia").mockReturnValue(media)
    try {
      const click = (type = "edge:click", button = 0) =>
        Reflect.apply(graph.trigger, graph, [type, { edge: temporary, e: new MouseEvent("click", { button }) }])
      click()
      expect(graph.getCellById(temporary.id)).toBe(temporary)
      Reflect.apply(graph.trigger, graph, ["edge:mouseenter", { edge: temporary }])
      expect(connected.container.classList.contains("studio-board-edge-hover")).toBe(true)
      expect(temporary.attr("line/stroke")).toBe("#7775e7")
      click("edge:dblclick")
      click("edge:click", 2)
      expect(graph.getCellById(temporary.id)).toBe(temporary)
      Reflect.apply(graph.trigger, graph, ["edge:mouseleave", { edge: temporary }])
      expect(connected.container.classList.contains("studio-board-edge-hover")).toBe(false)
      expect(temporary.attr("line/stroke")).toBe("#a7abc4")
      Reflect.apply(graph.trigger, graph, ["edge:mouseenter", { edge: temporary }])
      click()
      expect(graph.getCellById(temporary.id)).toBeNull()
      expect(connected.container.classList.contains("studio-board-edge-hover")).toBe(false)
      expect(graph.getCellById(edge.id)).toBe(edge)
      await Bun.sleep(30)
      const backup = JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!)
      expect(backup.document.draftEdges.map((item: { id: string }) => item.id)).toEqual([edge.id])
    } finally {
      matchMedia.mockRestore()
    }
  } finally {
    value.dispose()
    addNode.mockRestore()
  }
})

test("card drags hide the composer, retain its draft and restore it with guides cleared on release or interruption", async () => {
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
    const element = value.container.querySelector('[data-cell-id="moving"]')!
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    const composer = value.container.querySelector<HTMLDivElement>(".studio-board-composer")!
    const prompt = composer.querySelector<HTMLTextAreaElement>("textarea")!
    expect(composer.style.visibility).toBe("hidden")
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    expect(composer.style.visibility).toBe("")
    prompt.value = "拖动时保留草稿"
    prompt.dispatchEvent(new Event("input", { bubbles: true }))
    ;["node:moved", "pointerup", "pointercancel", "blur"].forEach((event) => {
      node.position(103, 102)
      Reflect.apply(graph.trigger, graph, ["node:moving", { node }])
      expect(composer.style.visibility).toBe("hidden")
      expect(value.container.querySelectorAll(".studio-board-guide")).toHaveLength(2)
      expect(node.position()).toEqual({ x: 100, y: 100 })
      if (event === "node:moved") Reflect.apply(graph.trigger, graph, [event, { node }])
      if (event === "pointerup" || event === "pointercancel")
        document.dispatchEvent(new PointerEvent(event, { bubbles: true }))
      if (event === "blur") window.dispatchEvent(new Event(event))
      expect(value.container.querySelectorAll(".studio-board-guide")).toHaveLength(0)
      expect(composer.style.visibility).toBe("")
      expect(value.container.querySelector("textarea")).toBe(prompt)
      expect(prompt.value).toBe("拖动时保留草稿")
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

test.each([
  ["image.upscale", "restoration_8k"],
  ["image.upscale", "restoration"],
  ["image.upscale", "super_resolution"],
  ["image.upscale", "uncertain"],
  ["image.upscale", "save-failed"],
  ["image.upscale", "rejected"],
  ["image.cutout", "success"],
  ["image.cutout", "uncertain"],
  ["image.cutout", "save-failed"],
  ["image.cutout", "rejected"],
  ["image.cutout", "prepare-failed"],
  ["image.inpaint", "redraw"],
  ["image.inpaint", "erase"],
  ["image.inpaint", "prompt-only"],
  ["image.inpaint", "uncertain"],
  ["image.inpaint", "save-failed"],
  ["image.inpaint", "rejected"],
  ["image.inpaint", "prepare-failed"],
  ["image.inpaint", "upload-failed"],
  ["image.outpaint", "success"],
  ["image.outpaint", "custom"],
  ["image.outpaint", "uncertain"],
  ["image.outpaint", "save-failed"],
  ["image.outpaint", "rejected"],
  ["image.outpaint", "prepare-failed"],
  ["image.outpaint", "upload-failed"],
] as const)(
  "%s %s creates a connected result card, preserves the source draft and supports further editing",
  async (capability, scenario) => {
    const mode = scenario === "restoration" || scenario === "super_resolution" ? scenario : "restoration_8k"
    const prompt = capability === "image.outpaint" ? scenario === "custom" ? "扩展更多环境" : STUDIO_OUTPAINT_PROMPT : capability === "image.inpaint"
      ? scenario === "erase" ? "消除涂抹区域内的物体" : scenario === "prompt-only" ? "把花瓶改成台灯" : "重绘所选区域"
      : capability === "image.cutout" ? BOARD_CUTOUT_PROMPT : BOARD_UPSCALE_PROMPT
    const source = newBoardCard("upscale-source", "image", { x: 100, y: 100 })
    source.draft.prompt = "保留原来的提示词"
    source.cover = { generationID: "source-result", mediaID: "cover" }
    source.preview = { generationID: "source-result", mediaID: "shown" }
    source.currentGenerationID = "source-result"
    source.taskLinks = [{
      generationID: "source-result", submissionID: crypto.randomUUID(), visible: true,
      snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] },
    }]
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image")!
    const NativeImage = globalThis.Image
    const images: string[] = []
    const sizes: { width: number; height: number }[] = []
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: class extends NativeImage {
        get naturalWidth() { return 12000 }
        get naturalHeight() { return 6000 }
        set src(value: string) {
          images.push(value)
          queueMicrotask(() => this.dispatchEvent(new Event(scenario === "prepare-failed" ? "error" : "load")))
        }
      },
    })
    const blob = spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      sizes.push({ width: this.width, height: this.height })
      callback(new Blob(["prepared-source"], { type: "image/jpeg" }))
    })
    const dataURL = spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${btoa("composite-image")}`)
    const uploadResponse = Promise.withResolvers<Response>()
    const options: Parameters<typeof setup>[0] = {
      uploadResponses: scenario === "upload-failed" ? [
        ...(capability === "image.outpaint" ? [uploadResponse.promise] : [Promise.resolve(Response.json({ error: "原图上传失败" }, { status: 503 })), uploadResponse.promise]),
      ] : undefined,
      accepted: scenario !== "rejected",
      reject: scenario === "uncertain" ? "network" : undefined,
      saveFailures: scenario === "save-failed" ? 1 : undefined,
      document: { ...emptyBoard(), cards: [source] },
      acceptedResult: {
        id: "accepted-new", status: "succeeded", capability, provider: "internel",
        model: capability === "image.inpaint" ? "inpainting" : capability === "image.cutout" ? "remove_bg" : "magnify", prompt, aspectRatio: "16:9", createdAt: 2,
        images: [{ id: "upscaled-image", url: "https://example.test/upscaled.png", width: 8000, height: 4000 }],
      },
      results: {
        "source-result": {
          id: "source-result", status: "succeeded", capability: "image.generate", provider: "internel",
          model: "seedream-5-pro", prompt: source.draft.prompt, aspectRatio: "16:9", createdAt: 1,
          images: [
            { id: "cover", url: "https://example.test/cover.png" },
            { id: "shown", url: "https://example.test/preview.png", remoteUrl: "https://example.test/original.png" },
          ],
        },
      },
    }
    let value = await setup(options)
    try {
      const node = value.container.querySelector('[data-cell-id="upscale-source"]')!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      button(value.container, "变清晰").click()
      expect(button(value.container, "变清晰").getAttribute("aria-pressed")).toBe("true")
      expect(value.container.querySelector(".studio-board-composer")).toBeNull()
      if (capability === "image.upscale") {
        const option = value.container.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!
        option.checked = true
        option.dispatchEvent(new Event("change", { bubbles: true }))
        const generate = button(value.container, "生成")
        generate.click()
        generate.click()
      }
      if (capability === "image.cutout") {
        const cutout = button(value.container, "抠图")
        cutout.click()
        expect(cutout.getAttribute("aria-pressed")).toBe("true")
        expect(cutout.disabled).toBe(true)
        expect(button(value.container, "变清晰").getAttribute("aria-pressed")).toBe("false")
        expect(value.container.querySelector(".studio-board-upscale, .studio-board-composer")).toBeNull()
        cutout.click()
      }
      if (capability === "image.inpaint") {
        button(value.container, "智能重绘").click()
        expect(button(value.container, "智能重绘").getAttribute("aria-pressed")).toBe("true")
        expect(button(value.container, "变清晰").getAttribute("aria-pressed")).toBe("false")
        expect(value.container.querySelector(".studio-board-upscale, .studio-board-composer")).toBeNull()
        await Bun.sleep(20)
        if (scenario === "prepare-failed") {
          expect(value.container.querySelector('[role="alert"]')?.textContent).toContain("图片加载失败")
        }
        if (scenario !== "prepare-failed") {
          const generate = button(value.container, "生成")
          expect(generate.disabled).toBe(true)
          const canvas = value.container.querySelector<HTMLCanvasElement>("canvas.studio-inpaint-mask")!
          canvas.setPointerCapture = () => {}
          canvas.hasPointerCapture = () => false
          canvas.getBoundingClientRect = () => new DOMRect(10, 20, 300, 150)
          if (scenario !== "prompt-only") {
            canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 100, clientY: 80 }))
            canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 150, clientY: 90 }))
            canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 150, clientY: 90 }))
            expect(button(value.container, "撤销").disabled).toBe(false)
            button(value.container, "撤销").click()
            expect(generate.disabled).toBe(true)
            button(value.container, "重做").click()
            expect(generate.disabled).toBe(false)
          }
          if (scenario === "prompt-only") {
            const prompt = value.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="智能重绘提示词"]')!
            prompt.value = "把花瓶改成台灯"
            prompt.dispatchEvent(new Event("input", { bubbles: true }))
          }
          if (scenario === "erase") {
            const erase = value.container.querySelector<HTMLInputElement>('input[value="erase"]')!
            erase.checked = true
            erase.dispatchEvent(new Event("change", { bubbles: true }))
          }
          generate.click()
          generate.click()
        }
      }
      if (capability === "image.outpaint") {
        button(value.container, "扩图").click()
        await Bun.sleep(20)
        expect(button(value.container, "扩图").getAttribute("aria-pressed")).toBe("true")
        expect(button(value.container, "变清晰").getAttribute("aria-pressed")).toBe("false")
        expect(value.container.querySelector(".studio-board-upscale, .studio-board-composer")).toBeNull()
        const generate = button(value.container, "生成")
        expect(generate.disabled).toBe(true)
        if (scenario !== "prepare-failed") {
          expect(value.container.querySelectorAll(".studio-enlarging-handle")).toHaveLength(8)
          button(value.container, "1:1").click()
          expect(generate.disabled).toBe(false)
          // Cancelling a transient expansion must leave the original card untouched.
          button(value.container, "取消").click()
          expect(value.container.querySelector(".studio-board-outpaint-stage")).toBeNull()
          expect(value.container.querySelector(".studio-board-composer")).not.toBeNull()
          button(value.container, "扩图").click()
          await Bun.sleep(20)
          button(value.container, "1:1").click()
          if (scenario === "custom") {
            const promptInput = value.container.querySelector<HTMLInputElement>('[aria-label="扩图提示词"]')!
            promptInput.value = "扩展更多环境"
            promptInput.dispatchEvent(new Event("input", { bubbles: true }))
          }
          button(value.container, "生成").click()
          button(value.container, "处理中…").click()
        }
      }
      await Bun.sleep(80)
      if (scenario === "upload-failed") {
        expect(value.uploads).toHaveLength(capability === "image.outpaint" ? 1 : 2)
        expect(value.requests).toHaveLength(0)
        expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(1)
        expect(button(value.container, "处理中…").disabled).toBe(true)
        uploadResponse.resolve(capability === "image.outpaint" ? Response.json({ error: "原图上传失败" }, { status: 503 }) : Response.json({ path: "/test/.octo/test-board/uploads/composite.png" }))
        await Bun.sleep(50)
        expect(button(value.container, "生成").disabled).toBe(false)
        expect(value.container.querySelector('[role="alert"]')?.textContent).toContain("原图上传失败")
        expect(value.requests).toHaveLength(0)
        expect(value.stored.document.cards).toEqual([source])
        return
      }
      if (scenario === "prepare-failed") {
        expect(value.requests).toHaveLength(0)
        expect(value.uploads).toHaveLength(0)
        expect(value.stored.document.cards).toEqual([source])
        expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(1)
        if (capability === "image.cutout") {
          expect(button(value.container, "抠图").getAttribute("aria-pressed")).toBe("false")
          expect(value.container.querySelector(".studio-board-composer")).not.toBeNull()
        }
        if (capability === "image.inpaint" || capability === "image.outpaint") {
          expect(button(value.container, "生成").disabled).toBe(true)
          button(value.container, "取消").click()
          expect(value.container.querySelector(".studio-board-composer")).not.toBeNull()
        }
        return
      }
      if (scenario === "save-failed" || scenario === "rejected") {
        expect(value.requests).toHaveLength(scenario === "rejected" ? 1 : 0)
        expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(2)
        options.accepted = true
        button(value.container, "重新提交").click()
        await Bun.sleep(80)
      }
      if (scenario === "uncertain") {
        expect(value.requests).toHaveLength(1)
        const pending = structuredClone(value.requests[0])
        expect(JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).pending[0]).toEqual(pending)
        options.reject = undefined
        button(value.container, "刷新状态").click()
        await Bun.sleep(80)
        expect(value.requests[1]).toEqual(pending)
      }
      expect(value.requests).toHaveLength(scenario === "uncertain" || scenario === "rejected" ? 2 : 1)
      expect(value.stored.document.cards).toHaveLength(2)
      expect(images[0]).toBe("https://example.test/original.png")
      expect(sizes).toEqual([{ width: 7500, height: 3750 }])
      expect(value.uploads).toHaveLength(capability === "image.inpaint" ? 2 : 1)
      const child = value.stored.document.cards.find((card) => card.id !== source.id)!
      expect(child.position.x).toBeGreaterThan(source.position.x + 304)
      if (capability === "image.outpaint") expect(child.position.y).toBeLessThanOrEqual(source.position.y)
      expect(child.operation).toMatchObject({
        capability, ...(capability === "image.upscale" ? { mode } : {}),
        source: { sourceID: source.id, generationID: "source-result", mediaID: "shown", image: "https://example.test/original.png" },
        sourceImage: "/test/.octo/test-board/uploads/frame.png",
      })
      expect(value.stored.document.draftEdges).toEqual([{
        id: expect.any(String), sourceID: source.id, targetID: child.id, role: "reference", purpose: "derivation",
      }])
      expect(value.requests[0]).toMatchObject({
        capability, prompt,
        board: { cardID: child.id, snapshot: { operation: child.operation, references: [], settings: { count: 1, aspectRatio: capability === "image.outpaint" ? "1:1" : "16:9" } } },
      })
      if (capability === "image.outpaint") expect(child.operation).toMatchObject({
        sourceWidth: 7500, sourceHeight: 3750, left: 0, right: 0, top: 1875, bottom: 1875,
        realWidth: 7500, realHeight: 7500, ratio: "1:1",
      })
      if (capability === "image.cutout") expect(child.operation).not.toHaveProperty("mode")
      if (capability === "image.inpaint") expect(child.operation).toMatchObject({
        generateMode: scenario === "erase" ? "erase" : "qwen_image_edit", brushSize: 40,
        hasDrawing: scenario !== "prompt-only", compositeImage: "/test/.octo/test-board/uploads/composite.png",
      })
      expect(value.stored.document.cards[0]).toEqual(source)
      expect(value.container.querySelector(".studio-board-composer")).toBeNull()
      expect(value.container.querySelector(".studio-board-upscale")).toBeNull()
      expect(value.container.querySelector(".studio-board-media-toolbar")).not.toBeNull()
      if (capability === "image.outpaint") {
        button(value.container, "扩图").click()
        await Bun.sleep(20)
        expect(value.container.querySelector(".studio-board-outpaint")).not.toBeNull()
        button(value.container, "扩图").click()
        expect(value.container.querySelector(".studio-board-outpaint, .studio-board-composer")).toBeNull()
      }
      button(value.container, "变清晰").click()
      expect(value.container.querySelector(".studio-board-upscale")).not.toBeNull()
      button(value.container, "变清晰").click()
      expect(value.container.querySelector(".studio-board-upscale")).toBeNull()
      expect(value.container.querySelector(".studio-board-composer")).toBeNull()
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(source.draft.prompt)
      const restored = { ...options, reject: undefined, document: structuredClone(value.stored.document), revision: value.stored.revision }
      value.dispose()
      value = await setup(restored)
      const restoredChild = value.container.querySelector(`[data-cell-id="${child.id}"]`)!
      restoredChild.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      restoredChild.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      expect(value.container.querySelector(".studio-board-media-toolbar")).not.toBeNull()
      expect(value.container.querySelector(".studio-board-composer, .studio-board-upscale")).toBeNull()
      expect(value.stored.document.cards.find((card) => card.id === child.id)?.operation).toEqual(child.operation)
    } finally {
      Object.defineProperty(globalThis, "Image", originalImage)
      blob.mockRestore()
      dataURL.mockRestore()
      uploadResponse.resolve(Response.json({ path: "/test/.octo/test-board/uploads/composite.png" }))
      value.dispose()
    }
  },
)

test.each(["success", "cancel", "swap", "replace", "multi-reference", "multi-source-only", "remove", "uncertain", "save-failed", "rejected", "no-permission"] as const)(
  "image video shortcut %s uses an independent video draft and pins the displayed source", async (scenario) => {
    const source = newBoardCard("video-source", "image", { x: 100, y: 100 })
    source.draft.prompt = "原图片草稿保持不变"
    source.cover = { generationID: "source-result", mediaID: "cover" }
    source.preview = { generationID: "source-result", mediaID: "shown" }
    source.currentGenerationID = "source-result"
    source.taskLinks = [{ generationID: "source-result", submissionID: crypto.randomUUID(), visible: true,
      snapshot: { prompt: source.draft.prompt, settings: source.draft.settings, references: [] } }]
    const options: NonNullable<Parameters<typeof setup>[0]> = {
      document: { ...emptyBoard(), cards: [source] }, video: scenario !== "no-permission", accepted: scenario !== "rejected",
      reject: scenario === "uncertain" ? "network" : undefined, saveFailures: scenario === "save-failed" ? 1 : undefined,
      acceptedResult: { id: "accepted-new", status: "succeeded", capability: "video.generate", provider: "internel",
        model: "seedance", aspectRatio: "1:1", prompt: "镜头向远方推进", createdAt: 2,
        images: [{ id: "video-result", kind: "video", url: "https://example.test/video.mp4" }] },
      results: { "source-result": { id: "source-result", status: "succeeded", capability: "image.generate", provider: "internel",
        model: "seedream-5-pro", aspectRatio: "1:1", prompt: source.draft.prompt, createdAt: 1,
        images: [{ id: "cover", url: "https://example.test/cover.png" },
          { id: "shown", url: "https://example.test/preview.png", remoteUrl: "https://example.test/original.png" }] } },
    }
    let value = await setup(options)
    try {
      const node = value.container.querySelector('[data-cell-id="video-source"]')!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const toggle = button(value.container, "视频生成")
      if (scenario === "no-permission") { expect(toggle.disabled).toBe(true); return }
      toggle.click()
      expect(toggle.getAttribute("aria-pressed")).toBe("true")
      expect(value.container.querySelector(".studio-board-composer.video")).not.toBeNull()
      expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("")
      expect(value.container.querySelector<HTMLImageElement>(".studio-composer-video-image")?.src).toBe("https://example.test/original.png")
      expect(button(value.container, "上传尾帧").disabled).toBe(false)
      expect(button(value.container, "发送新任务").disabled).toBe(true)
      expect(value.stored.document.cards).toEqual([source])
      const prompt = value.container.querySelector<HTMLTextAreaElement>("textarea")!
      prompt.value = "镜头向远方推进"
      prompt.dispatchEvent(new Event("input", { bubbles: true }))
      const upload = async (label: string) => {
        button(value.container, label).click()
        const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
        const transfer = new DataTransfer()
        transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
        input.files = transfer.files
        input.dispatchEvent(new Event("change", { bubbles: true }))
        await Bun.sleep(60)
      }
      if (scenario === "cancel") {
        button(value.container, "视频设置").click()
        expect(value.container.querySelector('[role="dialog"]')).not.toBeNull()
        prompt.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
        expect(value.container.querySelector('[role="dialog"]')).toBeNull()
        button(value.container, "视频设置").click()
        prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        expect(value.container.querySelector('[role="dialog"]')).toBeNull()
        expect(toggle.getAttribute("aria-pressed")).toBe("true")
        toggle.click()
        expect(value.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(source.draft.prompt)
        expect(value.requests).toHaveLength(0)
        expect(value.stored.document.cards).toEqual([source])
        return
      }
      if (scenario === "swap") {
        button(value.container, "交换首尾帧").click()
        expect(button(value.container, "发送新任务").disabled).toBe(true)
        await upload("上传首帧")
      }
      if (scenario === "replace") await upload("替换首帧")
      if (scenario === "remove") button(value.container, "删除首帧").click()
      if (scenario === "multi-reference" || scenario === "multi-source-only") {
        button(value.container, "首尾帧").click()
        button(value.container, "多图参考").click()
        expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(1)
        expect(value.container.querySelector<HTMLImageElement>(".studio-composer-ref-image")?.src).toBe("https://example.test/original.png")
        button(value.container, "多图参考").click()
        button(value.container, "首尾帧").click()
        expect(value.container.querySelector<HTMLImageElement>(".studio-composer-video-image")?.src).toBe("https://example.test/original.png")
        button(value.container, "首尾帧").click()
        button(value.container, "多图参考").click()
        expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(1)
        if (scenario === "multi-reference") await upload("继续上传参考图")
      }
      const send = button(value.container, "发送新任务")
      expect(send.disabled).toBe(false)
      send.click()
      send.click()
      await Bun.sleep(100)
      if (scenario === "save-failed" || scenario === "rejected") {
        expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(2)
        options.accepted = true
        button(value.container, "重新提交").click()
        await Bun.sleep(100)
      }
      if (scenario === "uncertain") {
        const pending = structuredClone(value.requests[0])
        options.reject = undefined
        button(value.container, "刷新状态").click()
        await Bun.sleep(100)
        expect(value.requests[1]).toEqual(pending)
      }
      expect(value.requests).toHaveLength(scenario === "uncertain" || scenario === "rejected" ? 2 : 1)
      expect(value.stored.document.cards).toHaveLength(2)
      expect(value.stored.document.cards[0]).toEqual(source)
      const child = value.stored.document.cards[1]
      expect(child.kind).toBe("video")
      expect(child.position.x).toBeGreaterThan(source.position.x + 304)
      const refs = value.requests.at(-1)!.board.snapshot.references
      if (scenario === "replace" || scenario === "remove") expect(value.stored.document.draftEdges).toHaveLength(0)
      if (scenario !== "replace" && scenario !== "remove") expect(value.stored.document.draftEdges[0]).toMatchObject({
        sourceID: source.id, targetID: child.id, role: scenario === "swap" ? "lastFrame" : "firstFrame",
        reference: { mediaID: "shown", image: "https://example.test/original.png" },
      })
      if (scenario === "multi-reference" || scenario === "multi-source-only") {
        expect(refs).toHaveLength(scenario === "multi-reference" ? 2 : 1)
        expect(refs[0]).toMatchObject({ role: "reference", mediaID: "shown", image: "https://example.test/original.png" })
      }
      if (scenario === "replace") {
        expect(refs[0].role).toBe("firstFrame")
        expect(refs[0].sourceID.startsWith("upload:")).toBe(true)
      }
      if (scenario === "remove") expect(refs).toHaveLength(0)
      if (!["multi-reference", "multi-source-only", "replace", "remove"].includes(scenario)) expect(refs[0]).toMatchObject({
        sourceID: source.id, generationID: "source-result", mediaID: "shown", image: "https://example.test/original.png",
        role: scenario === "swap" ? "lastFrame" : "firstFrame",
      })
      expect(value.requests.at(-1)).toMatchObject({ capability: "video.generate", prompt: "镜头向远方推进",
        board: { snapshot: { settings: { videoInputMode: scenario === "multi-reference" || scenario === "multi-source-only" ? "multi-reference" : "first-last-frame",
          videoMode: scenario === "remove" ? "text" : "first_last_frame", duration: "5", quality: "720", count: 1 } } } })
      expect(value.container.querySelectorAll(".studio-board-media-toolbar button")).toHaveLength(2)
      const restored = { ...options, reject: undefined, document: BoardDocument.parse(value.stored.document), revision: value.stored.revision }
      value.dispose()
      value = await setup(restored)
      expect(value.stored.document.draftEdges).toEqual(restored.document.draftEdges)
      expect(value.stored.document.cards[1].taskLinks[0].snapshot.references).toEqual(refs)
      if (scenario === "success") {
        const childNode = value.container.querySelector(`[data-cell-id="${child.id}"]`)!
        childNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
        childNode.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
        button(value.container, "首尾帧").click()
        button(value.container, "多图参考").click()
        expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(1)
        expect(value.container.querySelector<HTMLImageElement>(".studio-composer-ref-image")?.src).toBe("https://example.test/original.png")
        expect(value.container.querySelector<SVGElement>(".x6-edge")?.style.display).not.toBe("none")
        button(value.container, "删除参考图 图片").click()
        expect(value.container.querySelectorAll(".studio-composer-ref-image")).toHaveLength(0)
        await Bun.sleep(20)
        expect(value.container.querySelectorAll(".x6-edge")).toHaveLength(0)
      }
    } finally { value.dispose() }
  },
)


test.each(["image", "video", "upscale", "cutout", "inpaint", "outpaint", "save-failed", "rejected", "uncertain", "no-permission", "video-edit", "video-replace"] as const)(
  "regenerate %s replays the displayed task without edges or reused task history", async (scenario) => {
    const kind = scenario.startsWith("video") ? "video" : "image"
    const source = newBoardCard("regenerate-source", kind, { x: 100, y: 100 })
    source.draft.prompt = "后来修改的草稿"
    const snapshot = BoardSnapshot.parse({
      prompt: scenario === "upscale" ? BOARD_UPSCALE_PROMPT : scenario === "cutout" ? BOARD_CUTOUT_PROMPT : "原始任务的提示词",
      settings: { styleModel: "seedream-5-pro", count: 2, aspectRatio: "16:9", duration: "8", quality: "1080",
        ...(kind === "video" ? { videoMode: "first_last_frame", videoInputMode: "first-last-frame" } : {}) },
      references: [{ sourceID: "removed-upstream", generationID: "old-reference-task", mediaID: "old-reference", title: "固定原图",
        image: "https://example.test/frozen-reference.png", role: kind === "video" ? "firstFrame" : "reference" }],
    })
    if (["upscale", "cutout", "inpaint", "outpaint"].includes(scenario)) {
      snapshot.settings.count = 1
      snapshot.references = []
      snapshot.operation = {
        ...(scenario === "upscale" ? { capability: "image.upscale", mode: "super_resolution" } as const
          : scenario === "cutout" ? { capability: "image.cutout" } as const
          : scenario === "inpaint" ? { capability: "image.inpaint", compositeImage: "/test/.octo/test-board/uploads/mask.png",
            generateMode: "erase", hasDrawing: true, brushSize: 64 } as const
          : { capability: "image.outpaint", sourceWidth: 600, sourceHeight: 300, left: 100, right: 200, top: 50, bottom: 150,
            realWidth: 900, realHeight: 500 } as const),
        sourceImage: "/test/.octo/test-board/uploads/original.png",
        source: { sourceID: "original-source", generationID: "input-task", mediaID: "input", title: "原始输入",
          image: "https://example.test/input.png", role: "reference" },
      }
      source.operation = snapshot.operation
    }
    source.taskLinks = ["original-result", "latest-result"].map((generationID) => ({
      generationID, submissionID: crypto.randomUUID(), visible: true,
      snapshot: generationID === "original-result" ? snapshot : { ...snapshot, prompt: "较新的历史参数" },
    }))
    source.currentGenerationID = "latest-result"
    source.cover = { generationID: "latest-result", mediaID: "shown" }
    source.preview = { generationID: "original-result", mediaID: "shown" }
    const results = Object.fromEntries(source.taskLinks.map((link) => [link.generationID, {
      id: link.generationID, status: "succeeded", capability: snapshot.operation?.capability ?? (kind === "video" ? "video.generate" : "image.generate"),
      provider: "internel", model: "seedream-5-pro", aspectRatio: "16:9", prompt: link.snapshot.prompt, createdAt: 1,
      images: [{ id: "shown", kind, url: "https://example.test/output.png" }],
    } satisfies StudioGenerationResult]))
    const options: NonNullable<Parameters<typeof setup>[0]> = {
      document: { ...emptyBoard(), cards: [source, newBoardCard("occupied", "image", { x: 524, y: 100 })] }, results,
      accepted: scenario !== "rejected", seedream: scenario !== "no-permission",
      reject: scenario === "uncertain" ? "network" : undefined,
      saveFailures: scenario === "save-failed" ? 1 : undefined,
      acceptedResult: { ...results["original-result"], id: "accepted-new" },
    }
    let value = await setup(options)
    try {
      const node = value.container.querySelector('[data-cell-id="regenerate-source"]')!
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      const regenerate = button(value.container, "再次生成")
      regenerate.click()
      regenerate.click()
      await Bun.sleep(100)
      if (scenario === "no-permission") {
        expect(value.stored.document.cards).toHaveLength(2)
        expect(value.requests).toHaveLength(0)
        return
      }
      if (scenario === "save-failed" || scenario === "rejected") {
        expect(value.container.querySelectorAll(".studio-board-card")).toHaveLength(3)
        options.accepted = true
        button(value.container, "重新提交").click()
        await Bun.sleep(100)
      }
      if (scenario === "uncertain") {
        const pending = structuredClone(value.requests[0])
        options.reject = undefined
        button(value.container, "刷新状态").click()
        await Bun.sleep(100)
        expect(value.requests[1]).toEqual(pending)
      }
      expect(value.stored.document.cards).toHaveLength(3)
      expect(value.stored.document.draftEdges).toHaveLength(0)
      expect(value.stored.document.cards[0]).toEqual(source)
      const child = value.stored.document.cards[2]
      expect(child.kind).toBe(kind)
      expect(child.position.y).toBe(source.position.y)
      expect(child.position.x).toBeGreaterThan(524 + 304)
      expect(child.regeneration).toEqual({ sourceID: source.id, generationID: "original-result", snapshot })
      expect(child.taskLinks).toHaveLength(1)
      expect(child.taskLinks[0].generationID).toBe("accepted-new")
      expect(value.requests.at(-1)).toMatchObject({
        capability: snapshot.operation?.capability ?? (kind === "video" ? "video.generate" : "image.generate"),
        prompt: snapshot.prompt, board: { cardID: child.id, snapshot },
      })
      expect(value.requests.at(-1)!.board.replacedGenerationID).toBeUndefined()
      expect(value.requests).toHaveLength(scenario === "uncertain" || scenario === "rejected" ? 2 : 1)
      expect(value.uploads).toHaveLength(0)
      if (scenario !== "video-edit" && scenario !== "video-replace") return
      const restored = { ...options, document: BoardDocument.parse(value.stored.document), revision: value.stored.revision }
      value.dispose()
      value = await setup(restored)
      const childNode = value.container.querySelector(`[data-cell-id="${child.id}"]`)!
      childNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      childNode.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      expect(value.container.querySelector<HTMLImageElement>(".studio-composer-video-image")?.src).toBe(snapshot.references[0].image)
      button(value.container, "首尾帧").click()
      button(value.container, "多图参考").click()
      expect(value.container.querySelector<HTMLImageElement>(".studio-composer-ref-image")?.src).toBe(snapshot.references[0].image)
      button(value.container, "多图参考").click()
      button(value.container, "首尾帧").click()
      if (scenario === "video-replace") {
        button(value.container, "替换首帧").click()
        const input = value.container.querySelector<HTMLInputElement>('input[type="file"]')!
        const transfer = new DataTransfer()
        transfer.items.add(new File(["frame"], "frame.png", { type: "image/png" }))
        input.files = transfer.files
        input.dispatchEvent(new Event("change", { bubbles: true }))
        await Bun.sleep(60)
        const replaced = BoardDocument.parse(JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document).cards[2]
        expect(replaced.draft.references).toEqual([])
        expect(replaced.draft.assets).toHaveLength(1)
        expect(replaced.regeneration?.snapshot).toEqual(snapshot)
        return
      }
      button(value.container, "交换首尾帧").click()
      await Bun.sleep(40)
      const edited = BoardDocument.parse(JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document).cards[2]
      expect(edited.draft.references?.[0].role).toBe("lastFrame")
      expect(edited.regeneration?.snapshot).toEqual(snapshot)
      button(value.container, "删除尾帧").click()
      await Bun.sleep(40)
      expect(BoardDocument.parse(JSON.parse(localStorage.getItem("studio.board.backup:http://board.test:/test:test-board")!).document).cards[2].draft.references).toEqual([])
    } finally { value.dispose() }
  },
)
