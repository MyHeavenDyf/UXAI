import type { Session } from "@opencode-ai/sdk/v2/client"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Toast, toaster } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useGlobalSDK } from "@/context/global-sdk"
import { directoryHeader } from "@/utils/headers"
import { modelsApiToken } from "@/network/models-api"
import { SessionSharePreview } from "./session-share-preview"
import linkIcon from "./assets/session-share-link.svg"
import closeIcon from "./assets/session-share-close.svg"
import "./dialog-share-session.css"

export function DialogShareSession(props: { session: Session }) {
  const dialog = useDialog()
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()
  const [state, setState] = createStore({ sharing: false, url: "", error: "", toastID: -1 })

  const copyLink = async () => {
    if (state.sharing) return
    setState({ sharing: true, error: "" })
    await (async () => {
      const url = state.url || await (async () => {
        const token = modelsApiToken()
        const cookie = localStorage.getItem("uiplusCookie")?.trim()
        const response = await (platform.fetch ?? fetch)(
          `${globalSDK.url.replace(/\/$/, "")}/session/${encodeURIComponent(props.session.id)}/portable-share`,
          {
            method: "POST",
            headers: {
              ...directoryHeader(props.session.directory),
              ...(token ? { uiplustoken: token } : {}),
              ...(cookie ? { "x-opencode-share-cookie": cookie } : {}),
            },
          },
        )
        const result: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(result && typeof result === "object" && "message" in result && typeof result.message === "string"
            ? result.message : `分享失败：${response.status}`)
        }
        if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string") {
          throw new Error("分享接口未返回链接")
        }
        setState("url", result.url)
        return result.url
      })()
      const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false)
      if (!copied) {
        const textarea = document.createElement("textarea")
        textarea.value = url
        textarea.setAttribute("readonly", "")
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        const success = document.execCommand("copy")
        textarea.remove()
        if (!success) throw new Error("复制失败，请重试")
      }
      if (state.toastID >= 0) toaster.dismiss(state.toastID)
      setState("toastID", toaster.show((toast) => (
        <Toast toastId={toast.toastId} class="session-share-copy-toast" duration={2500}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="7" fill="#00B578" />
            <path d="m4 7 2 2 4-4" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <Toast.Title>链接已复制</Toast.Title>
        </Toast>
      )))
      dialog.close()
    })().catch((error) => {
      setState("error", error instanceof Error ? error.message : String(error))
    }).finally(() => setState("sharing", false))
  }

  return (
    <Dialog fit class="session-share-dialog">
      <header class="session-share-heading">
        <div class="session-share-heading-text">
          <Kobalte.Title class="session-share-title" title={`分享 ${props.session.title}`}>分享 {props.session.title}</Kobalte.Title>
          <Kobalte.Description class="session-share-description">分享后,你的姓名以及你添加的新消息不会显示在共享聊天中。</Kobalte.Description>
        </div>
        <Kobalte.CloseButton class="session-share-close" aria-label="关闭分享弹窗">
          <img src={closeIcon} width="14" height="14" alt="" />
        </Kobalte.CloseButton>
      </header>
      <SessionSharePreview session={props.session} />
      <p class="session-share-visibility">任何知道此链接的人都可以查看此聊天</p>
      <Show when={state.error}><p class="session-share-error" role="alert">{state.error}</p></Show>
      <footer class="session-share-footer">
        <button type="button" class="session-share-copy" disabled={state.sharing} aria-busy={state.sharing} onClick={() => void copyLink()}>
          <img src={linkIcon} width="16" height="16" alt="" />
          <span>{state.sharing ? "正在生成…" : "复制链接"}</span>
        </button>
      </footer>
    </Dialog>
  )
}
