import { Show, For, type ParentProps, type JSX, type ComponentProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProjectInfo } from "@/components/project-info"
import { DialogSettings } from "@/components/dialog-settings"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings, IconSettings1,
} from "@/pages/_shell/icons"

type IconName = ComponentProps<typeof Icon>["name"]

// ── Chevron icon for collapse toggle ──
function ChevronRightIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
      style={{
        transform: props.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
    </svg>
  )
}

// ── NAV_ITEMS config ──
const DEFAULT_NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1, hidden: true },
] as const

export type SidebarShellProps = ParentProps & {
  /** Show ProjectInfo at top. Default true. */
  showProjectInfo?: boolean
  /** Show bottom nav (技能库 etc). Default true. */
  showBottomNav?: boolean

  // ── New button ──
  /** Icon for the "new" button. Default "plus". */
  newButtonIcon?: IconName
  /** Text for the "new" button. Default "新建对话". */
  newButtonText?: string
  /** Click handler for the "new" button */
  onNewClick?: () => void

  // ── Section header ──
  /** Icon element for the section header */
  sectionIcon?: () => JSX.Element
  /** Title text for the section header */
  sectionTitle: string
  /** Whether section is collapsed. Controlled externally. */
  collapsed: boolean
  /** Toggle section collapse */
  onToggleCollapse?: () => void

  // ── Bottom nav ──
  /** Active nav key */
  activeNav?: string | null
  /** Nav item click handler. Receives item key. */
  onNavClick?: (key: string) => void
  /** Override NAV_ITEMS. Default: 技能库 + 资产库(hidden). */
  navItems?: Array<{ key: string; label: string; Icon: typeof IconSkill; IconActive: typeof IconSkill1; hidden?: boolean }>

  // ── Settings ──
  /** Custom settings click handler. Default: opens DialogSettings. */
  onSettingsClick?: () => void

  // ── Style overrides ──
  /** Custom background for the sidebar */
  background?: string
}

/**
 * Shared sidebar shell component.
 *
 * Provides the outer structure for sidebars:
 * - Root container with standard styles
 * - Top section: ProjectInfo + new button + divider
 * - Section header: icon + title + collapse chevron (shrink-0, outside scroll area)
 * - Scroll area for session list (children)
 * - Bottom nav: NAV_ITEMS with active state
 * - Settings button
 *
 * Usage:
 * ```tsx
 * <SidebarShell
 *   width={296}
 *   sectionTitle="Octo Insight"
 *   sectionIcon={() => <img src="/insightIcon.svg" />}
 *   collapsed={collapsed()}
 *   onToggleCollapse={() => setCollapsed(v => !v)}
 *   onNewClick={newSession}
 * >
 *   <SessionList />
 * </SidebarShell>
 * ```
 */
export function SidebarShell(props: SidebarShellProps) {
  const dialog = useDialog()

  const collapsed = () => props.collapsed
  const navItems = () => props.navItems ?? DEFAULT_NAV_ITEMS as unknown as SidebarShellProps["navItems"]

  return (
    <div
      data-sidebar-shell
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: "var(--sidebar-width, 296px)",
        "padding-top": "12px",
        background: props.background ?? "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        "border-right": "1px solid var(--border-weak-base)",
        "z-index": 11,
      }}
    >
      {/* ─── Top: ProjectInfo + New button + Divider ─── */}
      <div class="shrink-0 flex flex-col px-[12px]">
        <Show when={props.showProjectInfo !== false}>
          <ProjectInfo />
        </Show>
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-3 w-full mb-[8px] rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
            style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
            onClick={props.onNewClick}
          >
            <Icon name={props.newButtonIcon ?? "plus"} size="normal" class="shrink-0" />
            <span>{props.newButtonText ?? "新建对话"}</span>
          </button>
        </div>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", "margin-bottom": "8px" }} />
      </div>

      {/* ─── Section header (non-scrolling) ─── */}
      <div class="shrink-0 px-[12px]">
        <div class="flex items-center h-[36px] px-[12px]">
          <button
            type="button"
            onClick={props.onToggleCollapse}
            class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
          >
            <span class="flex items-center gap-[12px] min-w-0">
              <Show when={props.sectionIcon}>
                {props.sectionIcon?.()}
              </Show>
              <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                {props.sectionTitle}
              </span>
            </span>
            <ChevronRightIcon collapsed={collapsed()} />
          </button>
        </div>
      </div>

      {/* ─── Scrollable content area ─── */}
      <Show when={!collapsed()}>
        <div
          data-slot="list-scroll"
          class="flex-1 min-h-0 overflow-y-auto px-[12px]"
          style={{ position: "relative", "z-index": 11 }}
        >
          {props.children}
        </div>
      </Show>

      {/* ─── Spacer: push bottom nav to bottom when collapsed ─── */}
      <Show when={collapsed()}>
        <div class="flex-1" />
      </Show>

      {/* ─── Bottom nav ─── */}
      <Show when={props.showBottomNav !== false}>
      <div class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[12px]">
        <For each={navItems()}>
          {(item) => {
            const isActive = () => props.activeNav === item.key
            return (
              <Show when={!item.hidden}>
                <button
                  type="button"
                  onClick={() => props.onNavClick?.(item.key)}
                  title={item.label}
                  classList={{
                    "w-full relative flex items-center gap-[8px] px-[12px] rounded-[4px] transition-colors text-[14px] leading-[22px]": true,
                  }}
                  style={{
                    height: "36px",
                    background: isActive() ? "var(--surface-base-interactive-active)" : "transparent",
                    color: isActive() ? "var(--text-interactive-base)" : "var(--text-strong)",
                    "font-weight": isActive() ? "500" : "400",
                  }}
                  onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--surface-base-hover)" }}
                  onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
                >
                  <span class="flex items-center justify-center shrink-0">
                    <Show when={isActive()} fallback={<item.Icon size={16} />}>
                      <item.IconActive size={16} />
                    </Show>
                  </span>
                  <span class="truncate">{item.label}</span>
                  <Show when={isActive()}>
                    <span
                      class="absolute right-0 top-1/2 rounded-l-[3px]"
                      style={{
                        height: "20px",
                        width: "3px",
                        background: "var(--text-interactive-base)",
                        transform: "translateY(-50%)",
                      }}
                    />
                  </Show>
                </button>
              </Show>
            )
          }}
        </For>
      </div>
      </Show>

      {/* ─── Settings ─── */}
      <div class="shrink-0 px-[12px] pb-[24px]" style={{ "padding-top": props.showBottomNav === false ? "12px" : "0" }}>
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[12px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--text-strong)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-base-hover)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          onClick={() => props.onSettingsClick?.() ?? dialog.show(() => <DialogSettings />)}
        >
          <IconSettings size={16} />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
    </div>
  )
}
