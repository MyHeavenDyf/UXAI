import { createSignal, createEffect, Show, For, onCleanup, type JSX } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { ConfigGroup, ModelEditElement } from '../model-edit-items/types'
import { renderConfigItem, checkKeyConflicts } from '../model-edit-items/registry'
import './manual-edit-panel.css'
import './model-edit-panel.css'

export function ModelEditPanel(props: {
  element: ModelEditElement | null
  config: ConfigGroup[]
  panelData: Record<string, string>
  panelTitle: string
  panelInfo: string
  filePath: string
  disabled?: boolean
  onSubmitStart?: () => void
  onSave: (current: Record<string, string>) => Promise<void> | void
  onDelete: () => Promise<void> | void
  onExit: () => void
  floatingStyle?: { left: number; top: number }
  onFloatingPositionChange?: (pos: { left: number; top: number }) => void
}): JSX.Element {
  const [submitting, setSubmitting] = createSignal(false)
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [values, setValues] = createStore<Record<string, string>>({})
  let panelRef: HTMLElement | undefined

  const isDisabled = () => submitting() || !!props.disabled

  createEffect(() => {
    if (props.panelData) {
      setValues({ ...props.panelData })
    }
  })

  createEffect(() => {
    const conflicts = checkKeyConflicts(props.config)
    if (conflicts.length > 0) {
      console.warn('[ModelEditPanel] Key conflicts:', conflicts)
    }
  })

  const updatePanelMaxHeight = () => {
    if (!panelRef || !props.floatingStyle) return
    const parent = panelRef.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const panelTop = props.floatingStyle.top
    const available = parentRect.height - panelTop - 12
    panelRef.style.maxHeight = `${Math.max(100, available)}px`
  }

  const clampPosition = () => {
    if (!panelRef || !props.floatingStyle || !props.onFloatingPositionChange) return
    const parent = panelRef.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const panelRect = panelRef.getBoundingClientRect()
    const pad = 8
    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad)
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad)
    const clampedLeft = clamp(props.floatingStyle.left, pad, maxLeft)
    const clampedTop = clamp(props.floatingStyle.top, pad, maxTop)
    if (clampedLeft !== props.floatingStyle.left || clampedTop !== props.floatingStyle.top) {
      props.onFloatingPositionChange({ left: clampedLeft, top: clampedTop })
    }
  }

  createEffect(() => {
    if (props.floatingStyle) updatePanelMaxHeight()
  })

  createEffect(() => {
    if (!props.floatingStyle || !panelRef) return
    const parent = panelRef.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => {
      updatePanelMaxHeight()
      clampPosition()
    })
    observer.observe(parent)
    onCleanup(() => observer.disconnect())
  })

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const selector = "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"
    return !!target.closest(selector)
  }

  const startPanelDrag = (event: PointerEvent) => {
    if (!props.onFloatingPositionChange) return
    if (interactive(event.target)) return
    event.preventDefault()
    event.stopPropagation()

    const target = event.currentTarget as HTMLElement
    const panel = target.closest('.manual-edit-right') as HTMLElement | null
    const parent = panel?.parentElement
    if (!panel || !parent) return

    target.setPointerCapture(event.pointerId)

    const startX = event.clientX
    const startY = event.clientY
    const startLeft = panel.offsetLeft
    const startTop = panel.offsetTop
    const parentRect = parent.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const pad = 8

    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad)
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad)

    let rafId: number | null = null
    let pendingLeft = startLeft
    let pendingTop = startTop

    const updatePosition = () => {
      rafId = null
      props.onFloatingPositionChange!({ left: pendingLeft, top: pendingTop })
      if (panelRef) {
        const available = parentRect.height - pendingTop - 12
        panelRef.style.maxHeight = `${Math.max(100, available)}px`
      }
    }

    const move = (moveEvent: PointerEvent) => {
      pendingLeft = clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft)
      pendingTop = clamp(startTop + moveEvent.clientY - startY, pad, maxTop)
      if (rafId === null) {
        rafId = requestAnimationFrame(updatePosition)
      }
    }

    const up = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      try { target.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }

    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const handleSave = async () => {
    if (isDisabled()) return
    setSubmitting(true)
    props.onSubmitStart?.()
    try {
      await props.onSave({ ...values })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (isDisabled()) return
    setSubmitting(true)
    props.onSubmitStart?.()
    try {
      await props.onDelete()
    } finally {
      setSubmitting(false)
    }
    setConfirmDelete(false)
  }

  const itemValue = (key: string) => () => values[key] ?? ''

  const itemOnChange = (key: string) => (v: string) => {
    setValues(key, v)
  }

  return (
    <aside
      ref={panelRef}
      class={`manual-edit-right${props.floatingStyle ? ' manual-edit-floating' : ''}`}
      style={props.floatingStyle ? {
        left: `${props.floatingStyle.left}px`,
        top: `${props.floatingStyle.top}px`,
        right: 'auto',
        bottom: 'auto',
        cursor: isDisabled() ? 'wait' : 'default',
      } : { cursor: isDisabled() ? 'wait' : 'default' }}
    >
      <section class="manual-edit-modal cc-panel octo-thin-scroll">
        <div class="manual-edit-titlebar" onPointerDown={startPanelDrag}>
          <span class="manual-edit-titlebar-kind" title={props.panelTitle}>
            {props.panelTitle}
          </span>
          <Show when={props.panelInfo}>
            <span class="manual-edit-titlebar-id" title={props.panelInfo}>
              {props.panelInfo}
            </span>
          </Show>
          <span class="manual-edit-titlebar-spacer" />
          <button
            type="button"
            class="manual-edit-titlebar-close"
            aria-label="Close panel"
            title="Close panel"
            disabled={isDisabled()}
            onClick={props.onExit}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <div class="manual-edit-scroll octo-thin-scroll">
          <For each={props.config}>
            {(group) => (
              <div class="model-edit-group">
                <Show when={group.title}>
                  <div class="model-edit-group-title">{group.title}</div>
                </Show>
                <div class="model-edit-group-body">
                  <For each={group.items}>
                    {(item) => renderConfigItem(item, itemValue(item.key), itemOnChange(item.key))}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="manual-edit-footer">
          <div class="manual-edit-footer-left">
            <Show
              when={confirmDelete()}
              fallback={
                <button
                  type="button"
                  class="manual-edit-delete-btn"
                  aria-label="Delete"
                  title="Delete"
                  disabled={isDisabled()}
                  onClick={() => setConfirmDelete(true)}
                >
                  <svg width="16" height="16" viewBox="0 0 13.0068 14.5867" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4.48 3.08667C4.60889 3.08667 4.72222 3.03778 4.82 2.94C4.91333 2.84667 4.96 2.72889 4.96 2.58667C4.96 2.30222 5.03333 2.03333 5.18 1.78C5.32222 1.53111 5.51778 1.33333 5.76667 1.18667C6.02 1.04444 6.29111 0.973333 6.58 0.973333C6.86445 0.973333 7.13333 1.04444 7.38667 1.18667C7.63556 1.33333 7.83333 1.53111 7.98 1.78C8.12222 2.03333 8.19333 2.30222 8.19333 2.58667C8.19333 2.72889 8.24222 2.84667 8.34 2.94C8.43333 3.03778 8.54889 3.08667 8.68667 3.08667L12.5133 3.08667C12.6511 3.08667 12.7689 3.03778 12.8667 2.94C12.96 2.84667 13.0067 2.72889 13.0067 2.58667C13.0067 2.44889 12.96 2.33333 12.8667 2.24C12.7689 2.14222 12.6511 2.09333 12.5133 2.09333L9.12 2.09333C9.01333 1.49778 8.72 1 8.24 0.6C7.76 0.2 7.2 0 6.56 0C5.93333 0 5.38222 0.2 4.90667 0.6C4.43111 1 4.13556 1.49778 4.02 2.09333L0.5 2.09333C0.357778 2.09333 0.24 2.14222 0.146667 2.24C0.0488889 2.33333 0 2.44889 0 2.58667C0 2.72889 0.0488889 2.84667 0.146667 2.94C0.24 3.03778 0.357778 3.08667 0.5 3.08667L4.48 3.08667Z" fill="currentColor" fill-rule="nonzero" />
                    <path d="M7.74667 11.3867C7.88444 11.3867 8.00222 11.3422 8.1 11.2533C8.19333 11.1644 8.24667 11.0489 8.26 10.9067L8.42 6C8.42889 5.85778 8.38222 5.73778 8.28 5.64C8.17778 5.53778 8.05778 5.48 7.92 5.46667C7.79111 5.46667 7.68 5.51333 7.58667 5.60667C7.48889 5.69556 7.44 5.80889 7.44 5.94667L7.24667 10.86C7.23778 10.9978 7.28444 11.1178 7.38667 11.22C7.48889 11.3222 7.60889 11.3778 7.74667 11.3867Z" fill="currentColor" fill-rule="nonzero" />
                    <path d="M5.3 11.3867C5.43778 11.3778 5.55778 11.3222 5.66 11.22C5.75778 11.1178 5.80222 10.9978 5.79333 10.86L5.58667 5.94667C5.58667 5.80889 5.54 5.69556 5.44667 5.60667C5.35778 5.51333 5.23778 5.46667 5.08667 5.46667C4.94889 5.48 4.83333 5.53778 4.74 5.64C4.64222 5.73778 4.59778 5.85778 4.60667 6L4.78667 10.9067C4.80889 11.0489 4.86444 11.1644 4.95333 11.2533C5.04222 11.3422 5.15778 11.3867 5.3 11.3867Z" fill="currentColor" fill-rule="nonzero" />
                    <path d="M10.2067 12.7667C10.1756 13.0111 10.0756 13.2111 9.90667 13.3667C9.73333 13.5222 9.53111 13.6 9.3 13.6L3.72667 13.6C3.49556 13.6 3.29111 13.5222 3.11333 13.3667C2.93556 13.2111 2.83778 13.0111 2.82 12.7667L2.22667 4.63333L1.18 4.63333L1.79333 13.06C1.84 13.6111 2.07333 14.0622 2.49333 14.4133C2.91333 14.7644 3.4 14.94 3.95333 14.94L9.07333 14.94C9.62667 14.94 10.1133 14.7644 10.5333 14.4133C10.9533 14.0622 11.1867 13.6111 11.2333 13.06L11.8467 4.63333L10.8 4.63333L10.2067 12.7667Z" fill="currentColor" fill-rule="nonzero" />
                  </svg>
                </button>
              }
            >
              <div class="manual-edit-delete-confirm">
                <span>删除?</span>
                <button
                  type="button"
                  class="manual-edit-footer-btn danger"
                  disabled={isDisabled()}
                  onClick={handleDelete}
                >
                  Delete
                </button>
                <button
                  type="button"
                  class="manual-edit-footer-btn subtle"
                  disabled={isDisabled()}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </Show>
          </div>
          <Show when={!confirmDelete()}>
            <div class="manual-edit-footer-right">
              <button
                type="button"
                class="manual-edit-footer-btn primary"
                disabled={isDisabled()}
                onClick={handleSave}
              >
                {submitting() ? '...' : '确认'}
              </button>
            </div>
          </Show>
        </div>
      </section>
    </aside>
  )
}
