import { batch, createEffect, createRoot, onMount, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { applyDirectoryEvent } from "@/context/global-sync/event-reducer"
import { tracker } from "@/utils/tracker"
import { directoryHeader } from "@/utils/headers"
import { createSharedSessionCache } from "./shared-session-cache"
import { kindOf } from "./workspace-switcher"
import { openPreparedSharedSession, type SharedSessionModule } from "./shared-session-open"
import { sharedSessionImportContext } from "./shared-session-import-context"
import { showSessionTransferProgress, watchSessionTransferProgress } from "./session-transfer-progress"

export function SharedSessionHandler() {
  const platform = usePlatform()
  const layout = useLayout()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  const inFlight = new Set<string>()
  const cache = createSharedSessionCache({
    importSession: async (uniqueId, directory, token, operationID) =>
      platform.importSharedSession?.(
        uniqueId,
        directory,
        kindOf(server.projects.list().find((project) => project.worktree === directory)) === "code"
          ? "project"
          : "session",
        token,
        operationID,
      ),
    isDeleted: (result) => !!globalSync.child(result.directory, { bootstrap: false })[0].deleted?.[result.sessionID],
    readSession: async (result) => {
      const response = await globalSDK.createClient({ throwOnError: false }).session.get({
        sessionID: result.sessionID,
        directory: result.directory,
      })
      if (response.response.status === 404) return
      if (!response.response.ok) throw new Error(`读取分享对话失败：${response.response.status}`)
      return response.data
    },
  })
  const [pending, setPending] = createStore<{ ids: string[] }>({ ids: [] })
  let queue = Promise.resolve()

  const waitForContext = (module: SharedSessionModule) =>
    new Promise<string>((resolve, reject) => {
      createRoot((dispose) => {
        const fail = (message: string) => {
          dispose()
          reject(new Error(message))
        }
        const timer = setTimeout(() => fail("目标模块尚未就绪，请稍后重新打开分享链接"), 30_000)
        const aborted = () => fail("分享打开已取消")
        lifetime.signal.addEventListener("abort", aborted, { once: true })
        onCleanup(() => {
          clearTimeout(timer)
          lifetime.signal.removeEventListener("abort", aborted)
        })
        const ready = () => {
          const page = module === "design" ? "make" : module
          return (
            !lifetime.signal.aborted &&
            server.ready() &&
            !layout.onboarding.show() &&
            (location.pathname === `/${page}` || location.pathname.startsWith(`/${page}/`)) &&
            sharedSessionImportContext.module === module &&
            sharedSessionImportContext.ready &&
            !!sharedSessionImportContext.directory &&
            sharedSessionImportContext.directory === server.projects.last()
          )
        }
        if (lifetime.signal.aborted) return aborted()
        createEffect(() => {
          if (!ready()) return
          // Let the page's mount-time restore/route guards finish before creating the imported session.
          queueMicrotask(() => {
            if (!ready()) return
            const directory = sharedSessionImportContext.directory
            dispose()
            resolve(directory)
          })
        })
      })
    })

  const showImported = (result: NonNullable<Awaited<ReturnType<typeof cache.open>>>, module: SharedSessionModule) => {
    if (lifetime.signal.aborted) return
    const [store, setStore] = globalSync.child(result.directory, { bootstrap: false })
    // Import events can arrive before this directory's store is subscribed.
    // Hydrate the final metadata before routing, without loading the full history.
    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: result.session } },
      directory: result.directory,
      store,
      setStore,
      push: () => {},
      loadLsp: () => {},
    })
    const page = module === "design" ? "make" : module
    batch(() => {
      if (page === "make") layout.lastSessionPerTab.setMake(result.directory, result.sessionID)
      if (page === "pattern") layout.lastSessionPerTab.setPattern(result.sessionID)
      if (page === "insight") layout.lastSessionPerTab.setCowork(result.sessionID)
      layout.lastSessionPerTab.setNewConversation(page, false)
      if (page === "insight") layout.lastSessionPerTab.setNewConversation("cowork", false)
      layout.projects.open(result.directory)
      server.projects.touch(result.directory)
      navigate(`/${page}/${encodeURIComponent(result.sessionID)}`)
    })
    tracker.interaction({
      module: page === "make" ? "design" : page === "pattern" ? "prototype" : page,
      name: "share-import-success",
    })
    showToast({ variant: "success", title: "分享对话已打开" })
  }

  const open = async (uniqueId: string) => {
    if (!platform.prepareSharedSession || !platform.releaseSharedSession) throw new Error("请升级 App 后再打开分享对话")
    const connection = server.current?.http.url ?? globalSDK.url
    const operationID = crypto.randomUUID()
    const progress = showSessionTransferProgress("正在导入 Session")
    const watcher = new AbortController()
    const unsubscribe = platform.onSessionTransferProgress?.((event) => {
      if (event.operationID === operationID) progress.update(event)
    })
    void watchSessionTransferProgress({
      url: globalSDK.url,
      operationID,
      fetch: platform.fetch ?? fetch,
      headers: directoryHeader(server.projects.last()),
      signal: watcher.signal,
      update: (value) => progress.update({ ...value, percent: 25 + value.percent * 0.75 }),
    })
    progress.update({ type: "import", stage: "正在下载分享文件", percent: 2 })
    await openPreparedSharedSession({
      prepare: async () => {
        const prepared = await platform.prepareSharedSession!(uniqueId, operationID)
        progress.update({ type: "import", stage: "正在切换目标模块", percent: 5 })
        return prepared
      },
      select: (module) => {
        if (lifetime.signal.aborted) throw new Error("分享打开已取消")
        const page = module === "design" ? "make" : module
        layout.lastSessionPerTab.setNewConversation(page === "insight" ? "cowork" : page, true)
        navigate(`/${page}`)
      },
      ready: waitForContext,
      importSession: (prepared, directory) => {
        if (lifetime.signal.aborted || connection !== (server.current?.http.url ?? globalSDK.url))
          throw new Error("连接已变更，请重新打开分享链接")
        return cache.open(connection, uniqueId, directory, prepared.module, prepared.token, operationID)
      },
      open: showImported,
      release: (token) => platform.releaseSharedSession!(token),
    }).finally(() => {
      watcher.abort()
      unsubscribe?.()
      progress.dismiss()
    })
  }

  const handle = (urls: string[]) => {
    if (!platform.importSharedSession) return
    for (const input of urls) {
      if (!URL.canParse(input)) continue
      const url = new URL(input)
      if (!["octo-agent:", "octo-agent-beta:", "opencode:"].includes(url.protocol) || url.hostname !== "share") continue
      const uniqueId = url.searchParams.get("uniqueId")
      if (!uniqueId || !/^[a-zA-Z0-9_-]{1,128}$/.test(uniqueId) || inFlight.has(uniqueId)) continue
      inFlight.add(uniqueId)
      setPending("ids", (ids) => [...ids, uniqueId])
    }
  }

  createEffect(() => {
    // 启动引导会修改当前项目，须在项目确认及欢迎引导结束后再导入和跳转。
    if (!server.ready() || layout.onboarding.show() || !pending.ids.length) return
    const directory = server.projects.last()
    if (!directory) return
    const ids = [...pending.ids]
    untrack(() => {
      setPending("ids", [])
      for (const uniqueId of ids) {
        queue = queue
          .then(() => open(uniqueId))
          .catch((error) => {
            showToast({
              variant: "error",
              title: "打开分享对话失败",
              description: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => inFlight.delete(uniqueId))
      }
    })
  })

  onMount(() => {
    const unsubscribe = globalSDK.event.listen((event) => {
      if (event.details.type !== "session.deleted") return
      cache.invalidate(event.details.properties.info.directory, event.details.properties.info.id)
    })
    onCleanup(unsubscribe)
    const listener = (event: Event) => handle((event as CustomEvent<{ urls: string[] }>).detail?.urls ?? [])
    window.addEventListener("opencode:deep-link", listener)
    // 启动期间的链接先由桌面桥缓存，此时 Router 与 Platform 已就绪。
    const target = window as Window & { __OCTO__?: { deepLinks?: string[] } }
    handle(target.__OCTO__?.deepLinks ?? [])
    onCleanup(() => window.removeEventListener("opencode:deep-link", listener))
  })
  return null
}
