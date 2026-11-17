import { createSignal, onCleanup, createEffect, on, onMount, type JSX } from "solid-js"
import type { ManualEditTarget } from "../../edit-mode/source-patches"
import { encodeSelectorToBase64Url } from "../../utils/asset-upload"

const MASK_COLOR = "rgba(0,0,0,0.3)"

/**
 * 「保存到资产库(局部)」选中元素弹窗 + 未选中区域蒙层。
 *
 *
 * 内容（需求文档规格）：272×176，标题 + 副标题「局部名称」+ 名称 Input（默认填入
 * 页面名 + "-" + 选中元素 css selector 的 base64url——天然文件名/URL 安全）+ 取消/确认；
 * 确认即时上报（打开上传弹窗）。
 */
export function AssetPickPopup(props: {
  element: ManualEditTarget
  iframeRef?: HTMLIFrameElement
  viewportScale?: number
  pageName: string
  onCancel: () => void
  onConfirm: (name: string) => void
}): JSX.Element {
  const [name, setName] = createSignal("")
  const [cRect, setCRect] = createSignal<DOMRect | null>(null)
  const [iframeRectTick, setIframeRectTick] = createSignal(0)
  const [liveRect, setLiveRect] = createSignal<{ x: number; y: number; width: number; height: number } | null>(null)
  let parentRef: HTMLDivElement | undefined

  // 元素切换（含首次选中）：重置实时 rect 与名称默认值，并重启位置追踪。
  // 默认名 = 页面名 + "-" + css selector 的 base64url
  createEffect(on(() => props.element.id, () => {
    setLiveRect(null)
    setName(props.pageName + "-" + encodeSelectorToBase64Url(props.element.cssSelector))
    props.iframeRef?.contentWindow?.postMessage({ type: "od:track-rect", elementId: props.element.id }, "*")
  }))

  onMount(() => {
    if (parentRef) {
      setCRect(parentRef.getBoundingClientRect())
      const ro = new ResizeObserver(() => {
        setCRect(parentRef!.getBoundingClientRect())
        setIframeRectTick((t) => t + 1)
      })
      ro.observe(parentRef)
      if (props.iframeRef) ro.observe(props.iframeRef)
      const onWinResize = () => {
        setCRect(parentRef!.getBoundingClientRect())
        setIframeRectTick((t) => t + 1)
      }
      window.addEventListener("resize", onWinResize)
      window.addEventListener("scroll", onWinResize, true)
      onCleanup(() => {
        ro.disconnect()
        window.removeEventListener("resize", onWinResize)
        window.removeEventListener("scroll", onWinResize, true)
      })
    }

    const iframe = props.iframeRef
    if (iframe) {
      const onMessage = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return
        const d = e.data
        if (!d || typeof d !== "object") return
        if (d.type === "od:rect-update" && d.rect) setLiveRect(d.rect)
      }
      window.addEventListener("message", onMessage)
      onCleanup(() => {
        window.removeEventListener("message", onMessage)
        props.iframeRef?.contentWindow?.postMessage({ type: "od:stop-track-rect" }, "*")
      })
    }
  })

  const elementPos = () => {
    iframeRectTick()
    const containerRect = cRect()
    const iframeRect = props.iframeRef?.getBoundingClientRect()
    if (!containerRect || !iframeRect) return null
    const scale = props.viewportScale ?? 1
    const r = liveRect() ?? props.element.rect
    return {
      x: iframeRect.left - containerRect.left + r.x * scale,
      y: iframeRect.top - containerRect.top + r.y * scale,
      width: r.width * scale,
      height: r.height * scale,
    }
  }

  const popupPosition = (): JSX.CSSProperties => {
    const rect = elementPos()
    const containerRect = cRect()
    if (!rect || !containerRect) {
      return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    }
    const dialogWidth = 272
    const dialogHeight = 176
    let left = rect.x + rect.width / 2 - dialogWidth / 2
    left = Math.max(8, Math.min(left, containerRect.width - dialogWidth - 8))
    let top = rect.y + rect.height + 16
    if (top + dialogHeight > containerRect.height - 8) {
      top = Math.max(8, rect.y - dialogHeight - 16)
    }
    return { left: `${left}px`, top: `${top}px` }
  }

  const maskPieces = (): JSX.Element => {
    const rect = elementPos()
    const containerRect = cRect()
    if (!rect || !containerRect) {
      return <div style={{ position: "absolute", inset: 0, background: MASK_COLOR, "z-index": 10, "pointer-events": "none" }} />
    }
    const cw = containerRect.width
    const ch = containerRect.height
    const ex = rect.x
    const ey = rect.y
    const ew = rect.width
    const eh = rect.height
    return (
      <>
        <div style={{ position: "absolute", left: "0", top: "0", width: `${cw}px`, height: `${ey}px`, background: MASK_COLOR, "z-index": 10, "pointer-events": "none" }} />
        <div style={{ position: "absolute", left: "0", top: `${ey + eh}px`, width: `${cw}px`, height: `${ch - ey - eh}px`, background: MASK_COLOR, "z-index": 10, "pointer-events": "none" }} />
        <div style={{ position: "absolute", left: "0", top: `${ey}px`, width: `${ex}px`, height: `${eh}px`, background: MASK_COLOR, "z-index": 10, "pointer-events": "none" }} />
        <div style={{ position: "absolute", left: `${ex + ew}px`, top: `${ey}px`, width: `${cw - ex - ew}px`, height: `${eh}px`, background: MASK_COLOR, "z-index": 10, "pointer-events": "none" }} />
      </>
    )
  }

  return (
    <div ref={parentRef} style={{ position: "absolute", inset: 0, "pointer-events": "none" }}>
      {maskPieces()}
      <div
        style={{
          position: "absolute",
          ...popupPosition(),
          width: "272px",
          height: "176px",
          "box-sizing": "border-box",
          background: "#ffffff",
          border: "1px solid var(--octo-border-default, #E5E7EB)",
          "border-radius": "10px",
          "box-shadow": "var(--octo-shadow-lg, 0 8px 24px rgba(0,0,0,0.12))",
          padding: "16px",
          "pointer-events": "auto",
          "z-index": 20,
          display: "flex",
          "flex-direction": "column",
        }}
      >
        <div style={{ "font-size": "14px", "font-weight": 600, color: "rgba(0,0,0,0.9)", "line-height": "22px" }}>
          保存到资产库(局部)
        </div>
        <div
          style={{
            "margin-top": "12px",
            "margin-bottom": "4px",
            color: "rgba(0,0,0, 0.9)",
            "font-size": "14px",
            "line-height": "22px",
          }}
        >
          局部名称
        </div>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="请输入局部名称"
          style={{
            width: "100%",
            "box-sizing": "border-box",
            height: "32px",
            padding: "0 10px",
            border: "1px solid var(--octo-border-default, #E5E7EB)",
            "border-radius": "6px",
            "font-size": "12px",
            color: "var(--octo-text-primary, #191919)",
            outline: "none",
            background: "#fff",
          }}
        />
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "auto" }}>
          <button
            type="button"
            onClick={props.onCancel}
            style={{
              border: "none",
              background: "rgba(0,0,0,0.05)",
              "line-height": "32px",
              width: "88px",
              "border-radius": "999px",
              color: "#191919",
              "font-size": "12px",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!name().trim()}
            onClick={() => props.onConfirm(name().trim())}
            style={{
              "line-height": "32px",
              width: "88px",
              "border-radius": "999px",
              border: "none",
              background: "var(--octo-brand, #0a59f7)",
              color: "#fff",
              "font-size": "12px",
              cursor: !name().trim() ? "not-allowed" : "pointer",
              opacity: !name().trim() ? 0.5 : 1,
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
