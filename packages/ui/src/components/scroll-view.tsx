import { onMount, splitProps, type ComponentProps, Show, mergeProps } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"

export interface ScrollViewProps extends ComponentProps<"div"> {
  viewportRef?: (el: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal" | "both"
  maxThumbSize?: number
}

export const scrollKey = (event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  switch (event.key) {
    case "PageDown":
      return "page-down"
    case "PageUp":
      return "page-up"
    case "Home":
      return "home"
    case "End":
      return "end"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
  }
}

export function ScrollView(props: ScrollViewProps) {
  const i18n = useI18n()
  const merged = mergeProps({ orientation: "vertical", maxThumbSize: 64 }, props)
  const [local, events, rest] = splitProps(
    merged,
    ["class", "children", "viewportRef", "orientation", "style", "maxThumbSize"],
    [
      "onScroll",
      "onWheel",
      "onTouchStart",
      "onTouchMove",
      "onTouchEnd",
      "onTouchCancel",
      "onPointerDown",
      "onMouseUp",
      "onClick",
      "onKeyDown",
    ],
  )

  let rootRef!: HTMLDivElement
  let viewportRef!: HTMLDivElement
  let vThumbRef!: HTMLDivElement
  let hThumbRef!: HTMLDivElement

  const showV = () => local.orientation === "vertical" || local.orientation === "both"
  const showH = () => local.orientation === "horizontal" || local.orientation === "both"

  const [state, setState] = createStore({
    isHovered: false,
    isVDragging: false,
    isHDragging: false,
    vThumbHeight: 0,
    vThumbTop: 0,
    showVThumb: false,
    hThumbWidth: 0,
    hThumbLeft: 0,
    showHThumb: false,
  })

  const updateThumb = () => {
    if (!viewportRef) return

    if (showV()) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef
      if (scrollHeight <= clientHeight || scrollHeight === 0) {
        setState("showVThumb", false)
      } else {
        setState("showVThumb", true)
        const trackPadding = 8
        const trackHeight = clientHeight - trackPadding * 2
        const minThumb = 32
        let height = (clientHeight / scrollHeight) * trackHeight
        height = Math.max(height, minThumb)
        height = Math.min(height, local.maxThumbSize)
        const maxScrollTop = scrollHeight - clientHeight
        const maxThumbTop = trackHeight - height
        const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0
        const boundedTop = trackPadding + Math.max(0, Math.min(top, maxThumbTop))
        setState("vThumbHeight", height)
        setState("vThumbTop", boundedTop)
      }
    }

    if (showH()) {
      const { scrollLeft, scrollWidth, clientWidth } = viewportRef
      if (scrollWidth <= clientWidth || scrollWidth === 0) {
        setState("showHThumb", false)
      } else {
        setState("showHThumb", true)
        const trackPadding = 8
        const trackWidth = clientWidth - trackPadding * 2
        const minThumb = 32
        let width = (clientWidth / scrollWidth) * trackWidth
        width = Math.max(width, minThumb)
        width = Math.min(width, local.maxThumbSize)
        const maxScrollLeft = scrollWidth - clientWidth
        const maxThumbLeft = trackWidth - width
        const left = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * maxThumbLeft : 0
        const boundedLeft = trackPadding + Math.max(0, Math.min(left, maxThumbLeft))
        setState("hThumbWidth", width)
        setState("hThumbLeft", boundedLeft)
      }
    }
  }

  onMount(() => {
    if (local.viewportRef) {
      local.viewportRef(viewportRef)
    }

    createResizeObserver([viewportRef, viewportRef.firstElementChild], updateThumb)

    updateThumb()
  })

  let startY = 0
  let startScrollTop = 0

  const onVThumbPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState("isVDragging", true)
    startY = e.clientY
    startScrollTop = viewportRef.scrollTop
    vThumbRef.setPointerCapture(e.pointerId)

    const onPointerMove = (e: PointerEvent) => {
      const deltaY = e.clientY - startY
      const { scrollHeight, clientHeight } = viewportRef
      const maxScrollTop = scrollHeight - clientHeight
      const maxThumbTop = clientHeight - state.vThumbHeight
      if (maxThumbTop > 0) {
        const scrollDelta = deltaY * (maxScrollTop / maxThumbTop)
        viewportRef.scrollTop = startScrollTop + scrollDelta
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      setState("isVDragging", false)
      vThumbRef.releasePointerCapture(e.pointerId)
      vThumbRef.removeEventListener("pointermove", onPointerMove)
      vThumbRef.removeEventListener("pointerup", onPointerUp)
    }

    vThumbRef.addEventListener("pointermove", onPointerMove)
    vThumbRef.addEventListener("pointerup", onPointerUp)
  }

