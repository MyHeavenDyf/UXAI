import { expect, spyOn, test } from "bun:test"
import { plugin } from "bun"
import solid from "vite-plugin-solid"
import { createComponent, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createOpencodeClient, type Session } from "@opencode-ai/sdk/v2/client"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { Event as SDKEvent } from "@opencode-ai/sdk/v2/client"
import type { AgentSidebarProps, BeforeSectionApi, RecentSectionApi } from "@/components/agent-sidebar"

const transform = solid({ hot: false }).transform
if (typeof transform !== "function") throw new Error("Solid transform is unavailable")
plugin({
  name: "studio-session-sections-dom-test",
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
const { StudioSessionSections, studioSidebarPolicy } = await import("./sidebar")
const { AgentSidebar } = await import("@/components/agent-sidebar")
const sdkContext = await import("@/context/global-sdk")
const syncContext = await import("@/context/global-sync")
const languageContext = await import("@/context/language")
const layoutContext = await import("@/context/layout")
const platformContext = await import("@/context/platform")
const serverContext = await import("@/context/server")
const notificationContext = await import("@/context/notification")
const projectDir = await import("@/hooks/use-project-dir")
const dialogContext = await import("@opencode-ai/ui/context/dialog")
const router = await import("@solidjs/router")
const { tracker } = await import("@/utils/tracker")

function sidebarSession(
  id: string,
  mode: Session["studio_mode"] = "conversation",
  extra: Partial<Session> = {},
): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/test",
    title: id,
    version: "test",
    agent: "octo_studio",
    studio_mode: mode,
    pinned: false,
    sort_order: 0,
    time: { created: 1, updated: 1 },
    ...extra,
  }
}

// Replace application contexts only; exercise the real sidebar, session actions,
// event emitter and SDK transport without bootstrapping the whole application.
async function sidebarHarness(
  options: {
    studio?: boolean
    paginated?: boolean
    sections?: boolean
    customRecent?: boolean
    loadMoreMode?: AgentSidebarProps["loadMoreMode"]
  } = {},
) {
  const url = `http://sidebar-${crypto.randomUUID()}.test`
  const policy: Pick<AgentSidebarProps, "canMoveSession" | "retainSessionOnRefresh" | "onSessionDeleted"> =
    options.studio ? studioSidebarPolicy({ url: () => url, directory: () => "/test" }) : {}
  const events = createGlobalEmitter<{ [key: string]: SDKEvent }>()
  const [server, setServer] = createStore({ rows: [sidebarSession("conversation")], rejectDelete: "" })
  const [child, setChild] = createStore({ deleted: {} as Record<string, boolean>, session_status: {} })
  const calls: (string | undefined)[] = []
  const boardCursors: (string | null)[] = []
  const reorders: string[][] = []
  const deleted: string[] = []
  const api: { recent?: RecentSectionApi; section?: BeforeSectionApi } = {}
  const transport = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname === "/experimental/session") {
        const cursor = new URL(request.url).searchParams.get("cursor")
        boardCursors.push(cursor)
        return Response.json([sidebarSession(cursor ? "board-2" : "board-1", "board")], {
          headers: cursor ? undefined : { "x-next-cursor": "board-page-2" },
        })
      }
      if (request.url.endsWith("/session/reorder")) {
        reorders.push(((await request.json()) as { ids: string[] }).ids)
        return Response.json(true)
      }
      if (request.method === "DELETE") {
        const id = new URL(request.url).pathname.split("/").at(-1)!
        return id === server.rejectDelete
          ? Response.json({ message: "删除失败" }, { status: 503 })
          : Response.json(true)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const sdk = {
    url,
    client: createOpencodeClient({ baseUrl: url, fetch: transport, throwOnError: true }),
    event: { ...events, start: async () => {} },
    createClient: (options: Parameters<ReturnType<typeof sdkContext.useGlobalSDK>["createClient"]>[0]) =>
      createOpencodeClient({ baseUrl: url, fetch: transport, throwOnError: true, ...options }),
  }
  const spies = [
    spyOn(sdkContext, "useGlobalSDK").mockReturnValue(sdk),
    spyOn(syncContext, "useGlobalSync").mockReturnValue({ child: () => [child, setChild] } as unknown as ReturnType<
      typeof syncContext.useGlobalSync
    >),
    spyOn(languageContext, "useLanguage").mockReturnValue({ t: (key: string) => key } as unknown as ReturnType<
      typeof languageContext.useLanguage
    >),
    spyOn(layoutContext, "useLayout").mockReturnValue({} as ReturnType<typeof layoutContext.useLayout>),
    spyOn(platformContext, "usePlatform").mockReturnValue({ platform: "web" } as ReturnType<
      typeof platformContext.usePlatform
    >),
    spyOn(serverContext, "useServer").mockReturnValue({ isLocal: () => false } as ReturnType<
      typeof serverContext.useServer
    >),
    spyOn(projectDir, "useProjectDir").mockReturnValue(() => ""),
    spyOn(notificationContext, "useNotification").mockReturnValue({
      session: { markViewed: () => {} },
    } as unknown as ReturnType<typeof notificationContext.useNotification>),
    spyOn(dialogContext, "useDialog").mockReturnValue({ active: undefined, show: () => {}, close: () => {} }),
    spyOn(router, "useNavigate").mockReturnValue(() => {}),
    spyOn(router, "useLocation").mockReturnValue({ pathname: "/test" } as ReturnType<typeof router.useLocation>),
    spyOn(tracker, "interaction").mockImplementation(() => {}),
  ]
  const container = document.createElement("div")
  document.body.append(container)
  const unmount = render(
    () =>
      createComponent(AgentSidebar, {
        ...policy,
        directory: "/test",
        agentFilter: "octo_studio",
        sectionTitle: "最近",
        activeSessionId: () => undefined,
        buildSessionRoute: (session) => `/test/${session.id}`,
        buildNewRoute: () => "/test",
        buildDeleteFallback: () => "/test",
        showProjectInfo: false,
        showBottomNav: false,
        inlineBeforeSection: true,
        loadMoreMode: options.loadMoreMode,
        fetchSessions: async () => {
          calls.push(undefined)
          return [...server.rows]
        },
        fetchSessionPage: options.paginated
          ? async (_directory, cursor) => {
              calls.push(cursor)
              return {
                sessions: cursor ? [sidebarSession("next")] : [...server.rows],
                nextCursor: cursor ? undefined : "conversation-page-2",
              }
            }
          : undefined,
        onSessionDeleted: (session) => {
          deleted.push(session.id)
          policy.onSessionDeleted?.(session)
        },
        renderLeading: () => document.createElement("span"),
        beforeSection: (value) => {
          api.section = value
          return undefined
        },
        renderRecent:
          options.customRecent === false
            ? undefined
            : (value) => {
                api.recent = value
                if (options.sections)
                  return createComponent(StudioSessionSections, { api: value, directory: "/test", sdk })
                const list = document.createElement("div")
                createEffect(() => {
                  list.textContent = value
                    .sessions()
                    .map((session) => session.id)
                    .join(",")
                })
                return list
              },
      }),
    container,
  )
  await Bun.sleep(30)
  return {
    container,
    api,
    server,
    setServer,
    events,
    calls,
    boardCursors,
    reorders,
    deleted,
    child,
    url,
    dispose: () => {
      unmount()
      container.remove()
      spies.forEach((spy) => spy.mockRestore())
    },
  }
}

