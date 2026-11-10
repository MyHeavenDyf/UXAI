import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useGlobalSDK } from "@/context/global-sdk"
import { tracker } from "@/utils/tracker"

// 关联代码仓弹窗:根据所选本地文件夹检测是否已配置 git remote origin,
// 已配置则只读展示 URL;未配置则让用户输入地址后调用后端完成 git init + remote add。
interface DialogRepoAssociateProps {
  directory: string
  onClose: () => void
  onConfirm: (repoUrl: string) => void
}

// 代码仓地址格式校验:支持 HTTPS(含端口)、SSH(git@host:path)、ssh:// 协议、~ 路径
const GIT_REPO_REGEX = /^(https?:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|ssh:\/\/git@[\w.-]+(:\d+)?\/[\w./~-]+|git@[\w.-]+:[~\w./~-]+)$/

// 弹窗检测状态:no-directory=未选目录;loading=正在检测;found=已有远程;not-found=未配置远程
type RemoteStatus = "loading" | "found" | "not-found" | "no-directory"

export function DialogRepoAssociate(props: DialogRepoAssociateProps) {
  const globalSDK = useGlobalSDK()

  // status: 控制弹窗内容切换;existingRemote: 已有远程地址(只读展示);repoUrl: 用户输入的新地址
  const [status, setStatus] = createSignal<RemoteStatus>("loading")
  const [existingRemote, setExistingRemote] = createSignal("")
  const [repoUrl, setRepoUrl] = createSignal("")
  const [triedSubmit, setTriedSubmit] = createSignal(false)
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal("")

  const hasUrl = createMemo(() => repoUrl().trim().length > 0)
  const isValidUrl = createMemo(() => GIT_REPO_REGEX.test(repoUrl().trim()))
  const showError = createMemo(() => triedSubmit() && !hasUrl())
  // 输入内容不匹配正则时立即提示,不依赖 triedSubmit(按钮已禁用无法触发 submit)
  const showFormatError = createMemo(() => hasUrl() && !isValidUrl())

  // 弹窗打开时检测所选目录是否已关联远程仓库
  // 使用 globalSDK.client(已配置 throwOnError: true),服务端返回错误时会 throw 而非静默返回 { data: undefined }
  onMount(() => {
    if (!props.directory) {
      setStatus("no-directory")
      return
    }
    void globalSDK.client.project
      .getGitRemote({ directory: props.directory })
      .then((res) => {
        const url = res.data?.remoteUrl
        if (url) {
          setExistingRemote(url)
          setStatus("found")
        } else {
          setStatus("not-found")
        }
      })
      .catch(() => setStatus("not-found"))
  })

  // 确定按钮:已有关联直接回传 URL;未关联则校验输入后调后端 addGitRemote
  function handleConfirm() {
    if (status() === "found") {
      props.onConfirm(existingRemote())
      return
    }
    if (status() !== "not-found") return
    setTriedSubmit(true)
    const url = repoUrl().trim()
    if (!url || !isValidUrl()) return
    setSubmitting(true)
    setError("")
    tracker.interaction({
      module: "project-onboarding",
      name: "associate-repo-confirm",
      subType: "click",
      extend: JSON.stringify({ repoUrl: url }),
    })
    // 使用 globalSDK.client(已配置 throwOnError: true),确保服务端错误能被 catch 捕获
    void globalSDK.client.project
      .addGitRemote({ directory: props.directory, url })
      .then((res) => props.onConfirm(res.data?.remoteUrl ?? url))
      .catch((err) => setError(err instanceof Error ? err.message : "关联代码仓失败"))
      .finally(() => setSubmitting(false))
  }

  // Escape 键关闭弹窗 + Tab 键 focus trap
  let dialogRef: HTMLDivElement | undefined
  function getFocusable(): HTMLElement[] {
    if (!dialogRef) return []
    return Array.from(dialogRef.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose()
      return
    }
    if (e.key === "Tab") {
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  onMount(() => {
    document.addEventListener("keydown", onKeyDown)
    // 弹窗打开时自动聚焦第一个可交互元素
    queueMicrotask(() => {
      const focusable = getFocusable()
      focusable[0]?.focus()
    })
  })
  onCleanup(() => document.removeEventListener("keydown", onKeyDown))

  const canConfirm = createMemo(() => {
    if (status() === "found") return true
    if (status() === "not-found") return hasUrl() && isValidUrl() && !submitting()
    return false
  })

  return (
    <Portal>
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
        onClick={props.onClose}
      >
        <div
          ref={dialogRef}
          class="flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="关联代码仓"
          style={{
            width: "452px",
            "box-sizing": "border-box",
            background: "linear-gradient(166deg, rgb(255, 255, 255) 0%, rgb(253, 254, 255) 48%, rgb(233, 245, 255) 99%)",
            "border-radius": "8px",
            padding: "20px 24px",
            "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ "font-weight": 500, "font-size": "18px", "line-height": "24px", color: "var(--octo-text-base, #191919)" }}>
            关联代码仓
          </div>

          {/* 内容区:预留 min-height 避免 loading → found/not-found 切换时弹窗高度闪变 */}
          <div style={{ "min-height": "108px", width: "100%" }}>
            <Show when={status() === "no-directory"}>
              <div style={{ "font-size": "14px", "line-height": "20px", color: "var(--octo-text-weak, rgba(0,0,0,0.45))", "margin-top": "16px", "text-align": "left", width: "100%" }}>
                请先选择关联本地文件夹
              </div>
            </Show>

            <Show when={status() === "loading"}>
              <div style={{ "font-size": "14px", "line-height": "20px", color: "var(--octo-text-weak, rgba(0,0,0,0.45))", "margin-top": "16px", "text-align": "left", width: "100%" }}>
                正在检测代码仓...
              </div>
            </Show>

            <Show when={status() === "found"}>
              <div style={{ "font-weight": 500, "font-size": "14px", "line-height": "20px", "text-align": "left", "margin-top": "16px", width: "100%", color: "var(--octo-text-base, #191919)" }}>
                当前代码仓地址
              </div>
              <div
                style={{
                  width: "100%",
                  "margin-top": "8px",
                  height: "40px",
                  padding: "0 12px",
                  display: "flex",
                  "align-items": "center",
                  border: "1px solid var(--octo-border-input, #D1D5DB)",
                  "border-radius": "6px",
                  background: "var(--octo-surface-disabled, #F3F4F6)",
                  "font-size": "14px",
                  "font-family": "monospace",
                  color: "var(--octo-text-base, #191919)",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                {existingRemote()}
              </div>
            </Show>

            <Show when={status() === "not-found"}>
              <div style={{ "font-weight": 500, "font-size": "14px", "line-height": "20px", "text-align": "left", "margin-top": "16px", width: "100%", color: "var(--octo-text-base, #191919)" }}>
                <span style={{ color: "var(--octo-danger, #ef4444)", "font-size": "12px", "margin-right": "2px" }} aria-hidden="true">*</span>
                <span>关联代码仓地址</span>
              </div>

              <input
                type="text"
                value={repoUrl()}
                onInput={(e) => {
                  setRepoUrl(e.currentTarget.value)
                  setTriedSubmit(false)
                }}
                placeholder="请输入代码仓地址"
                aria-required="true"
                aria-invalid={showError() || showFormatError()}
                class="w-full"
                style={{
                  height: "40px",
                  "margin-top": "8px",
                  padding: "0 12px",
                  border: `1px solid ${showError() || showFormatError() ? "var(--octo-danger, #ef4444)" : "var(--octo-border-input, #D1D5DB)"}`,
                  "border-radius": "6px",
                  "font-size": "14px",
                  "font-family": "monospace",
                  outline: "none",
                  background: "var(--octo-surface, #fff)",
                }}
              />

              <div style={{ width: "100%", "min-height": "20px", display: "flex", "align-items": "center", gap: "4px", "margin-top": "4px" }}>
                <Show when={showError()}>
                  <span style={{ "font-size": "12px", color: "var(--octo-danger, #ef4444)" }}>请输入代码仓地址</span>
                </Show>
                <Show when={showFormatError()}>
                  <span style={{ "font-size": "12px", color: "var(--octo-danger, #ef4444)" }}>地址格式不正确，请输入有效的代码仓地址</span>
                </Show>
                <Show when={error()}>
                  <span style={{ "font-size": "12px", color: "var(--octo-danger, #ef4444)" }}>{error()}</span>
                </Show>
              </div>
            </Show>
          </div>

          <div style={{ display: "flex", gap: "12px", "margin-top": "24px", "justify-content": "flex-end" }}>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                width: "88px",
                height: "32px",
                "border-radius": "20px",
                border: "1px solid var(--octo-border-input, #D1D5DB)",
                background: "var(--octo-surface, #fff)",
                "font-size": "14px",
                "font-weight": 500,
                color: "var(--octo-text-secondary, rgba(0,0,0,0.65))",
                cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm()}
              style={{
                width: "88px",
                height: "32px",
                "border-radius": "20px",
                border: "none",
                background: canConfirm() ? "var(--octo-brand, #0a59f7)" : "rgba(10, 89, 247, 0.5)",
                "font-size": "14px",
                "font-weight": 500,
                color: "var(--octo-text-on-brand, #fff)",
                cursor: canConfirm() ? "pointer" : "default",
              }}
            >
              <Show when={submitting()} fallback="确定">
                关联中...
              </Show>
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
