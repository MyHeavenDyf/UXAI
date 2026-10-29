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
      <Dialog class="logout-dialog" title="确认退出登录？" transition>
        <p class="logout-dialog-message">退出登录不会丢失任何数据，你仍可以登录此账号。</p>
        <div class="logout-dialog-actions">
          <Button onClick={() => dialog.close()}>取消</Button>
          <Button variant="primary" onClick={logout}>确定</Button>
        </div>
      </Dialog>
    ))
  }

  const image = (source = "/AvatarUser.svg") => (
    <img
      class="avatar-component-image"
      src={source}
      alt="用户头像"
      onError={(event) => {
        if (event.currentTarget.src.endsWith("/AvatarUser.svg")) return
        event.currentTarget.src = "/AvatarUser.svg"
      }}
    />
  )

  return (
    <div
      class={`avatar-component ${props.class ?? ""}`}
      data-login-required={loginRequired}
      title={loginRequired ? getUser()?.account ?? "用户" : "用户"}
    >
      <Show when={loginRequired} fallback={image()}>
        <Show when={isLoggedIn()} fallback={image()}>
          <Popover
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            trigger={image(avatar() ?? undefined)}
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
