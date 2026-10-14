import type { Message } from "@opencode-ai/sdk/v2/client"
import { createEffect, on, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import { useData } from "@opencode-ai/ui/context"
import { turnAnchorText, type AnchorPart } from "../utils/turn-anchor-text"
import "./turn-anchor-nav.css"

const SPY_TOP_THRESHOLD = 6
const SETTLE_EPSILON = 2
const PENDING_TIMEOUT_MS = 3000

type HoverTip = { top: number; right: number; text: string }
type PendingClick = { id: string; top: number; at: number }

export function TurnAnchorNav(props: {
  messages: Message[]
  sessionID?: string
  viewport: () => HTMLElement | undefined
  content: () => HTMLElement | undefined
}) {
  const data = useData()
  const [state, setState] = createStore({ activeId: "", tip: null as HoverTip | null })
  let navRef: HTMLDivElement | undefined
  let railRef: HTMLDivElement | undefined
  let rafId: number | undefined

  let pendingClick: PendingClick | undefined
  let stickyClick: string | undefined

  const partStore = data.store.part as Record<string, AnchorPart[]>

  const tipText = (msg: Message) => turnAnchorText(partStore[msg.id])

  const turnEls = (content: HTMLElement) => Array.from(content.querySelectorAll<HTMLElement>("[data-turn-id]"))

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
      const settled = Math.abs(vp.scrollTop - pendingClick.top) <= SETTLE_EPSILON
      const expired = Date.now() - pendingClick.at > PENDING_TIMEOUT_MS
      if (!settled && !expired) return
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
      const el = content.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(stickyClick)}"]`)
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
    if (els.length === 0) return
    const vpTop = vp.getBoundingClientRect().top
    let current = ""
    for (const el of els) {
      if (el.getBoundingClientRect().top - vpTop <= SPY_TOP_THRESHOLD) current = el.dataset.turnId ?? ""
      else break
    }
    if (!current) current = els[0].dataset.turnId ?? ""
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
  }

  createEventListener(() => props.viewport(), "scroll", onViewportScroll)
  createEventListener(() => props.viewport(), "wheel", cancelPendingClick)
  createEventListener(() => props.viewport(), "pointerdown", cancelPendingClick)
  createEventListener(() => props.viewport(), "keydown", cancelPendingClick)

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
        updateActive()
      },
    ),
  )

  createEffect(() => {
    props.messages.length
    updateActive()
  })

  const handleClick = (msg: Message) => {
    const vp = props.viewport()
    const content = props.content()
    setState("activeId", msg.id)
    setState("tip", null)
    stickyClick = undefined
    const el = content?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(msg.id)}"]`)
    if (!vp || !content || !el) return
    const target = el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop
    const top = Math.max(0, Math.min(target, vp.scrollHeight - vp.clientHeight))
    pendingClick = { id: msg.id, top, at: Date.now() }
    vp.scrollTo({ top, behavior: "smooth" })
    scrollRailToActive()
  }

  const handleRowEnter = (msg: Message, rowEl: HTMLElement) => {
    const nav = navRef
    if (!nav) return
    const text = tipText(msg)
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
    <Show when={props.messages.length >= 3}>
      <div class="octo-turn-anchor-nav" ref={navRef}>
        <div class="octo-turn-anchor-list" ref={railRef}>
          <For each={props.messages}>
            {(msg) => (
              <div
                class="octo-turn-anchor-row"
                data-anchor-id={msg.id}
                onMouseEnter={(e) => handleRowEnter(msg, e.currentTarget)}
                onMouseLeave={() => setState("tip", null)}
              >
                <button
                  type="button"
                  class="octo-turn-anchor"
                  data-active={state.activeId === msg.id ? "true" : undefined}
                  onClick={() => handleClick(msg)}
                >
                  <span class="octo-turn-anchor-bar" />
                </button>
              </div>
            )}
          </For>
        </div>
        <Show when={state.tip} keyed>
          {(t) => (
            <div class="octo-turn-anchor-tip" style={{ top: `${t.top}px`, right: `${t.right}px` }}>
              {t.text}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
