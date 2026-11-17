import { Show, For, createSignal, type ParentProps, type JSX, type ComponentProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProjectInfo } from "@/components/project-info"
import { DialogSettings } from "@/components/dialog-settings"
import { UpdateButton } from "@/components/update-button"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconDesignSystem, IconDesignSystem1,
  IconPractice, IconPractice1,
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
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="#777777"/>
    </svg>
  )
}

function NavTrailingIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 16" width="37" height="16" fill="none"
      style={{ "flex-shrink": "0", display: "inline-block" }}
      innerHTML={`

	<defs>
		<clipPath id="np-clipPath_0">
			<rect width="37.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" fill="rgb(255,255,255)" />
		</clipPath>
		<linearGradient id="np-paint_linear_1" x1="8.98571491" x2="37" y1="7.99999952" y2="7.99999952" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(2,117,255)" offset="0" stop-opacity="1" />
			<stop stop-color="rgb(5,166,255)" offset="1" stop-opacity="1" />
		</linearGradient>
	</defs>
	<rect id="组合 71685" width="37.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" />
	<path id="矩形 544504" d="M8.23969 0L33 0C35.2091 0 37 1.79086 37 4L37 12C37 14.2091 35.2091 16 33 16L8.23969 16C7.01357 16 5.85517 15.4377 5.09674 14.4742L1.46085 9.85568C0.603805 8.767 0.603805 7.233 1.46085 6.14432L5.09674 1.52576C5.85517 0.562348 7.01357 0 8.23969 0Z" fill="url(#np-paint_linear_1)" fill-rule="evenodd" />
	<path id="矢量 4848" d="M11.2027 4L14.8459 9.20381L14.8459 4L16.2315 4L16.2315 11.8713L15.0187 11.8713L11.3656 6.65441L11.3656 11.8713L10 11.8713L10 4L11.2027 4ZM21.2952 6.48901C20.9294 6.2702 20.5101 6.16081 20.0374 6.16081C19.5663 6.16081 19.1287 6.27197 18.7244 6.49426C18.3202 6.71654 17.9928 7.0465 17.7422 7.48408C17.4934 7.92166 17.3689 8.44854 17.3689 9.06465C17.3689 9.68779 17.4934 10.2216 17.7422 10.6662C17.9928 11.1108 18.3235 11.4443 18.7345 11.6666C19.1454 11.8888 19.5905 12 20.07 12C20.5694 12 21.0221 11.8888 21.428 11.6666Q21.8176 11.4541 22.0464 11.1286Q22.1767 10.9433 22.2549 10.7214L21.2075 10.0755C21.1056 10.2978 20.9603 10.4649 20.7715 10.577C20.5844 10.6872 20.3706 10.7424 20.1301 10.7424C19.7943 10.7424 19.5137 10.6365 19.2882 10.4247C19.0627 10.2129 18.919 9.89957 18.8572 9.48474L22.3876 9.48474C22.4294 9.24844 22.4503 9.01477 22.4503 8.78372C22.4503 8.26912 22.3492 7.81316 22.1471 7.41582C21.945 7.01674 21.661 6.70781 21.2952 6.48901ZM27.4596 6.29997L28.5671 9.77355L29.6144 6.29997L31 6.29997L29.0582 11.8608L28.0434 11.8608L26.8332 8.47391L25.6731 11.8608L24.6458 11.8608L22.6338 6.29997L24.102 6.29997L25.2221 9.81818L26.2669 6.29997L27.4596 6.29997ZM19.2782 7.65737C19.477 7.47007 19.7167 7.37644 19.9973 7.37644C20.2712 7.37644 20.4984 7.46833 20.6788 7.65212C20.8609 7.83416 20.9653 8.09672 20.992 8.43978L18.8773 8.43978C18.9458 8.10371 19.0794 7.84289 19.2782 7.65737Z" fill="rgb(237,244,255)" fill-rule="evenodd" />
`}
    />
  )
}

function NavTrailingBetaIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 16" width="37" height="16" fill="none"
      style={{ "flex-shrink": "0", display: "inline-block" }}
      innerHTML={`

	<defs>
		<clipPath id="nb-clipPath_1">
			<rect width="36.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" fill="rgb(255,255,255)" />
		</clipPath>
		<linearGradient id="nb-paint_linear_4" x1="8.98571491" x2="37" y1="7.99999952" y2="7.99999952" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(2,117,255)" offset="0" stop-opacity="1" />
			<stop stop-color="rgb(5,166,255)" offset="1" stop-opacity="1" />
		</linearGradient>
	</defs>
	<rect id="组合 71686" width="36.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" />
	<path id="矩形 544504" d="M8.23969 0L33 0C35.2091 0 37 1.79086 37 4L37 12C37 14.2091 35.2091 16 33 16L8.23969 16C7.01357 16 5.85517 15.4377 5.09674 14.4742L1.46085 9.85568C0.603805 8.767 0.603805 7.233 1.46085 6.14432L5.09674 1.52576C5.85517 0.562348 7.01357 0 8.23969 0Z" fill="url(#nb-paint_linear_4)" fill-rule="evenodd" />
	<path id="矢量 4847" d="M14.4912 7.78602C15.3021 8.09426 15.7078 8.69971 15.7078 9.60289C15.7078 10.3118 15.465 10.8673 14.9793 11.2701C14.4937 11.6708 13.8118 11.8713 12.9336 11.8713L10 11.8713L10 4L12.6638 4Q13.821 4 14.5543 4.55748Q14.5657 4.56617 14.5771 4.57499C15.0691 4.95832 15.3154 5.4976 15.3154 6.19232C15.3154 6.91697 15.0406 7.44838 14.4912 7.78602ZM25.926 11.5484C25.5841 11.8493 25.1082 12 24.4984 12C23.9357 12 23.482 11.8409 23.1371 11.5222C22.7922 11.2034 22.6195 10.6321 22.6195 9.80768L22.6195 7.56022L21.6948 7.56022L21.6948 6.29997L22.6195 6.29997L22.6195 4.59074L24.0177 4.59074L24.0177 6.29997L25.585 6.29997L25.585 7.56022L24.0177 7.56022L24.0177 9.55825C24.0177 9.93108 24.0775 10.2146 24.1967 10.4089C24.3179 10.6032 24.5122 10.7004 24.7805 10.7004C25.0145 10.7004 25.2353 10.6253 25.4428 10.4746L25.926 11.5484ZM11.4276 5.35478L11.4276 7.21365L12.5216 7.21365C12.9174 7.21365 13.2304 7.12596 13.461 6.9511C13.693 6.77624 13.8093 6.54152 13.8093 6.24746C13.8093 5.96022 13.695 5.73968 13.4659 5.58582C13.2388 5.43197 12.9238 5.35478 12.5216 5.35478L11.4276 5.35478ZM19.0221 6.16081C19.4848 6.16081 19.8954 6.27004 20.2535 6.48901C20.6116 6.70798 20.8898 7.01674 21.0875 7.41582C21.2852 7.81332 21.3843 8.26912 21.3843 8.78372C21.3843 9.01477 21.3637 9.24844 21.3229 9.48474L17.8668 9.48474C17.9272 9.89957 18.068 10.2131 18.2887 10.4247C18.5095 10.6363 18.7842 10.7424 19.1129 10.7424C19.3484 10.7424 19.5579 10.6872 19.7408 10.577C19.9258 10.4651 20.0681 10.2976 20.1676 10.0755L21.1929 10.7214C21.0521 11.1294 20.7823 11.4444 20.3835 11.6666C19.9861 11.8887 19.5431 12 19.054 12C18.5846 12 18.1489 11.8887 17.7467 11.6666Q17.6353 11.6051 17.532 11.5322Q17.0753 11.2103 16.7753 10.6662C16.5315 10.2215 16.4098 9.68796 16.4098 9.06465C16.4098 8.4487 16.5315 7.9215 16.7753 7.48408C17.0206 7.04667 17.341 6.71638 17.7368 6.49426C18.1327 6.27214 18.561 6.16081 19.0221 6.16081ZM28.7581 6.16081C29.4611 6.16081 30.0105 6.37453 30.4064 6.80144C30.8023 7.22678 31 7.83433 31 8.62356L31 11.8713L29.8226 11.8713C29.8162 11.8136 29.8079 11.7191 29.7981 11.5878C29.7883 11.4549 29.7736 11.3373 29.7539 11.236C29.6004 11.4948 29.4007 11.6876 29.1554 11.8136C28.9116 11.938 28.6158 12 28.2675 12C27.9045 12 27.5743 11.9328 27.2765 11.7978C26.9788 11.6613 26.7428 11.4618 26.5677 11.1992C26.3945 10.9367 26.3077 10.6268 26.3077 10.2698C26.3077 9.89695 26.4068 9.57243 26.6045 9.2957C26.8022 9.01897 27.0681 8.80578 27.4016 8.65507C27.7367 8.50436 28.1056 8.42928 28.5079 8.42928C28.8694 8.42928 29.2413 8.49386 29.6239 8.62356C29.6028 7.79915 29.2742 7.38694 28.6379 7.38694C28.1292 7.38694 27.7573 7.63006 27.5218 8.11684L26.5284 7.50509C26.7163 7.08868 27.0043 6.76049 27.3918 6.52051C27.7809 6.28054 28.2366 6.16081 28.7581 6.16081ZM18.9829 7.37644C18.7082 7.37644 18.4737 7.4699 18.2789 7.65737C18.0842 7.84273 17.9537 8.10371 17.8865 8.43978L19.9567 8.43978C19.9307 8.09688 19.8282 7.83433 19.6501 7.65212C19.4735 7.46833 19.2512 7.37644 18.9829 7.37644ZM12.8134 10.5166C13.2564 10.5166 13.5969 10.431 13.8338 10.2593C14.0708 10.086 14.1895 9.84181 14.1895 9.52675C14.1895 9.21168 14.0708 8.96488 13.8338 8.78635C13.5969 8.60624 13.2535 8.51592 12.8036 8.51592L11.4276 8.51592L11.4276 10.5166L12.8134 10.5166ZM29.6239 9.61339C29.2889 9.5278 28.997 9.48474 28.7483 9.48474Q28.2552 9.48474 27.983 9.67378C27.8029 9.79823 27.7132 9.97466 27.7132 10.2041C27.7132 10.4126 27.7853 10.5743 27.929 10.6899C28.0727 10.8038 28.2592 10.8605 28.4883 10.8605C28.789 10.8605 29.0534 10.7697 29.2805 10.5875C29.5096 10.4037 29.6239 10.1506 29.6239 9.82868L29.6239 9.61339Z" fill="rgb(237,244,255)" fill-rule="evenodd" />
`}
    />
  )
}

