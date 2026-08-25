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
        <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
          <circle cx="8" cy="8" r="7" fill="#F04438" />
          <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      )
    case "warn":
      return (
        <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
          <path d="M8 1.5L15 14H1L8 1.5Z" fill="#F79009" />
          <path d="M8 6.5V9.5M8 11.5V11.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
          <circle cx="8" cy="8" r="7" fill="#0A59F7" />
          <path d="M8 7v4M8 5.2v0.1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
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