test.each([false, true])(
  "primary refresh with Studio policy=%s preserves only separately loaded boards",
  async (studio) => {
    const value = await sidebarHarness({ studio })
    try {
      value.api.recent!.append([sidebarSession("board", "board"), sidebarSession("old-conversation")])
      value.setServer("rows", [sidebarSession("conversation", "conversation", { title: "updated" })])
      value.events.emit("/test", {
        id: crypto.randomUUID(),
        type: "session.updated",
        properties: { sessionID: "conversation", info: value.server.rows[0] },
      })
      await Bun.sleep(1100)
      expect(value.api.recent!.sessions().map((session) => session.id)).toEqual(
        studio ? ["conversation", "board"] : ["conversation"],
      )
      expect(value.api.recent!.sessions()[0].title).toBe("updated")
      expect(value.calls).toHaveLength(2)
    } finally {
      value.dispose()
    }
  },
)

test.each([false, true])(
  "recent sorting with Studio policy=%s checks the move before updating order",
  async (studio) => {
    const value = await sidebarHarness({ studio })
    try {
      const board = sidebarSession("board", "board")
      value.api.recent!.append([board])
      value.api.section!.onSessionDragStart(board)
      await Bun.sleep(10)
      value.api.section!.handleSessionDrop({
        type: "session",
        sessionId: "conversation",
        section: "recent",
        position: "before",
      })
      await Bun.sleep(30)
      expect(value.reorders).toEqual(studio ? [] : [["board", "conversation"]])
      expect(value.api.section!.draggingSessionId()).toBeNull()
    } finally {
      value.dispose()
    }
  },
)

test.each([undefined, "manual"] as const)(
  "custom-rendered sidebar pagination mode=%s retains default scroll loading",
  async (mode) => {
    const value = await sidebarHarness({ paginated: true, loadMoreMode: mode })
    try {
      const scroll = value.container.querySelector<HTMLDivElement>(".overflow-y-auto")!
      expect(scroll).toBeDefined()
      scroll.dispatchEvent(new Event("scroll"))
      await Bun.sleep(30)
      expect(value.calls).toEqual(mode === "manual" ? [undefined] : [undefined, "conversation-page-2"])
      if (mode === "manual") {
        value.api.recent!.loadMore()
        await Bun.sleep(30)
      }
      expect(value.api.recent!.sessions().map((session) => session.id)).toEqual(["conversation", "next"])
    } finally {
      value.dispose()
    }
  },
)