export function SidebarSectionHeader(props: {
  title: string
  icon?: () => JSX.Element
  collapsed: boolean
  onToggleCollapse?: () => void
  actionIcon?: () => JSX.Element
  onAction?: () => void
  class?: string
}) {
  return (
    <div class={`shrink-0 px-[12px]${props.class ? ` ${props.class}` : ""}`}>
      <div class="flex items-center h-[36px] px-[12px]">
        <button
          type="button"
          onClick={props.onToggleCollapse}
          class="flex items-center gap-[4px] flex-1 min-w-0 text-left select-none"
        >
          <span class="flex items-center gap-[12px] min-w-0">
            <Show when={props.icon}>
              {props.icon?.()}
            </Show>
            <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "#777777", "font-weight": 450 }}>
              {props.title}
            </span>
          </span>
          <ChevronRightIcon collapsed={props.collapsed} />
        </button>
        <Show when={props.actionIcon}>
          <button
            type="button"
            onClick={props.onAction}
            class="flex items-center justify-center shrink-0"
            style={{ width: "24px", height: "24px" }}
          >
            {props.actionIcon?.()}
          </button>
        </Show>
      </div>
    </div>
  )
}

// ── NAV_ITEMS config ──
const DEFAULT_NAV_ITEMS = [
  { key: "design_system", label: "设计系统", Icon: IconDesignSystem, IconActive: IconDesignSystem1, trailingIcon: NavTrailingBetaIcon },
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
  { key: "best_practice", label: "优秀实践", Icon: IconPractice, IconActive: IconPractice1, trailingIcon: NavTrailingIcon },
] as const

