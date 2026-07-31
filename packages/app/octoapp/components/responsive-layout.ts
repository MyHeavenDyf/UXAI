import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

/**
 * Responsive layout breakpoint signals.
 *
 * Breakpoints (from 响应式规则.txt):
 *   >= 1456px  — Wide: full sidebar, all panels visible
 *   1228–1455px — Medium: sidebar collapses to 68px icon strip, drawer overlay
 *   < 1228px   — Narrow: workspace/canvas hidden, center/chat panel fills container
 *   min-width 1024px on container
 */

// ── Breakpoint-only return type (for pages that just need signals) ──
export type ResponsiveBreakpoints = {
  /** <= 1455px — sidebar should collapse, overlay mode active */
  isOverlayMode: Accessor<boolean>
  /** <= 1227px — center/chat panel should be hidden */
  isNarrow: Accessor<boolean>
  /** >= 1920px — wide screen */
  isWide: Accessor<boolean>
}

// ── Full return type (for sidebar layout components) ──
export type ResponsiveLayoutReturn = ResponsiveBreakpoints & {
  /** Whether sidebar is collapsed (driven by isOverlayMode, can be overridden) */
  sidebarCollapsed: Accessor<boolean>
  setSidebarCollapsed: (v: boolean) => void

  /** Whether the drawer overlay is open */
  drawerOpen: Accessor<boolean>
  setDrawerOpen: (v: boolean) => void

  /** Close drawer + reset state */
  closeDrawer: () => void

  /** Sidebar width (persisted) */
  sidebarWidth: Accessor<number>
  setSidebarWidth: (w: number) => void
}

export type UseResponsiveLayoutOptions = {
  /** Persist key for sidebar width, e.g. "make.sidebar.width" */
  storageKey: string
  /** Default sidebar width in px */
  defaultWidth?: number
  /** Min sidebar width in px (default 160) */
  minWidth?: number
  /** Max sidebar width in px (default 360) */
  maxWidth?: number
}

/**
 * Lightweight hook that only returns breakpoint signals.
 * Use this in pages that need to know the viewport size
 * but don't manage a sidebar (e.g. Make page's hideChat logic).
 *
 * ```ts
 * const { isNarrow } = useResponsiveBreakpoints()
 * const hideChat = () => focusMode() || (hasContent() && isNarrow())
 * ```
 */
export function useResponsiveBreakpoints(): ResponsiveBreakpoints {
  const [isOverlayMode, setIsOverlayMode] = createSignal(window.innerWidth <= 1455)
  const [isNarrow, setIsNarrow] = createSignal(window.innerWidth <= 1227)
  const [isWide, setIsWide] = createSignal(window.innerWidth >= 1920)

  createEffect(() => {
    const mqlOverlay = window.matchMedia("(max-width: 1455px)")
    const mqlNarrow = window.matchMedia("(max-width: 1227px)")
    const mqlWide = window.matchMedia("(min-width: 1920px)")

    const update = () => {
      setIsOverlayMode(mqlOverlay.matches)
      setIsNarrow(mqlNarrow.matches)
      setIsWide(mqlWide.matches)
    }

    update()

    mqlOverlay.addEventListener("change", update)
    mqlNarrow.addEventListener("change", update)
    mqlWide.addEventListener("change", update)

    onCleanup(() => {
      mqlOverlay.removeEventListener("change", update)
      mqlNarrow.removeEventListener("change", update)
      mqlWide.removeEventListener("change", update)
    })
  })

  return { isOverlayMode, isNarrow, isWide }
}

/**
 * Full responsive layout hook with sidebar state management.
 * Use this in sidebar layout components that need collapse/drawer/width.
 *
 * ```ts
 * const responsive = useResponsiveLayout({ storageKey: "make.sidebar.width" })
 * // responsive.isNarrow, responsive.sidebarCollapsed, responsive.drawerOpen, etc.
 * ```
 */
export function useResponsiveLayout(options: UseResponsiveLayoutOptions): ResponsiveLayoutReturn {
  const {
    storageKey,
    defaultWidth = 296,
  } = options

  // ── Breakpoint signals ──
  const [isOverlayMode, setIsOverlayMode] = createSignal(window.innerWidth <= 1455)
  const [isNarrow, setIsNarrow] = createSignal(window.innerWidth <= 1227)
  const [isWide, setIsWide] = createSignal(window.innerWidth >= 1920)

  // ── Sidebar collapse (driven by overlay mode) ──
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(window.innerWidth <= 1455)

  // ── Drawer state ──
  const [drawerOpen, setDrawerOpen] = createSignal(false)

  // ── Sidebar width (persisted, versioned) ──
  const [sidebarWidthStore, setSidebarWidthStore] = persisted(
    { ...Persist.global(storageKey), migrate: (v) => v && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>).v === 2 ? v : { width: defaultWidth, v: 2 } },
    createStore({ width: defaultWidth, v: 2 }),
  )
  const sidebarWidth = () => sidebarWidthStore.width
  const setSidebarWidth = (w: number) => setSidebarWidthStore({ width: w })

  // ── Media query listeners ──
  createEffect(() => {
    const mqlOverlay = window.matchMedia("(max-width: 1455px)")
    const mqlNarrow = window.matchMedia("(max-width: 1227px)")
    const mqlWide = window.matchMedia("(min-width: 1920px)")

    const update = () => {
      const overlay = mqlOverlay.matches
      setIsOverlayMode(overlay)
      setSidebarCollapsed(overlay)
      setIsNarrow(mqlNarrow.matches)
      setIsWide(mqlWide.matches)
      // Auto-close drawer when exiting overlay mode
      if (!overlay) setDrawerOpen(false)
    }

    update()

    mqlOverlay.addEventListener("change", update)
    mqlNarrow.addEventListener("change", update)
    mqlWide.addEventListener("change", update)

    onCleanup(() => {
      mqlOverlay.removeEventListener("change", update)
      mqlNarrow.removeEventListener("change", update)
      mqlWide.removeEventListener("change", update)
    })
  })

  // ── Escape key to close drawer ──
  createEffect(() => {
    if (!drawerOpen()) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false)
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  const closeDrawer = () => setDrawerOpen(false)

  return {
    isOverlayMode,
    isNarrow,
    isWide,
    sidebarCollapsed,
    setSidebarCollapsed,
    drawerOpen,
    setDrawerOpen,
    closeDrawer,
    sidebarWidth,
    setSidebarWidth,
  }
}