test("successful local and matching server deletions notify Studio; failed deletes retain backups", async () => {
  const value = await sidebarHarness({ studio: true })
  const board = sidebarSession("board", "board")
  const failed = sidebarSession("failed", "board")
  const remote = sidebarSession("remote", "board")
  const key = (session: Session) => `studio.board.backup:${value.url}:${session.directory}:${session.id}`
  ;[board, failed, remote].forEach((session) => localStorage.setItem(key(session), "draft"))
  try {
    value.api.recent!.append([board, failed, remote])
    value.setServer("rejectDelete", failed.id)
    await value.api.section!.deleteSessions([board, failed])
    expect(value.deleted).toEqual([board.id])
    expect(localStorage.getItem(key(board))).toBeNull()
    expect(localStorage.getItem(key(failed))).toBe("draft")
    value.events.emit("/test", {
      id: crypto.randomUUID(),
      type: "session.deleted",
      properties: { sessionID: remote.id, info: { ...remote, directory: "/other" } },
    })
    expect(localStorage.getItem(key(remote))).toBe("draft")
    value.events.emit("/test", {
      id: crypto.randomUUID(),
      type: "session.deleted",
      properties: { sessionID: remote.id, info: remote },
    })
    expect(localStorage.getItem(key(remote))).toBeNull()
    expect(value.deleted).toEqual([board.id, remote.id])
  } finally {
    ;[board, failed, remote].forEach((session) => localStorage.removeItem(key(session)))
    value.dispose()
  }
})

test("default sidebar collapse and expand preserves automatic pagination without new configuration", async () => {
  const value = await sidebarHarness({ paginated: true, customRecent: false })
  try {
    const header = Array.from(value.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "最近",
    )!
    const scroll = value.container.querySelector<HTMLDivElement>('[data-slot="list-scroll"]')!
    header.click()
    scroll.dispatchEvent(new Event("scroll"))
    await Bun.sleep(30)
    expect(value.calls).toEqual([undefined])
    header.click()
    scroll.dispatchEvent(new Event("scroll"))
    await Bun.sleep(30)
    expect(value.calls).toEqual([undefined, "conversation-page-2"])
    expect(value.container.textContent).toContain("next")
  } finally {
    value.dispose()
  }
})

test("Studio sections keep conversation and board pagination cursors independent in the shared sidebar", async () => {
  const value = await sidebarHarness({ studio: true, sections: true, paginated: true, loadMoreMode: "manual" })
  const click = (label: string) => {
    const button = Array.from(value.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    )
    if (!button) throw new Error(`Missing button: ${label}`)
    button.click()
  }
  try {
    expect(value.calls).toEqual([undefined])
    expect(value.boardCursors).toEqual([null])
    click("加载更多对话")
    await Bun.sleep(30)
    expect(value.calls).toEqual([undefined, "conversation-page-2"])
    expect(value.boardCursors).toEqual([null])
    click("加载更多画布")
    await Bun.sleep(30)
    expect(value.boardCursors).toEqual([null, "board-page-2"])
    expect(value.calls).toEqual([undefined, "conversation-page-2"])
    expect(value.api.recent!.sessions().map((session) => session.id)).toEqual([
      "conversation",
      "board-1",
      "next",
      "board-2",
    ])
  } finally {
    value.dispose()
  }
})

test("Studio only restricts cross-category recent sorting, leaving pinned and grouped moves available", () => {
  const policy = studioSidebarPolicy({ url: () => "http://studio.test", directory: () => "/test" })
  const conversation = sidebarSession("conversation")
  const board = sidebarSession("board", "board")
  expect(
    policy.canMoveSession(
      conversation,
      { type: "session", sessionId: board.id, section: "recent", position: "before" },
      board,
    ),
  ).toBe(false)
  expect(
    policy.canMoveSession(
      board,
      { type: "session", sessionId: conversation.id, section: "recent", position: "before" },
      conversation,
    ),
  ).toBe(false)
  expect(
    policy.canMoveSession(
      { ...conversation, studio_mode: undefined },
      { type: "session", sessionId: conversation.id, section: "recent", position: "before" },
      conversation,
    ),
  ).toBe(true)
  expect(
    policy.canMoveSession(
      board,
      { type: "session", sessionId: "board-2", section: "recent", position: "before" },
      sidebarSession("board-2", "board"),
    ),
  ).toBe(true)
  expect(
    policy.canMoveSession(
      board,
      { type: "session", sessionId: conversation.id, section: "pinned", position: "before" },
      conversation,
    ),
  ).toBe(true)
  expect(
    policy.canMoveSession(
      board,
      { type: "session", sessionId: conversation.id, section: "group", groupId: "group", position: "before" },
      conversation,
    ),
  ).toBe(true)
  expect(policy.canMoveSession(board, { type: "section", section: "recent" }, undefined)).toBe(true)
  expect(policy.canMoveSession(board, { type: "group", groupId: "group" }, undefined)).toBe(true)
})

