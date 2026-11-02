import type { StudioTurnData } from "./turns"
import { createEffect, createMemo, on, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import { studioTurnAnchorID, studioTurnAnchorText } from "./studio-turn-anchor"
import "./studio-turn-anchor-nav.css"

const SPY_TOP_THRESHOLD = 6
const SETTLE_EPSILON = 2
const PENDING_TIMEOUT_MS = 3000

type HoverTip = { top: number; right: number; text: string }
type PendingClick = { id: string; top: number; at: number }

export function StudioTurnAnchorNav(props: {
  turns: StudioTurnData[]
  sessionID?: string
  following: boolean
  viewport: () => HTMLElement | undefined
  content: () => HTMLElement | undefined
  onNavigate: () => void
}) {
  const turns = createMemo(() => props.turns.filter((turn) => turn.recommendation?.kind !== "guide"))
  const anchorIDs = createMemo(() => new Set(turns().map(studioTurnAnchorID)))
  const [state, setState] = createStore({ activeId: "", tip: null as HoverTip | null })
  let navRef: HTMLDivElement | undefined
  let railRef: HTMLDivElement | undefined
  let rafId: number | undefined

  let pendingClick: PendingClick | undefined
  let stickyClick: string | undefined

  const turnEls = (content: HTMLElement) => Array.from(content.querySelectorAll<HTMLElement>("[data-studio-turn-id]"))
    .filter((el) => anchorIDs().has(el.dataset.studioTurnId ?? ""))

  const targetTop = (vp: HTMLElement, el: HTMLElement) => Math.max(0, Math.min(
    el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop,
    vp.scrollHeight - vp.clientHeight,
  ))

  const scrollRailToActive = () => {
    const rail = railRef
    if (!rail || rail.scrollHeight <= rail.clientHeight) return
    const el = rail.querySelector<HTMLElement>(`[data-anchor-id="${CSS.escape(state.activeId)}"]`)
    if (!el) return
    const railRect = rail.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    if (rect.top < railRect.top) rail.scrollTop += rect.top - railRect.top
    else if (rect.bottom > railRect.bottom) rail.scrollTop += rect.bottom - railRect.bottom
  }

  const updateActive = () => {
    const vp = props.viewport()
    const content = props.content()
    if (!vp || !content) return
    if (pendingClick) {
      const el = content.querySelector<HTMLElement>(`[data-studio-turn-id="${CSS.escape(pendingClick.id)}"]`)
      if (!el || !anchorIDs().has(pendingClick.id)) {
        pendingClick = undefined
        stickyClick = undefined
        onViewportScroll()
        return
      }
      // Off-screen turns use estimated heights. Correct the destination when they expand.
      const top = targetTop(vp, el)
      if (Math.abs(top - pendingClick.top) > SETTLE_EPSILON) {
        pendingClick.top = top
        vp.scrollTo({ top, behavior: "instant" })
      }
      const settled = Math.abs(vp.scrollTop - pendingClick.top) <= SETTLE_EPSILON
      const expired = Date.now() - pendingClick.at > PENDING_TIMEOUT_MS
      if (!settled && !expired) {
        onViewportScroll()
        return
      }
      if (settled) {
        setState("activeId", pendingClick.id)
        stickyClick = pendingClick.id
        pendingClick = undefined
        scrollRailToActive()
        return
      }
      pendingClick = undefined
    }
    if (stickyClick) {
      const el = content.querySelector<HTMLElement>(`[data-studio-turn-id="${CSS.escape(stickyClick)}"]`)
      const vpRect = vp.getBoundingClientRect()
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.top < vpRect.bottom && r.bottom > vpRect.top) {
          if (state.activeId !== stickyClick) {
            setState("activeId", stickyClick)
            scrollRailToActive()
          }
          return
        }
      }
      stickyClick = undefined
    }
    const els = turnEls(content)
    if (els.length === 0) {
      setState("activeId", "")
      return
    }
    const vpTop = vp.getBoundingClientRect().top
    const current = (els.filter((el) => el.getBoundingClientRect().top - vpTop <= SPY_TOP_THRESHOLD).at(-1)
      ?? els[0]).dataset.studioTurnId ?? ""
    if (current && current !== state.activeId) {
      setState("activeId", current)
      scrollRailToActive()
    }
  }

  const onViewportScroll = () => {
    if (rafId !== undefined) return
    rafId = requestAnimationFrame(() => {
      rafId = undefined
      updateActive()
    })
  }

  const cancelPendingClick = () => {
    pendingClick = undefined
    stickyClick = undefined
    onViewportScroll()
  }

  createEventListener(() => props.viewport(), "scroll", onViewportScroll)
  createEventListener(() => props.viewport(), "wheel", cancelPendingClick)
  createEventListener(() => props.viewport(), "pointerdown", cancelPendingClick)
  createEventListener(() => props.viewport(), "keydown", cancelPendingClick)
  createEventListener(() => props.viewport(), "touchstart", cancelPendingClick)

  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setState("activeId", "")
        setState("tip", null)
        pendingClick = undefined
        stickyClick = undefined
        onViewportScroll()
      },
    ),
  )

  createEffect(on(() => props.following, (following) => {
    if (!following) return
    cancelPendingClick()
    setState("tip", null)
  }))

  createEffect(() => {
    anchorIDs()
    const content = props.content()
    const vp = props.viewport()
    onViewportScroll()
    if (!content || !vp) return
    const observer = new ResizeObserver(() => {
      const el = stickyClick && content.querySelector<HTMLElement>(`[data-studio-turn-id="${CSS.escape(stickyClick)}"]`)
      if (el) vp.scrollTo({ top: targetTop(vp, el), behavior: "instant" })
      onViewportScroll()
    })
    observer.observe(content)
    observer.observe(vp)
    onCleanup(() => observer.disconnect())
  })

  const handleClick = (turn: StudioTurnData) => {
    const vp = props.viewport()
    const content = props.content()
    setState("activeId", studioTurnAnchorID(turn))
    setState("tip", null)
    stickyClick = undefined
    const el = content?.querySelector<HTMLElement>(`[data-studio-turn-id="${CSS.escape(studioTurnAnchorID(turn))}"]`)
    if (!vp || !content || !el) return
    const top = targetTop(vp, el)
    props.onNavigate()
    pendingClick = { id: studioTurnAnchorID(turn), top, at: Date.now() }
    vp.scrollTo({ top, behavior: "smooth" })
    scrollRailToActive()
    onViewportScroll()
  }

  const handleRowEnter = (turn: StudioTurnData, rowEl: HTMLElement) => {
    const nav = navRef
    if (!nav) return
    const text = studioTurnAnchorText(turn)
    if (!text) {
      setState("tip", null)
      return
    }
    const rowRect = rowEl.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    setState("tip", {
      top: rowRect.top - navRect.top + rowRect.height / 2,
      right: navRect.right - rowRect.left + 8,
      text,
    })
  }

  return (
    <Show when={turns().length >= 3}>
      <div class="studio-turn-anchor-nav" ref={navRef}>
        <div class="studio-turn-anchor-list" ref={railRef}>
          <For each={turns()}>
            {(turn, index) => (
              <div
                class="studio-turn-anchor-row"
                data-anchor-id={studioTurnAnchorID(turn)}
                onMouseEnter={(e) => handleRowEnter(turn, e.currentTarget)}
                onMouseLeave={() => setState("tip", null)}
              >
                <button
                  type="button"
                  class="studio-turn-anchor"
                  aria-label={`定位到第 ${index() + 1} 轮：${studioTurnAnchorText(turn)}`}
                  aria-current={state.activeId === studioTurnAnchorID(turn) ? "step" : undefined}
                  onFocus={(e) => handleRowEnter(turn, e.currentTarget)}
                  onBlur={() => setState("tip", null)}
                  data-active={state.activeId === studioTurnAnchorID(turn) ? "true" : undefined}
                  onClick={() => handleClick(turn)}
                >
                  <span class="studio-turn-anchor-bar" />
                </button>
              </div>
            )}
          </For>
        </div>
        <Show when={state.tip} keyed>
          {(t) => (
            <div class="studio-turn-anchor-tip" style={{ top: `${t.top}px`, right: `${t.right}px` }}>
              {t.text}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
