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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 43 16" width="43" height="16" fill="none"
      style={{ "flex-shrink": "0", display: "inline-block" }}
      innerHTML={`

	<defs>
		<clipPath id="np-clipPath_0">
			<rect width="43.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" fill="rgb(255,255,255)"/>
		</clipPath>
		<linearGradient id="np-paint_linear_0" x1="10.4428577" x2="43" y1="7.99999952" y2="7.99999952" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(2,117,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(5,166,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
		<linearGradient id="np-paint_linear_1" x1="34.5" x2="34.5" y1="3" y2="6" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(222,243,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(183,218,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
		<linearGradient id="np-paint_linear_2" x1="2.5" x2="2.5" y1="0" y2="5" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(222,243,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(183,218,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
	</defs>
	<rect id="组合 71685" width="43.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000"/>
	<path id="矩形 544504" d="M9.08106 0L39 0C41.2091 0 43 1.79086 43 4L43 12C43 14.2091 41.2091 16 39 16L9.08106 16C7.95849 16 6.88759 15.5283 6.12984 14.7001L1.8527 10.025C0.803918 8.8787 0.803918 7.1213 1.8527 5.97496L6.12984 1.29995C6.88759 0.471709 7.95849 0 9.08106 0Z" fill="url(#np-paint_linear_0)" fill-rule="evenodd"/>
	<path id="合并" d="M9 10.8678H10.4632V7.2654C10.4632 6.9318 10.4584 6.2697 10.4299 5.4564C10.829 6.2436 11.19 6.9161 11.3943 7.2706L13.4561 10.8678H15V3.1H13.5416V6.9422C13.5416 7.2706 13.5463 7.9119 13.5653 8.5114C13.285 7.9536 12.981 7.3645 12.8147 7.0725L10.5392 3.1H9Z M18.6457 5C19.135 5 19.5735 5.09482 19.9611 5.28444C19.9955 5.3013 20.0296 5.31888 20.0632 5.33724C20.2384 5.43274 20.3969 5.54496 20.5387 5.6739C20.7307 5.84848 20.8923 6.0537 21.0233 6.28956C21.2511 6.69784 21.3649 7.16636 21.3649 7.69514C21.3649 7.93256 21.3414 8.17266 21.2944 8.41546L17.3158 8.41546C17.3854 8.84172 17.5473 9.16366 17.8014 9.3813C17.8781 9.44694 17.9604 9.5027 18.0484 9.54854C18.252 9.65468 18.486 9.70774 18.7502 9.70774C19.0004 9.70774 19.2249 9.65948 19.4238 9.56298C19.4404 9.5549 19.4568 9.5465 19.4731 9.53778C19.5319 9.50596 19.5869 9.46982 19.6382 9.42936C19.7726 9.3234 19.8813 9.18778 19.9644 9.02248L21.1447 9.68616C21.095 9.81476 21.0313 9.9344 20.9536 10.0451C20.7781 10.295 20.5312 10.4991 20.2129 10.6574C20.153 10.6873 20.0923 10.7152 20.0306 10.7412C19.621 10.9137 19.1716 11 18.6824 11C18.3255 11 17.9854 10.9501 17.6621 10.8504C17.4961 10.7992 17.3345 10.7349 17.1774 10.6574C17.0406 10.5899 16.9117 10.5125 16.7907 10.4251C16.502 10.2166 16.2582 9.95138 16.0592 9.6295C15.7787 9.17266 15.6385 8.6241 15.6385 7.98382C15.6385 7.35072 15.7787 6.80936 16.0592 6.35972C16.2621 6.03668 16.5096 5.77074 16.8019 5.56188C16.9164 5.48002 17.0378 5.40694 17.1661 5.34262C17.3318 5.25954 17.5025 5.19156 17.6782 5.1387C17.9855 5.04624 18.308 5 18.6457 5ZM28.2582 8.71226L27.0101 5.143L25.666 5.143L24.4885 8.75812L23.2263 5.143L21.5717 5.143L23.8391 10.857L24.9968 10.857L26.3042 7.37682L27.668 10.857L28.8116 10.857L31 5.143L29.4385 5.143L28.2582 8.71226ZM18.6005 6.2491C18.4126 6.2491 18.2409 6.2831 18.0855 6.35108C17.9795 6.39748 17.881 6.4597 17.7901 6.53776C17.7874 6.54012 17.7846 6.54248 17.7819 6.54484C17.5624 6.73502 17.4146 7.00066 17.3384 7.34172L19.7216 7.34172C19.6924 7.00092 19.5815 6.73746 19.3888 6.5513C19.3821 6.5449 19.3754 6.5386 19.3686 6.53238C19.2971 6.466 19.2192 6.4113 19.1347 6.36824C18.9788 6.28882 18.8008 6.2491 18.6005 6.2491Z" fill="rgb(237,244,255)" fill-rule="evenodd"/>
	<path id="星形 1" d="M34.5519 3.14025C34.7761 3.74615 35.2538 4.22387 35.8597 4.4481C35.9079 4.46593 35.9079 4.53407 35.8597 4.55191C35.2538 4.77613 34.7761 5.25385 34.5519 5.85975C34.5341 5.90793 34.4659 5.90793 34.4481 5.85975C34.2239 5.25385 33.7462 4.77613 33.1403 4.5519C33.0921 4.53407 33.0921 4.46593 33.1403 4.4481C33.7462 4.22387 34.2239 3.74615 34.4481 3.14025C34.4659 3.09207 34.5341 3.09207 34.5519 3.14025Z" fill="url(#np-paint_linear_1)" fill-rule="evenodd"/>
	<path id="星形 2" d="M2.6081 0.292109C2.96811 1.2649 3.7351 2.03189 4.70789 2.3919C4.80824 2.42903 4.80824 2.57097 4.70789 2.6081C3.7351 2.96811 2.96811 3.7351 2.6081 4.70789C2.57097 4.80824 2.42903 4.80824 2.3919 4.70789C2.03189 3.7351 1.2649 2.96811 0.292108 2.6081C0.191759 2.57097 0.19176 2.42903 0.292109 2.3919C1.2649 2.03189 2.03189 1.2649 2.3919 0.292109C2.42903 0.191759 2.57097 0.19176 2.6081 0.292109Z" fill="url(#np-paint_linear_2)" fill-rule="evenodd" transform="matrix(0.981658,0.190651,-0.190651,0.981658,34.1439,7)"/>
`}
    />
  )
}

function NavTrailingBetaIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 43 16" width="43" height="16" fill="none"
      style={{ "flex-shrink": "0", display: "inline-block" }}
      innerHTML={`

	<defs>
		<clipPath id="nb-clipPath_0">
			<rect width="43.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000" fill="rgb(255,255,255)"/>
		</clipPath>
		<linearGradient id="nb-paint_linear_0" x1="10.4428577" x2="43" y1="7.99999952" y2="7.99999952" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(2,117,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(5,166,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
		<linearGradient id="nb-paint_linear_1" x1="34.5" x2="34.5" y1="3" y2="6" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(222,243,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(183,218,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
		<linearGradient id="nb-paint_linear_2" x1="2.5" x2="2.5" y1="0" y2="5" gradientUnits="userSpaceOnUse">
			<stop stop-color="rgb(222,243,255)" offset="0" stop-opacity="1"/>
			<stop stop-color="rgb(183,218,255)" offset="1" stop-opacity="1"/>
		</linearGradient>
	</defs>
	<rect id="组合 71685" width="43.000000" height="16.000000" x="0.000000" y="0.000000" rx="4.000000"/>
	<path id="矩形 544504" d="M9.08106 0L39 0C41.2091 0 43 1.79086 43 4L43 12C43 14.2091 41.2091 16 39 16L9.08106 16C7.95849 16 6.88759 15.5283 6.12984 14.7001L1.8527 10.025C0.803918 8.8787 0.803918 7.1213 1.8527 5.97496L6.12984 1.29995C6.88759 0.471709 7.95849 0 9.08106 0Z" fill="url(#nb-paint_linear_0)" fill-rule="evenodd"/>
	<path id="Beta" d="M9.5 11.05092470277411H12.69917914051183C14.417914051183004 11.05092470277411 15.345726702076291 10.345013210039632 15.345726702076291 9.317107001321006C15.345726702076291 8.441941875825629 14.635924674070498 7.9135402906208725 13.713182037662964 7.843361955085866V7.835105680317042C14.544664413326895 7.665852047556143 15.06687590535973 7.191116248348745 15.06687590535973 6.481076618229856C15.06687590535973 5.535733157199472 14.154273297923709 4.9 12.526798647996138 4.9H9.5ZM11.026074360212458 10.051915455746368V8.413044914134744H12.506518590053116C13.292370835345245 8.413044914134744 13.75374215354901 8.73503963011889 13.75374215354901 9.246928665785997C13.75374215354901 9.758817701453106 13.282230806373732 10.051915455746368 12.481168517624337 10.051915455746368ZM11.026074360212458 7.455317040951123V5.899009247027742H12.410188314823756C13.094640270400774 5.899009247027742 13.515451472718494 6.200363276089829 13.515451472718494 6.6792272126816385C13.515451472718494 7.1539630118890365 13.094640270400774 7.455317040951123 12.410188314823756 7.455317040951123Z M18.600676001931433 11.15C19.898599710284888 11.15 20.932882665379044 10.547291941875827 21.130613230323515 9.680383091149274H19.76677933365524C19.629888942539836 10.01889035667107 19.22935779816514 10.237681638044915 18.646306132303234 10.237681638044915C17.860453887011104 10.237681638044915 17.404152583293094 9.820739762219288 17.37880251086432 9.176750330250991H21.18638338966683V8.850627476882432C21.18638338966683 7.521367239101718 20.12675036214389 6.5925363276089834 18.54997585707388 6.5925363276089834C17.013761467889907 6.5925363276089834 15.923708353452438 7.546136063408191 15.923708353452438 8.875396301188903C15.923708353452438 10.200528401585206 16.97827136648962 11.15 18.600676001931433 11.15ZM17.388942539835828 8.400660501981507C17.470062771607918 7.855746367239103 17.911154031868662 7.517239101717306 18.58039594398841 7.517239101717306C19.254707870593915 7.517239101717306 19.700869145340416 7.855746367239103 19.77691936262675 8.400660501981507Z M25.064944471269918 6.691611624834875H23.969821342346695V5.502708058124175H22.474167069048768V6.691611624834875H21.551424432641237V7.645211360634082H22.474167069048768V9.895046235138706C22.474167069048768 10.68764861294584 23.016658619024625 11.05092470277411 24.19290197971994 11.05092470277411H25.064944471269918V10.097324966974902H24.49203283437953C24.086431675519073 10.097324966974902 23.969821342346695 10.002377807133422 23.969821342346695 9.705151915455748V7.645211360634082H25.064944471269918Z M27.452921294060843 11.125231175693528C28.27426364075326 11.125231175693528 28.73563495895703 10.86103038309115 29.019555770159343 10.435832232496699H29.03983582810237V11.05092470277411H30.5V8.095178335535007C30.5 7.1622192866578605 29.65837759536456 6.600792602377807 28.193143408981168 6.600792602377807C26.722839208112024 6.600792602377807 25.850796716562048 7.170475561426684 25.784886528247224 8.070409511228535H27.189280540801548C27.224770642201836 7.736030383091149 27.589811685176244 7.50485468956407 28.147513278609367 7.50485468956407C28.69507484307098 7.50485468956407 29.0246257846451 7.7277741083223255 29.0246257846451 8.049768824306474V8.078665785997359C29.0246257846451 8.359379128137386 28.679864799613714 8.396532364597094 27.70135200386287 8.474966974900926C26.58594881699662 8.55752972258917 25.61250603573153 8.838243064729195 25.61250603573153 9.820739762219288C25.61250603573153 10.691776750330252 26.383148237566395 11.125231175693528 27.452921294060843 11.125231175693528ZM27.868662481892805 10.278963011889036C27.366731047802993 10.278963011889036 27.04225012071463 10.097324966974902 27.04225012071463 9.78771466314399C27.04225012071463 9.44095112285337 27.447851279575087 9.279953764861295 27.959922742636408 9.218031704095113C28.441574118783198 9.15610964332893 28.86238532110092 9.098315719947161 29.034765813616612 9.019881109643329V9.457463672391018C29.034765813616612 9.928071334214003 28.58860453887011 10.278963011889036 27.868662481892805 10.278963011889036Z" fill="rgb(237,244,255)" fill-rule="evenodd" data-text="Beta"/>
	<path id="星形 1" d="M34.5519 3.14025C34.7761 3.74615 35.2538 4.22387 35.8597 4.4481C35.9079 4.46593 35.9079 4.53407 35.8597 4.55191C35.2538 4.77613 34.7761 5.25385 34.5519 5.85975C34.5341 5.90793 34.4659 5.90793 34.4481 5.85975C34.2239 5.25385 33.7462 4.77613 33.1403 4.5519C33.0921 4.53407 33.0921 4.46593 33.1403 4.4481C33.7462 4.22387 34.2239 3.74615 34.4481 3.14025C34.4659 3.09207 34.5341 3.09207 34.5519 3.14025Z" fill="url(#nb-paint_linear_1)" fill-rule="evenodd"/>
	<path id="星形 2" d="M2.6081 0.292109C2.96811 1.2649 3.7351 2.03189 4.70789 2.3919C4.80824 2.42903 4.80824 2.57097 4.70789 2.6081C3.7351 2.96811 2.96811 3.7351 2.6081 4.70789C2.57097 4.80824 2.42903 4.80824 2.3919 4.70789C2.03189 3.7351 1.2649 2.96811 0.292108 2.6081C0.191759 2.57097 0.19176 2.42903 0.292109 2.3919C1.2649 2.03189 2.03189 1.2649 2.3919 0.292109C2.42903 0.191759 2.57097 0.19176 2.6081 0.292109Z" fill="url(#nb-paint_linear_2)" fill-rule="evenodd" transform="matrix(0.981658,0.190651,-0.190651,0.981658,34.1439,7)"/>
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