test("Studio retains boards only in the current directory and clears only the deleted session backup", () => {
  const scope = { url: "http://studio.test", directory: "/test" }
  const policy = studioSidebarPolicy({ url: () => scope.url, directory: () => scope.directory })
  const board = sidebarSession("board", "board")
  const key = `studio.board.backup:${scope.url}:${board.directory}:${board.id}`
  const other = `studio.board.backup:http://other.test:${board.directory}:${board.id}`
  localStorage.setItem(key, "draft")
  localStorage.setItem(other, "other server draft")
  try {
    expect(policy.retainSessionOnRefresh(board)).toBe(true)
    expect(policy.retainSessionOnRefresh(sidebarSession("conversation"))).toBe(false)
    expect(policy.retainSessionOnRefresh({ ...board, agent: "octo_make" })).toBe(false)
    scope.directory = "/other"
    expect(policy.retainSessionOnRefresh(board)).toBe(false)
    policy.onSessionDeleted({ ...board, agent: "octo_make" })
    expect(localStorage.getItem(key)).toBe("draft")
    policy.onSessionDeleted(board)
    policy.onSessionDeleted(board)
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem(other)).toBe("other server draft")
  } finally {
    localStorage.removeItem(key)
    localStorage.removeItem(other)
  }
})

test("board list HTTP failures retain rows and cursor, and retry through the real SDK", async () => {
  const [state, setState] = createStore({ sessions: [] as Session[] })
  const cursors: (string | null)[] = []
  const appends: Session[][] = []
  const session = (id: string): Session => ({
    id,
    slug: id,
    projectID: "project",
    directory: "/test",
    title: id,
    version: "test",
    agent: "octo_studio",
    studio_mode: "board",
    pinned: false,
    sort_order: 0,
    time: { created: 1, updated: 1 },
  })
  const replies = [
    Response.json({ name: "Error", data: { message: "首屏加载失败" } }, { status: 503 }),
    Response.json([session("board-a")], { headers: { "x-next-cursor": "page-2" } }),
    Response.json({ name: "Error", data: { message: "下一页加载失败" } }, { status: 503 }),
    Response.json([session("board-b")]),
  ]
  const fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      cursors.push(new URL(input instanceof Request ? input.url : String(input)).searchParams.get("cursor"))
      const response = replies.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const container = document.createElement("div")
  document.body.append(container)
  const unmount = render(
    () =>
      createComponent(StudioSessionSections, {
        directory: "/test",
        sdk: {
          url: "http://board-list.test",
          createClient: (options) => createOpencodeClient({ baseUrl: "http://board-list.test", fetch, ...options }),
        },
        api: {
          activeID: () => undefined,
          sessions: () => state.sessions,
          append: (sessions) => {
            appends.push(sessions)
            setState("sessions", (previous) => [...previous, ...sessions])
          },
          renderList: (sessions) => sessions.map((session) => session.id).join(","),
          hasMore: () => false,
          loading: () => false,
          loadMore: () => {},
        },
      }),
    container,
  )
  const click = (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    )
    if (!button) throw new Error(`Missing button: ${label}. ${container.textContent}`)
    button.click()
  }
  try {
    await Bun.sleep(30)
    expect(container.textContent).toContain("首屏加载失败")
    expect(container.textContent).not.toContain("[object Object]")
    expect(appends).toHaveLength(0)
    click("重试")
    await Bun.sleep(30)
    expect(state.sessions.map((session) => session.id)).toEqual(["board-a"])
    expect(container.textContent).not.toContain("首屏加载失败")
    click("加载更多画布")
    await Bun.sleep(30)
    expect(container.textContent).toContain("下一页加载失败")
    expect(state.sessions.map((session) => session.id)).toEqual(["board-a"])
    expect(appends).toHaveLength(1)
    click("重试")
    await Bun.sleep(30)
    expect(cursors).toEqual([null, null, "page-2", "page-2"])
    expect(state.sessions.map((session) => session.id)).toEqual(["board-a", "board-b"])
    expect(appends).toHaveLength(2)
    expect(container.textContent).not.toContain("下一页加载失败")
    expect(container.textContent).not.toContain("加载更多画布")
  } finally {
    unmount()
    container.remove()
  }
})