  let startX = 0
  let startScrollLeft = 0

  const onHThumbPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState("isHDragging", true)
    startX = e.clientX
    startScrollLeft = viewportRef.scrollLeft
    hThumbRef.setPointerCapture(e.pointerId)

    const onPointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX
      const { scrollWidth, clientWidth } = viewportRef
      const maxScrollLeft = scrollWidth - clientWidth
      const maxThumbLeft = clientWidth - state.hThumbWidth
      if (maxThumbLeft > 0) {
        const scrollDelta = deltaX * (maxScrollLeft / maxThumbLeft)
        viewportRef.scrollLeft = startScrollLeft + scrollDelta
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      setState("isHDragging", false)
      hThumbRef.releasePointerCapture(e.pointerId)
      hThumbRef.removeEventListener("pointermove", onPointerMove)
      hThumbRef.removeEventListener("pointerup", onPointerUp)
    }

    hThumbRef.addEventListener("pointermove", onPointerMove)
    hThumbRef.addEventListener("pointerup", onPointerUp)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      return
    }

    const next = scrollKey(e)
    if (!next) return

    const scrollAmount = viewportRef.clientHeight * 0.8
    const lineAmount = 40

    switch (next) {
      case "page-down":
        e.preventDefault()
        viewportRef.scrollBy({ top: scrollAmount, behavior: "smooth" })
        break
      case "page-up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -scrollAmount, behavior: "smooth" })
        break
      case "home":
        e.preventDefault()
        viewportRef.scrollTo({ top: 0, behavior: "smooth" })
        break
      case "end":
        e.preventDefault()
        viewportRef.scrollTo({ top: viewportRef.scrollHeight, behavior: "smooth" })
        break
      case "up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -lineAmount, behavior: "smooth" })
        break
      case "down":
        e.preventDefault()
        viewportRef.scrollBy({ top: lineAmount, behavior: "smooth" })
        break
    }
  }

  return (
    <div
      ref={rootRef}
      class={`scroll-view ${local.class || ""}`}
      style={local.style}
      onPointerEnter={() => setState("isHovered", true)}
      onPointerLeave={() => setState("isHovered", false)}
      {...rest}
    >
      <div
        ref={viewportRef}
        class="scroll-view__viewport"
        onScroll={(e) => {
          updateThumb()
          if (typeof events.onScroll === "function") events.onScroll(e as any)
        }}
        onWheel={events.onWheel as any}
        onTouchStart={events.onTouchStart as any}
        onTouchMove={events.onTouchMove as any}
        onTouchEnd={events.onTouchEnd as any}
        onTouchCancel={events.onTouchCancel as any}
        onPointerDown={events.onPointerDown as any}
        onMouseUp={events.onMouseUp as any}
        onClick={events.onClick as any}
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        onKeyDown={(e) => {
          onKeyDown(e)
          if (typeof events.onKeyDown === "function") events.onKeyDown(e as any)
        }}
      >
        {local.children}
      </div>

      <Show when={showV() && state.showVThumb}>
        <div
          ref={vThumbRef}
          onPointerDown={onVThumbPointerDown}
          class="scroll-view__thumb scroll-view__thumb--vertical"
          data-visible={state.isHovered || state.isVDragging}
          data-dragging={state.isVDragging}
          style={{
            height: `${state.vThumbHeight}px`,
            transform: `translateY(${state.vThumbTop}px)`,
            "z-index": 12,
          }}
        />
      </Show>

      <Show when={showH() && state.showHThumb}>
        <div
          ref={hThumbRef}
          onPointerDown={onHThumbPointerDown}
          class="scroll-view__thumb scroll-view__thumb--horizontal"
          data-visible={state.isHovered || state.isHDragging}
          data-dragging={state.isHDragging}
          style={{
            width: `${state.hThumbWidth}px`,
            transform: `translateX(${state.hThumbLeft}px)`,
            "z-index": 12,
          }}
        />
      </Show>
    </div>
  )
}
