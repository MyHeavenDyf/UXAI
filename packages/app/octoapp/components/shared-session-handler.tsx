import { batch, createEffect, onMount, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { INSIGHT_AGENT } from "@/constants/agent"

export function SharedSessionHandler() {
  const platform = usePlatform()
  const layout = useLayout()
  const server = useServer()
  const navigate = useNavigate()
  const inFlight = new Set<string>()
  const completed = new Map<string, { sessionID: string; directory: string; agent?: string }>()
  const [pending, setPending] = createStore<{ ids: string[] }>({ ids: [] })
  let queue = Promise.resolve()

  const open = async (uniqueId: string, directory: string) => {
    const key = JSON.stringify([directory, uniqueId])
    const result = completed.get(key) ?? await platform.importSharedSession?.(uniqueId, directory)
    if (!result) return
    completed.set(key, result)
    const page = result.agent === INSIGHT_AGENT ? "insight" : result.agent === "proto_triage" ? "pattern" : "make"
    batch(() => {
      if (page === "make") layout.lastSessionPerTab.setMake(result.directory, result.sessionID)
      if (page === "pattern") layout.lastSessionPerTab.setPattern(result.sessionID)
      layout.lastSessionPerTab.setNewConversation(page, false)
      layout.projects.open(result.directory)
      server.projects.touch(result.directory)
      navigate(`/${page}/${encodeURIComponent(result.sessionID)}`)
    })
    showToast({ variant: "success", title: "分享对话已打开" })
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
        queue = queue.then(() => open(uniqueId, directory)).catch((error) => {
          showToast({ variant: "error", title: "打开分享对话失败", description: error instanceof Error ? error.message : String(error) })
        }).finally(() => inFlight.delete(uniqueId))
      }
    })
  })

  onMount(() => {
    const listener = (event: Event) => handle((event as CustomEvent<{ urls: string[] }>).detail?.urls ?? [])
    window.addEventListener("opencode:deep-link", listener)
    // 启动期间的链接先由桌面桥缓存，此时 Router 与 Platform 已就绪。
    const target = window as Window & { __OCTO__?: { deepLinks?: string[] } }
    handle(target.__OCTO__?.deepLinks ?? [])
    onCleanup(() => window.removeEventListener("opencode:deep-link", listener))
  })
  return null
}
