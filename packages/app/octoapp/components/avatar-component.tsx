import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Popover } from "@opencode-ai/ui/popover"
import { createSignal, onMount, Show } from "solid-js"
import { clearAuth, getUser, getUserAvatar, isLoggedIn } from "@/context/auth"

const loginRequired = import.meta.env.VITE_OCTO_LOGIN_REQUIRED === "true"

export function AvatarComponent(props: { class?: string }) {
  const dialog = useDialog()
  const avatar = getUserAvatar()
  const [menuOpen, setMenuOpen] = createSignal(false)

  onMount(() => {
    localStorage.setItem("appInfo", JSON.stringify({ version: import.meta.env.VITE_APP_VERSION }))
  })

  const logout = () => {
    dialog.close()
    clearAuth()
    window.openLogin?.()
  }

  const confirmLogout = () => {
    setMenuOpen(false)
    dialog.show(() => (
      <div class="logout-dialog">
        <Dialog transition>
          <div class="header">
            <span class="info" aria-hidden="true">!</span>
            <span>确认退出登录？</span>
            <button type="button" class="close" aria-label="关闭" onClick={() => dialog.close()}>×</button>
          </div>
          <div class="content">退出登录不会丢失任何数据，你仍可以登录此账号。</div>
          <div class="btn_group">
            <Button class="secondary" onClick={() => dialog.close()}>取消</Button>
            <Button class="primary" variant="primary" onClick={logout}>确定</Button>
          </div>
        </Dialog>
      </div>
    ))
  }

  const image = (source: string, fallback: string) => (
    <img
      class="avatar-component-image"
      src={source}
      alt="用户头像"
      onError={(event) => {
        if (event.currentTarget.src.endsWith(fallback)) return
        event.currentTarget.src = fallback
      }}
    />
  )

  return (
    <div
      class={`avatar-component ${props.class ?? ""}`}
      data-login-required={loginRequired}
      title={loginRequired ? getUser()?.account ?? "用户" : "用户"}
    >
      <Show when={loginRequired} fallback={image("/AvatarUser.svg", "/AvatarUser.svg")}>
        <Show when={isLoggedIn()} fallback={image("/DefaultAvatar.svg", "/DefaultAvatar.svg")}>
          <Popover
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            trigger={image(avatar() ?? "/DefaultAvatar.svg", "/DefaultAvatar.svg")}
            class="avatar-component-popover"
            placement="bottom-end"
          >
            <button type="button" class="avatar-component-logout" onClick={confirmLogout}>退出登录</button>
          </Popover>
        </Show>
      </Show>
    </div>
  )
}
