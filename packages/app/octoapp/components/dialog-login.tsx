import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { refreshRemoteModels } from "@/network/models-api"
import { notifyStudioLoginSuccess } from "@/pages/studio/studio-permission-store"
import { clearAuth, setAuth, syncAuthFromLoginSuccess, type UserInfo } from "@/context/auth"

type LoginApi = {
  startLogin: () => Promise<{ loginCode: string; loginUrl: string }>
  cancelLogin: () => Promise<boolean>
  onLoginOpened: (cb: (data: { loginCode: string; loginUrl: string }) => void) => () => void
  onLoginSuccess: (cb: (data: { uiplusToken: string; cookie: string; userInfo: UserInfo }) => void) => () => void
  onLoginTimeout: (cb: (data: { message: string }) => void) => () => void
  onLoginPollError: (cb: (data: { message: string }) => void) => () => void
  onTokenRefreshed: (cb: (data: { uiplusToken: string }) => void) => () => void
  onTokenExpired: (cb: (data: { message: string }) => void) => () => void
  onLoginExpiring: (cb: (data: { message: string }) => void) => () => void
  checkAuthReady: () => Promise<{ loginRequired: boolean; message?: string }>
}

const loginRequired = import.meta.env.VITE_OCTO_LOGIN_REQUIRED === "true"

function loginApi() {
  return (window as unknown as { api?: Partial<LoginApi> }).api
}

export function DialogLogin(props: { initialError?: string; allowClose: () => void }) {
  const dialog = useDialog()
  const [status, setStatus] = createSignal<"idle" | "logging-in" | "success" | "error">(
    props.initialError ? "error" : "idle",
  )
  const [message, setMessage] = createSignal(props.initialError ?? "")
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    if (!loginRequired) return
    const api = loginApi()
    const cleanups = [
      api?.onLoginOpened?.(() => setMessage("请在新窗口完成登录操作")),
      api?.onLoginSuccess?.((data) => {
        syncAuthFromLoginSuccess(data.uiplusToken, data.cookie, data.userInfo)
        setStatus("success")
        setMessage("登录成功")
        notifyStudioLoginSuccess()
        void refreshRemoteModels().catch((error) => console.error("[AuthLogin] remote model refresh failed", error))
        closeTimer = setTimeout(() => {
          props.allowClose()
          dialog.close()
        }, 1_000)
      }),
      api?.onLoginTimeout?.((data) => {
        setStatus("error")
        setMessage(data.message)
      }),
      api?.onLoginPollError?.((data) => setMessage(`登录状态检查失败：${data.message}，正在重试…`)),
    ].filter((cleanup): cleanup is () => void => !!cleanup)

    onCleanup(() => {
      cleanups.forEach((cleanup) => cleanup())
      if (closeTimer) clearTimeout(closeTimer)
    })
  })

  const handleLogin = () => {
    const api = loginApi()
    if (!api?.startLogin) {
      setStatus("error")
      setMessage("当前环境未接入登录服务")
      return
    }
    setStatus("logging-in")
    setMessage("正在打开登录页面…")
    void api.startLogin().catch((error) => {
      console.error("[AuthLogin] failed to start login", error)
      setStatus("error")
      setMessage("登录失败，请重试")
    })
  }

  return (
    <Dialog class="login-dialog" transition>
      <div class="login-dialog-content">
        <div class="login-dialog-brand">
          <img class="login-dialog-logo" src="/OctoLogo.svg" alt="Octo Agent" />
          <h2 class="login-dialog-title">Octo Agent</h2>
          <p class="login-dialog-subtitle">您的全能设计与调研专家</p>
        </div>

        <Show when={message()}>
          <p class="login-dialog-message" data-status={status()} aria-live="polite">{message()}</p>
        </Show>

        <div class="login-dialog-actions">
          <Show when={status() !== "success"}>
            <Button
              class="login-dialog-primary"
              variant="primary"
              onClick={handleLogin}
              disabled={status() === "logging-in"}
            >
              {status() === "logging-in" ? "登录中…" : "登录"}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

export function LoginController() {
  const dialog = useDialog()

  onMount(() => {
    const api = loginApi()
    const previous = window.openLogin
    let removeDismissBlocker: (() => void) | undefined
    const open = (message?: string) => {
      removeDismissBlocker?.()
      let canClose = false
      const blockEscape = (event: KeyboardEvent) => {
        if (canClose || event.key !== "Escape") return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const blockOutsideClick = (event: Event) => {
        if (canClose) return
        const target = event.target
        if (!(target instanceof Element) || !target.closest('[data-component="dialog-overlay"]')) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      const cleanup = () => {
        window.removeEventListener("keydown", blockEscape, true)
        window.removeEventListener("pointerdown", blockOutsideClick, true)
        window.removeEventListener("click", blockOutsideClick, true)
        if (removeDismissBlocker === cleanup) removeDismissBlocker = undefined
      }
      window.addEventListener("keydown", blockEscape, true)
      window.addEventListener("pointerdown", blockOutsideClick, true)
      window.addEventListener("click", blockOutsideClick, true)
      removeDismissBlocker = cleanup
      const allowClose = () => {
        canClose = true
        cleanup()
      }
      dialog.show(
        () => <DialogLogin initialError={message} allowClose={allowClose} />,
        () => {
          cleanup()
          void api?.cancelLogin?.()
        },
      )
    }
    const launcher = () => open()
    window.openLogin = launcher

    const cleanups = [
      api?.onTokenRefreshed?.(({ uiplusToken }) => {
        if (uiplusToken) setAuth({ token: uiplusToken })
      }),
      api?.onTokenExpired?.(({ message }) => {
        clearAuth()
        open(message)
      }),
      api?.onLoginExpiring?.(({ message }) => showToast({ title: message })),
    ].filter((cleanup): cleanup is () => void => !!cleanup)

    void api?.checkAuthReady?.().then((state) => {
      if (!state.loginRequired) return
      clearAuth()
      open(state.message)
    }).catch((error) => console.error("[AuthLogin] startup auth check failed", error))
    onCleanup(() => {
      removeDismissBlocker?.()
      cleanups.forEach((cleanup) => cleanup())
      if (window.openLogin === launcher) window.openLogin = previous
    })
  })

  return null
}
