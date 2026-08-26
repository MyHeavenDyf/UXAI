import { createSignal, Show, For, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { IconDropdownChevron } from "../icons"
import "./octo-toast.css"

export type OctoToastVariant = "default" | "error" | "warn"

export interface OctoToastOptions {
  title?: string
  description?: string
  variant?: OctoToastVariant
  duration?: number
  persistent?: boolean
}

interface ToastItem {
  id: number
  title?: string
  description?: string
  variant: OctoToastVariant
  timer?: ReturnType<typeof setTimeout>
}

const [toasts, setToasts] = createSignal<ToastItem[]>([])
const [expanded, setExpanded] = createSignal(true)
let nextId = 1

const activeKeys = new Set<string>()
function toastKey(opts: OctoToastOptions | ToastItem): string {
  return `${opts.title ?? ""}::${opts.description ?? ""}`
}

export function showOctoToast(options: OctoToastOptions | string): number {
  const opts = typeof options === "string" ? { description: options } : options
  const variant = opts.variant ?? "default"
  const key = toastKey(opts)
  if (activeKeys.has(key)) return -1
  activeKeys.add(key)

  const id = nextId++
  const item: ToastItem = { id, title: opts.title, description: opts.description, variant }

  const duration = opts.persistent ? 0 : (opts.duration ?? 4000)
  if (duration > 0) {
    item.timer = setTimeout(() => dismissOctoToast(id), duration)
  }

  setToasts((list) => [...list, item])
  setExpanded(true)
  return id
}

export function dismissOctoToast(id: number) {
  setToasts((list) => {
    const item = list.find((t) => t.id === id)
    if (item) {
      activeKeys.delete(toastKey(item))
      item.timer && clearTimeout(item.timer)
    }
    return list.filter((t) => t.id !== id)
  })
}

export function clearAllOctoToasts() {
  toasts().forEach((t) => t.timer && clearTimeout(t.timer))
  activeKeys.clear()
  setToasts([])
}

export interface OctoPromiseToastOptions<T, U = unknown> {
  loading?: string
  success?: (data: T) => string
  error?: (error: U) => string
}

export function showPromiseToast<T, U = unknown>(
  promise: Promise<T> | (() => Promise<T>),
  options: OctoPromiseToastOptions<T, U>,
): Promise<T> {
  const p = typeof promise === "function" ? promise() : promise
  const loadingId = showOctoToast({ title: options.loading ?? "加载中...", persistent: true })

  p.then((data) => {
    if (loadingId >= 0) dismissOctoToast(loadingId)
    const text = options.success?.(data)
    if (text) showOctoToast({ title: text })
  }).catch((err) => {
    if (loadingId >= 0) dismissOctoToast(loadingId)
    const text = options.error?.(err) ?? "操作失败"
    showOctoToast({ title: text, variant: "error" })
  })

  return p
}

function VariantIcon(props: { variant: OctoToastVariant; size?: number }): JSX.Element {
  const size = props.size ?? 14
  switch (props.variant) {
    case "error":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 14 14" width="14.000000" height="14.000000" fill="none">
          <rect id="高危_面性_镂空" width="14.000000" height="14.000000" x="0.000000" y="0.000000"/>
          <path id="path" d="M0.320129 10.3641L5.32306 1.69873C5.42548 1.52148 5.54865 1.36688 5.69257 1.23492C5.80234 1.13434 5.92416 1.04689 6.05804 0.972717C6.19119 0.898907 6.32904 0.841961 6.47162 0.80188C6.64117 0.754272 6.81732 0.730469 7.00018 0.730469C7.33698 0.730469 7.65106 0.811218 7.94244 0.972717C8.25189 1.14429 8.49689 1.38629 8.67731 1.69873L13.6802 10.3641C13.8607 10.6766 13.9477 11.0097 13.9416 11.3636C13.9357 11.6967 13.8486 12.009 13.6802 12.3007C13.5119 12.5923 13.2849 12.8239 12.9993 12.9955C12.8681 13.0744 12.7315 13.1362 12.5895 13.1809C12.4034 13.2396 12.2078 13.2689 12.0031 13.2689L1.99725 13.2689C1.79257 13.2689 1.5972 13.2396 1.41107 13.181C1.26923 13.1362 1.13223 13.0743 1.00104 12.9955C0.715515 12.8239 0.488464 12.5923 0.320129 12.3007C0.151794 12.009 0.0646362 11.6967 0.0588989 11.3636C0.0526733 11.0097 0.139709 10.6766 0.320129 10.3641ZM7.00018 3.79993C7.28021 3.79993 7.50018 4.0199 7.50018 4.29993L7.50018 8.38318C7.50018 8.66318 7.28021 8.88318 7.00018 8.88318C6.72015 8.88318 6.50018 8.66318 6.50018 8.38318L6.50018 4.29993C6.50018 4.0199 6.72015 3.79993 7.00018 3.79993ZM6.41681 10.0459C6.41681 9.72372 6.67804 9.46252 7.00018 9.46252C7.32233 9.46252 7.58356 9.72372 7.58356 10.0459C7.58356 10.3681 7.32233 10.6292 7.00018 10.6292C6.67804 10.6292 6.41681 10.3681 6.41681 10.0459Z" fill="rgb(224,33,40)" fill-rule="evenodd"/>
        </svg>
      )
    case "warn":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 14 14" width="14.000000" height="14.000000" fill="none">
          <rect id="警告_面性_镂空" width="14.000000" height="14.000000" x="0.000000" y="0.000000"/>
          <path id="path" d="M7 0C3.1339 0 0 3.1339 0 7C0 10.8661 3.1339 14 7 14C10.8661 14 14 10.8661 14 7C14 3.1339 10.8661 0 7 0ZM6.5 9.04172C6.5 9.32172 6.72 9.54172 7 9.54172C7.28 9.54172 7.5 9.32172 7.5 9.04172L7.5 3.50003C7.5 3.22003 7.28 3.00003 7 3.00003C6.72 3.00003 6.5 3.22003 6.5 3.50003L6.5 9.04172ZM6.41667 10.6458C6.41667 10.3236 6.67783 10.0625 7 10.0625C7.32217 10.0625 7.58333 10.3236 7.58333 10.6458C7.58333 10.968 7.32217 11.2291 7 11.2291C6.67783 11.2291 6.41667 10.968 6.41667 10.6458Z" fill="rgb(252,200,0)" fill-rule="evenodd"/>
        </svg>
      )
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 14 14" width="14.000000" height="14.000000" fill="none">
          <rect id="提示_面性_镂空" width="14.000000" height="14.000000" x="0.000000" y="0.000000"/>
          <path id="path" d="M7 0C3.1402 0 0 3.1402 0 7C0 10.8598 3.1402 14 7 14C10.8598 14 14 10.8598 14 7C14 3.1402 10.8598 0 7 0ZM6.3 3.85001C6.3 3.46341 6.6134 3.15001 7 3.15001C7.3866 3.15001 7.7 3.46341 7.7 3.85001C7.7 4.23661 7.3866 4.55001 7 4.55001C6.6134 4.55001 6.3 4.23661 6.3 3.85001ZM7 5.45013L6.41667 5.45013C6.13667 5.45013 5.91667 5.67013 5.91667 5.95013C5.91667 6.23013 6.22 6.45013 6.5 6.45013L6.5 10.0001L6.18333 10.0001C5.90333 10.0001 5.68333 10.2201 5.68333 10.5001C5.68333 10.7801 5.90333 11.0001 6.18333 11.0001L7.81667 11.0001C7.98333 11.0001 8.10833 10.9585 8.19167 10.8751C8.275 10.7918 8.31667 10.6668 8.31667 10.5001C8.31667 10.3335 8.275 10.2085 8.19167 10.1251C8.10833 10.0418 7.98333 10.0001 7.81667 10.0001L7.5 10.0001L7.5 5.95013C7.5 5.78347 7.45833 5.65847 7.375 5.57513C7.29167 5.4918 7.16667 5.45014 7 5.45013Z" fill="rgb(32,112,243)" fill-rule="evenodd"/>
        </svg>
      )
  }
}

function CloseIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 16
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
      <path
        d="M12.8681 3.81199C12.9557 3.71205 12.9995 3.59963 12.9995 3.4747C12.9995 3.34978 12.9557 3.24152 12.8681 3.14991C12.7763 3.04997 12.6658 3 12.5364 3C12.4071 3 12.2965 3.04997 12.2048 3.14991L7.99951 7.34728L3.79426 3.14991C3.70247 3.04997 3.59192 3 3.46259 3C3.33326 3 3.21854 3.04997 3.11841 3.14991C3.03914 3.24152 2.99951 3.34978 2.99951 3.4747C2.99951 3.59963 3.03914 3.71205 3.11841 3.81199L7.33618 8.00937L3.11841 12.1943C3.03914 12.2942 2.99951 12.4087 2.99951 12.5378C2.99951 12.6669 3.03914 12.7772 3.11841 12.8688C3.21854 12.9479 3.33326 12.9896 3.46259 12.9938C3.59192 12.9979 3.70247 12.9563 3.79426 12.8688L7.99951 8.67146L12.2048 12.8688C12.2965 12.9563 12.4071 13 12.5364 13C12.6658 13 12.7763 12.9563 12.8681 12.8688C12.9557 12.7772 12.9995 12.6669 12.9995 12.5378C12.9995 12.4087 12.9557 12.2942 12.8681 12.1943L8.66284 8.00937L12.8681 3.81199Z"
        fill="rgba(0,0,0,0.6)"
        fill-rule="nonzero"
      />
    </svg>
  )
}

