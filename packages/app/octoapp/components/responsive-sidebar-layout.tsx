import { Show, type ParentProps, type JSX } from "solid-js"
import {
  useResponsiveLayout,
  type UseResponsiveLayoutOptions,
  type ResponsiveLayoutReturn,
} from "@/components/responsive-layout"

export type ResponsiveSidebarLayoutProps = ParentProps &
  UseResponsiveLayoutOptions & {
    /** Render the full sidebar content. Width is set via CSS variable --sidebar-width. */
    sidebar: () => JSX.Element
    /** Render the collapsed 68px icon strip. */
    collapsedIcons: () => JSX.Element
    /** Optional: data attribute on the root container, e.g. "data-make-area" */
    dataAttribute?: string
    /** Optional: custom data attribute value, e.g. "sidebar" */
    dataValue?: string
    /** Optional: completely hide sidebar (focus mode). Default false. */
    focusMode?: boolean
    /** Optional: custom min-width on root container. Default "1024px". */
    minContainerWidth?: string
    /** Optional: custom background for collapsed strip and drawer. */
    sidebarBackground?: string
    /** Optional: callback when drawer opens */
    onDrawerOpen?: () => void
  }

/**
 * Shared responsive sidebar layout component.
 *
 * Handles:
 * - 1455px breakpoint: sidebar collapses to 68px icon strip
 * - Drawer overlay when collapsed sidebar is clicked
 * - Escape key to close drawer
 * - Sidebar drag-to-resize
 * - Persisted sidebar width
 *
 * Usage:
 * ```tsx
 * <ResponsiveSidebarLayout
 *   storageKey="make.sidebar.width"
 *   sidebar={(w) => <MakeSidebar width={w} />}
 *   collapsedIcons={() => <CollapsedSidebarIcons />}
 * >
 *   <ContentArea />
 * </ResponsiveSidebarLayout>
 * ```
 */
export function ResponsiveSidebarLayout(props: ResponsiveSidebarLayoutProps) {
  const responsive = useResponsiveLayout({
    storageKey: props.storageKey,
    defaultWidth: props.defaultWidth,
    minWidth: props.minWidth,
    maxWidth: props.maxWidth,
  })

  const dataAttr = () => (props.dataAttribute ? { [props.dataAttribute]: props.dataValue ?? "sidebar" } : {})

  function handleSidebarResize(e: MouseEvent) {
    if (responsive.sidebarCollapsed()) return
    e.preventDefault()
    const startX = e.clientX
    const startW = responsive.sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => {
      responsive.setSidebarWidth(
        Math.max(
          props.minWidth ?? 160,
          Math.min(props.maxWidth ?? 360, startW + ev.clientX - startX),
        ),
      )
    }
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const collapsedBg =
    props.sidebarBackground ?? "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)"

  return (
    <div
      {...dataAttr()}
      class="flex flex-1 min-h-0 min-w-0 overflow-hidden relative"
      style={{
        "min-width": props.minContainerWidth ?? "1024px",
        "--sidebar-width": `${responsive.sidebarWidth()}px`,
      }}
    >
      {/* Sidebar area - CSS hidden in focusMode to avoid remounting children */}
      <Show when={!props.focusMode}>
        {/* Full sidebar (>= 1456px) */}
        <Show when={!responsive.sidebarCollapsed()}>
          {props.sidebar()}
          <div
            class="absolute top-0 bottom-0 flex items-center justify-center group"
            style={{
              left: `${responsive.sidebarWidth() - 10}px`,
              width: "20px",
              cursor: "col-resize",
              "z-index": "10",
            }}
            onMouseDown={handleSidebarResize}
          >
            <div
              class="absolute left-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
              style={{
                width: "12px",
                height: "36px",
                "border-radius": "0 10px 10px 0",
                "box-shadow": "2px 0 4px rgba(0,0,0,0.04), inset -1px 0 0 rgba(0,0,0,0.02)",
                border: "1px solid var(--octo-border-divider)",
                "border-left": "none",
                display: "none",
              }}
            >
              <div
                class="w-[2px] h-[14px] rounded-full ml-[2px]"
                style={{ background: "var(--octo-border-input, #c9c9c9)" }}
              />
            </div>
          </div>
        </Show>

        {/* Collapsed icon strip (< 1456px) */}
        <Show when={responsive.sidebarCollapsed()}>
          <div
            class="shrink-0 h-full overflow-hidden"
            style={{
              width: "68px",
              background: collapsedBg,
              "border-right": "1px solid var(--border-weak-base)",
              "z-index": "11",
              cursor: "pointer",
            }}
            onClick={() => responsive.setDrawerOpen(true)}
          >
            {props.collapsedIcons()}
          </div>
        </Show>

        {/* Drawer overlay */}
        <Show when={responsive.isOverlayMode() && responsive.drawerOpen()}>
          <div
            style={{
              position: "absolute",
              inset: "0",
              "z-index": "30",
              background: "rgba(0, 0, 0, 0.2)",
            }}
            onClick={() => responsive.closeDrawer()}
          />
          <div
            style={{
              position: "absolute",
              top: "0",
              left: "0",
              bottom: "0",
              width: `${responsive.sidebarWidth()}px`,
              "z-index": "31",
              background: collapsedBg,
              "border-right": "1px solid var(--border-weak-base)",
              overflow: "hidden",
            }}
          >
            {props.sidebar()}
          </div>
        </Show>
      </Show>

      {/* Content area - always rendered, never destroyed */}
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">{props.children}</div>
    </div>
  )
}

export type { ResponsiveLayoutReturn }
