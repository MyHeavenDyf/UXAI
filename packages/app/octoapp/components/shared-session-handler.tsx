import { batch, createEffect, createRoot, onMount, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { applyDirectoryEvent } from "@/context/global-sync/event-reducer"
import { tracker } from "@/utils/tracker"
import { createSharedSessionCache } from "./shared-session-cache"
import { kindOf } from "./workspace-switcher"
import { consumePendingDeepLinks, openPreparedSharedSession, type SharedSessionModule } from "./shared-session-open"
import { sharedSessionImportContext } from "./shared-session-import-context"
import {
  PORTABLE_SESSION_IMPORT_EVENT,
  type PortableSessionImportRequest,
} from "./portable-session-import"
import { SessionTransferProgress } from "./session-transfer-progress"

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
    importSession: async (uniqueId, directory, token) =>
      platform.importSharedSession?.(
        uniqueId,
        directory,
        kindOf(server.projects.list().find((project) => project.worktree === directory)) === "code"
          ? "project"
          : "session",
        token,
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
  const [transfer, setTransfer] = createStore({ visible: false, label: "", value: 0 })
  let transferTimer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  const progress = (label: string, value: number) => {
    clearTimeout(transferTimer)
    setTransfer({ visible: true, label, value })
  }
  const finishProgress = () => {
    setTransfer({ visible: true, label: "导入完成", value: 100 })
    transferTimer = setTimeout(() => setTransfer("visible", false), 600)
  }
  const stopProgress = () => {
    clearTimeout(transferTimer)
    setTransfer("visible", false)
  }
  onCleanup(() => clearTimeout(transferTimer))

  const modulePage = (module: SharedSessionModule) => module === "design" ? "make" : module
  const modulePath = (module: SharedSessionModule, directory: string, sessionID?: string) => {
    if (module === "studio") {
      const base = `/${base64Encode(directory)}/studio`
      return sessionID ? `${base}/${encodeURIComponent(sessionID)}` : `${base}?hint=${Date.now()}`
    }
    const base = `/${modulePage(module)}`
    return sessionID ? `${base}/${encodeURIComponent(sessionID)}` : base
  }

  const selectModule = (module: SharedSessionModule) => {
    if (lifetime.signal.aborted) throw new Error("导入已取消")
    const page = modulePage(module)
    const directory = server.projects.last()
    if (!directory) throw new Error("请先选择导入对话的目录")
    layout.lastSessionPerTab.setNewConversation(page === "insight" ? "cowork" : page, true)
    navigate(modulePath(module, directory))
  }

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
          const page = modulePage(module)
          const pathReady = module === "studio"
            ? location.pathname.split("/")[2] === "studio"
            : location.pathname === `/${page}` || location.pathname.startsWith(`/${page}/`)
          // Studio stores sessions in its config-backed directory, independently
          // from the project selected in the main sidebar.
          const directoryReady = module === "studio"
            || sharedSessionImportContext.directory === server.projects.last()
          return (
            !lifetime.signal.aborted &&
            server.ready() &&
            !layout.onboarding.show() &&
            pathReady &&
            sharedSessionImportContext.module === module &&
            sharedSessionImportContext.ready &&
            !!sharedSessionImportContext.directory &&
            directoryReady
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

  const showImported = (
    result: NonNullable<Awaited<ReturnType<typeof cache.open>>>,
    module: SharedSessionModule,
    source: "share" | "portable" = "share",
  ) => {
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
    const page = modulePage(module)
    const routeDirectory = module === "studio" ? server.projects.last() || result.directory : result.directory
    batch(() => {
      if (page === "make") layout.lastSessionPerTab.setMake(result.directory, result.sessionID)
      if (page === "pattern") layout.lastSessionPerTab.setPattern(result.sessionID)
      if (page === "insight") layout.lastSessionPerTab.setCowork(result.sessionID)
      if (page === "studio") layout.lastSessionPerTab.setStudio(routeDirectory, result.sessionID)
      layout.lastSessionPerTab.setNewConversation(page, false)
      if (page === "insight") layout.lastSessionPerTab.setNewConversation("cowork", false)
      if (module !== "studio") {
        layout.projects.open(result.directory)
        server.projects.touch(result.directory)
      }
      navigate(modulePath(module, routeDirectory, result.sessionID))
    })
    window.dispatchEvent(
      new CustomEvent("octo:session-imported", {
        detail: { sessionID: result.sessionID, directory: result.directory, agent: result.session.agent },
      }),
    )
    tracker.interaction({
      module: page === "make" ? "design" : page === "pattern" ? "prototype" : page,
      name: source === "share" ? "share-import-success" : "portable-import-success",
    })
    if (source === "share") showToast({ variant: "success", title: "分享对话已打开" })
  }

  const open = async (uniqueId: string) => {
    if (!platform.prepareSharedSession || !platform.releaseSharedSession) throw new Error("请升级 App 后再打开分享对话")
    const connection = server.current?.http.url ?? globalSDK.url
    progress("正在读取分享对话", 10)
    const result = await openPreparedSharedSession({
      prepare: async () => {
        const prepared = await platform.prepareSharedSession!(uniqueId)
        progress(`正在打开${prepared.module === "studio" ? " Studio" : "目标模块"}`, 35)
        return prepared
      },
      select: (module) => {
        selectModule(module)
        progress("正在等待目标模块就绪", 50)
      },
      ready: async (module) => {
        const directory = await waitForContext(module)
        progress("正在导入对话和文件", 70)
        return directory
      },
      importSession: (prepared, directory) => {
        if (lifetime.signal.aborted || connection !== (server.current?.http.url ?? globalSDK.url))
          throw new Error("连接已变更，请重新打开分享链接")
        return cache.open(connection, uniqueId, directory, prepared.module, prepared.token)
      },
      open: (result, module) => {
        progress("正在打开导入的对话", 95)
        showImported(result, module)
        finishProgress()
      },
      release: (token) => platform.releaseSharedSession!(token),
    }).catch((error) => {
      stopProgress()
      throw error
    })
    if (!result) {
      stopProgress()
      throw new Error("导入分享对话失败：接口未返回 Session 信息")
    }
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
    const target = window as Window & { __OCTO__?: { deepLinks?: string[] } }
    const consume = (fallback: string[] = []) => {
      const cached = consumePendingDeepLinks((target.__OCTO__ ??= {}))
      handle(cached.length ? cached : fallback)
    }
    const listener = (event: Event) => consume((event as CustomEvent<{ urls: string[] }>).detail?.urls ?? [])
    window.addEventListener("opencode:deep-link", listener)
    const portableListener = (event: Event) => {
      const request = (event as CustomEvent<PortableSessionImportRequest>).detail
      queue = queue
        .then(async () => {
          if (!platform.inspectPortableSession) throw new Error("当前客户端不支持识别 Session 模块，请升级客户端")
          progress("正在识别 Session 所属模块", 10)
          const inspected = await platform.inspectPortableSession(request.path)
          selectModule(inspected.module)
          progress(`正在打开${inspected.module === "studio" ? " Studio" : "目标模块"}`, 35)
          const directory = await waitForContext(inspected.module)
          progress("正在导入对话和文件", 65)
          const client = globalSDK.createClient({ directory, throwOnError: true })
          const imported = (await client.session.portableImport({ path: request.path })).data
          if (!imported) throw new Error("导入接口未返回 Session 信息")
          progress("正在打开导入的对话", 90)
          const session = (await client.session.get({ sessionID: imported.sessionID })).data
          if (!session) throw new Error("导入的对话不存在")
          showImported({
            sessionID: imported.sessionID,
            directory,
            agent: session.agent,
            session,
          }, inspected.module, "portable")
          finishProgress()
          return imported
        })
        .then(request.resolve, (error) => {
          stopProgress()
          request.reject(error)
        })
    }
    window.addEventListener(PORTABLE_SESSION_IMPORT_EVENT, portableListener)
    // 启动期间的链接先由桌面桥缓存，此时 Router 与 Platform 已就绪。
    consume()
    onCleanup(() => {
      window.removeEventListener("opencode:deep-link", listener)
      window.removeEventListener(PORTABLE_SESSION_IMPORT_EVENT, portableListener)
    })
  })
  return <SessionTransferProgress visible={transfer.visible} label={transfer.label} value={transfer.value} />
}