const NAV_TARGET: Record<string, "skills" | "assets" | "design_system" | "best_practices"> = {
  skill_market: "skills",
  knowledge_base: "assets",
  design_system: "design_system",
  best_practice: "best_practices",
}

export type SidebarShellProps = ParentProps & {
  onNavigation?: (target: "project" | "skills" | "assets" | "design_system" | "best_practices" | "settings" | "update") => void
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
  /** Content rendered at the right edge of the new-session button row (e.g. a drawer toggle). */
  newButtonSuffix?: () => JSX.Element
  /** Content rendered between the new-session button and the divider (e.g. studio's history entry). */
  headerExtra?: () => JSX.Element

  // ── Section header ──
  /** Icon element for the section header */
  sectionIcon?: () => JSX.Element
  /** Title text for the section header */
  sectionTitle: string
  /** Whether section is collapsed. Controlled externally. */
  collapsed: boolean
  /** Toggle section collapse */
  onToggleCollapse?: () => void
  /** Content rendered above the main section header (e.g. extra collapsible groups). */
  beforeSection?: () => JSX.Element
  /** When true, render beforeSection + section header inside the scroll area (shared scrollbar). */
  inlineBeforeSection?: boolean

  // ── Bottom nav ──
  /** Active nav key */
  activeNav?: string | null
  /** Nav item click handler. Receives item key. */
  onNavClick?: (key: string) => void
  /** Override NAV_ITEMS. Default: 技能库 + 资产库(hidden). */
  navItems?: Array<{ key: string; label: string; Icon: typeof IconSkill; IconActive: typeof IconSkill1; trailingIcon?: () => JSX.Element; hidden?: boolean }>

  // ── Settings ──
  /** Custom settings click handler. Default: opens DialogSettings. */
  onSettingsClick?: () => void

  // ── Style overrides ──
  /** Custom background for the sidebar */
  background?: string
  /** Ref callback for the scrollable list container (data-slot="list-scroll"). */
  listScrollRef?: (el: HTMLDivElement) => void
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
  const [settingsActive, setSettingsActive] = createSignal(false)

  return (
    <div
      data-sidebar-shell
      class="shrink-0 flex flex-col h-full overflow-hidden"
      style={{
        width: "var(--sidebar-width, 296px)",
        "padding-top": "12px",
        background: props.background ?? "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        "border-right": "1px solid rgba(0, 0, 0, 0.1)",
        "z-index": 11,
      }}
    >
      {/* ─── Top: ProjectInfo + New button + Divider ─── */}
      <div class="shrink-0 flex flex-col px-[12px]">
        <Show when={props.showProjectInfo !== false}>
          <ProjectInfo onOpen={() => props.onNavigation?.("project")} />
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
          <Show when={props.newButtonSuffix}>
            <div class="absolute right-0 top-0 flex items-center" style={{ height: "36px" }}>
              {props.newButtonSuffix?.()}
            </div>
          </Show>
        </div>
        <Show when={props.headerExtra}>
          {props.headerExtra?.()}
        </Show>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", "margin-bottom": "8px" }} />
      </div>

      <Show when={!props.inlineBeforeSection}>
        {props.beforeSection?.()}
        <SidebarSectionHeader
          title={props.sectionTitle}
          icon={props.sectionIcon}
          collapsed={collapsed()}
          onToggleCollapse={props.onToggleCollapse}
        />
      </Show>

      {/* ─── Scrollable content area ─── */}
      <Show when={props.inlineBeforeSection || !collapsed()}>
        <div
          ref={props.listScrollRef}
          data-slot="list-scroll"
          class={`flex-1 min-h-0 overflow-y-auto px-[12px]${props.inlineBeforeSection ? " group-list-scroll" : ""}`}
          style={{ position: "relative", "z-index": 11 }}
        >
          <Show when={props.inlineBeforeSection}>
            {props.beforeSection?.()}
            <SidebarSectionHeader
              title={props.sectionTitle}
              icon={props.sectionIcon}
              collapsed={collapsed()}
              onToggleCollapse={props.onToggleCollapse}
              class="section-header-inline"
            />
          </Show>
          <Show when={!collapsed()}>
            {props.children}
          </Show>
        </div>
      </Show>

      {/* ─── Spacer: push bottom nav to bottom when collapsed (non-inline) ─── */}
      <Show when={collapsed() && !props.inlineBeforeSection}>
        <div class="flex-1" />
      </Show>

      {/* ─── Bottom nav ─── */}
      <Show when={props.showBottomNav !== false}>
      <div class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[12px]">
        <For each={navItems()}>
          {(item) => {
            const isActive = () => props.activeNav === item.key && !settingsActive()
            return (
              <Show when={!item.hidden}>
                <button
                  type="button"
                  onClick={() => {
                    const navTarget = NAV_TARGET[item.key]
                    if (navTarget) props.onNavigation?.(navTarget)
                    props.onNavClick?.(item.key)
                  }}
                  title={item.label}
                  classList={{
                    "w-full relative flex items-center gap-[12px] px-[12px] rounded-[4px] transition-colors text-[12px] leading-[20px]": true,
                  }}
                  style={{
                    height: "36px",
                    background: isActive() ? "rgba(10, 89, 247, 0.08)" : "transparent",
                    color: isActive() ? "#0A59F7" : "rgba(0,0,0,0.9)",
                    "font-weight": isActive() ? "500" : "400",
                  }}
                  onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "var(--surface-base-hover)" }}
                  onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}
                >
                  <span class="flex items-center justify-center shrink-0">
                    <Show when={isActive()} fallback={<item.Icon size={20} />}>
                      <item.IconActive size={20} />
                    </Show>
                  </span>
                  <span class="flex items-center gap-[4px] min-w-0 flex-1">
                    <span class="truncate min-w-0">{item.label}</span>
                    <Show when={item.trailingIcon}>
                      <span class="flex items-center shrink-0">{item.trailingIcon?.()}</span>
                    </Show>
                  </span>
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
      <div class="relative shrink-0 px-[12px] pb-[24px]" style={{ "padding-top": "0" }}>
        <button
          type="button"
          title="设置"
          class="w-full relative flex items-center gap-[12px] px-[12px] rounded-[4px] transition-colors text-[12px] leading-[20px]"
          style={{
            height: "36px",
            background: settingsActive() ? "rgba(10, 89, 247, 0.08)" : "transparent",
            color: settingsActive() ? "#0A59F7" : "rgba(0,0,0,0.9)",
            "font-weight": settingsActive() ? "500" : "400",
          }}
          onMouseEnter={(e) => { if (!settingsActive()) e.currentTarget.style.background = "var(--surface-base-hover)" }}
          onMouseLeave={(e) => { if (!settingsActive()) e.currentTarget.style.background = "transparent" }}
          onClick={() => {
            if (props.onSettingsClick) {
              props.onNavigation?.("settings")
              props.onSettingsClick()
            } else {
              setSettingsActive(true)
              props.onNavigation?.("settings")
              dialog.show(() => <DialogSettings />, () => setSettingsActive(false))
            }
          }}
        >
          <span class="flex items-center justify-center shrink-0">
            <Show when={settingsActive()} fallback={<IconSettings size={20} />}>
              <IconSettings1 size={20} />
            </Show>
          </span>
          <span class="truncate">设置</span>
          <Show when={settingsActive()}>
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
        <UpdateButton onOpen={() => props.onNavigation?.("update")} />
      </div>
    </div>
  )
}