export function OctoToast(): JSX.Element {
  const counts = () => {
    const list = toasts()
    return {
      default: list.filter((t) => t.variant === "default").length,
      error: list.filter((t) => t.variant === "error").length,
      warn: list.filter((t) => t.variant === "warn").length,
    }
  }
  const total = () => toasts().length

  const variantList: OctoToastVariant[] = ["default", "error", "warn"]

  return (
    <Portal>
      <Show when={total() > 0}>
        <div class="octo-toast-container" data-expanded={expanded()}>
          <div class="octo-toast-header">
            <button
              type="button"
              class="octo-toast-toggle"
              onClick={() => setExpanded(!expanded())}
              title={expanded() ? "收起" : "展开"}
            >
              <IconDropdownChevron
                size={16}
                style={{
                  transform: expanded() ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 0.15s ease",
                }}
              />
              <span>{expanded() ? "收起" : "展开"}</span>
            </button>

            <div class="octo-toast-counts">
              <For each={variantList}>
                {(v) => (
                  <Show when={counts()[v] > 0}>
                    <span class="octo-toast-count-item">
                      <VariantIcon variant={v} size={14} />
                      <span>{counts()[v]}</span>
                    </span>
                  </Show>
                )}
              </For>
            </div>

            <button
              type="button"
              class="octo-toast-close-all"
              onClick={clearAllOctoToasts}
              title="关闭全部"
            >
              <CloseIcon size={16} />
              <span>关闭全部</span>
            </button>
          </div>

          <Show when={expanded()}>
            <div class="octo-toast-body">
              <For each={toasts()}>
                {(item) => {
                  const text = [item.title, item.description].filter(Boolean).join("：")
                  return (
                    <div class="octo-toast-item" data-variant={item.variant}>
                      <VariantIcon variant={item.variant} size={14} />
                      <span class="octo-toast-text" title={text}>
                        {text}
                      </span>
                      <button
                        type="button"
                        class="octo-toast-close"
                        onClick={() => dismissOctoToast(item.id)}
                        title="关闭"
                      >
                        <CloseIcon size={16} />
                      </button>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Portal>
  )
}

if (typeof window !== "undefined") {
  const w = window as unknown as {
    showOctoToast?: typeof showOctoToast
    dismissOctoToast?: typeof dismissOctoToast
    clearAllOctoToasts?: typeof clearAllOctoToasts
    showPromiseToast?: typeof showPromiseToast
  }
  w.showOctoToast = showOctoToast
  w.dismissOctoToast = dismissOctoToast
  w.clearAllOctoToasts = clearAllOctoToasts
  w.showPromiseToast = showPromiseToast
}
