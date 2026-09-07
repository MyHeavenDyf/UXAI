import { Show, type JSX, type ComponentProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectInfo } from "@/components/project-info"
import { IconSkill, IconSettings } from "@/pages/_shell/icons"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSettings } from "@/components/dialog-settings"

type IconName = ComponentProps<typeof Icon>["name"]

export type CollapsedSidebarIconsProps = {
  /** Show project info at top. Default true. */
  showProject?: boolean
  /** Show the "new conversation" button. Default true. */
  showConversation?: boolean
  /** Custom icon name for conversation button. Default "plus". */
  conversationIcon?: IconName
  /** Click handler for conversation button. */
  onConversationClick?: () => void
  /** Tooltip for conversation button. Default "新建对话". */
  conversationTitle?: string
  /** Show the "home" button between conversation and bottom icons. Default true. */
  showHome?: boolean
  /** Custom icon for home button. Default "tab-make". */
  homeIcon?: IconName
  /** Home icon color. Default "#0a59f7". */
  homeIconColor?: string
  /** Click handler for home button. */
  onHomeClick?: () => void
  /** Tooltip for home button. Default "Octo Design". */
  homeTitle?: string
  /** Show skills button at bottom. Default true. */
  showSkills?: boolean
  /** Click handler for skills button. */
  onSkillsClick?: () => void
  /** Tooltip for skills button. Default "技能库". */
  skillsTitle?: string
  /** Show settings button at bottom. Default true. */
  showSettings?: boolean
  /** Click handler for settings button. */
  onSettingsClick?: () => void
  /** Tooltip for settings button. Default "设置". */
  settingsTitle?: string
  /** Additional icon buttons to render between home and skills. */
  extraIcons?: () => JSX.Element
}

/**
 * Collapsed sidebar icon strip (68px wide).
 *
 * Used when the viewport is < 1456px and the sidebar collapses.
 * Clicking this strip opens the drawer overlay.
 *
 * All sections are configurable — show/hide project info, conversation,
 * home, skills, settings, and inject custom icons.
 *
 * ```tsx
 * <CollapsedSidebarIcons
 *   showProject={true}
 *   conversationIcon="message-square"
 *   onConversationClick={() => navigate("/chat")}
 *   showSkills={false}
 * />
 * ```
 */
export function CollapsedSidebarIcons(props: CollapsedSidebarIconsProps) {
  const dialog = useDialog()

  const showProject = () => props.showProject ?? true
  const showConversation = () => props.showConversation ?? true
  const showHome = () => props.showHome ?? true
  const showSkills = () => props.showSkills ?? true
  const showSettings = () => props.showSettings ?? true

  return (
    <div class="h-full flex flex-col items-center" style={{ padding: "12px 10px 24px 10px" }}>
      {/* Project info — collapsed: hide text, keep icon only */}
      <Show when={showProject()}>
        <div class="collapsed-project-info">
          <style>
            {`.collapsed-project-info > div {
              min-height: 70px;
              display: flex !important;
              align-items: center;
              justify-content: center;
              pointer-events: none;
            }
            .collapsed-project-info > div > div > svg {
              margin-right: 0 !important;
            }
            .collapsed-project-info > div > div > svg + div {
              display: none;
            }`}
          </style>
          <ProjectInfo />
        </div>
      </Show>

      {/* New conversation */}
      <Show when={showConversation()}>
        <button
          type="button"
          class="flex items-center justify-center rounded-lg hover:bg-[rgba(25,25,25,0.06)] transition-colors"
          style={{ width: "36px", height: "36px", "margin-bottom": "8px" }}
          onClick={(e) => {
            if (props.onConversationClick) {
              e.stopPropagation()
              props.onConversationClick()
            }
          }}
          title={props.conversationTitle ?? "新建对话"}
        >
          <Icon name={props.conversationIcon ?? "plus"} size="normal" />
        </button>
      </Show>

      {/* Divider */}
      <Show when={showHome()}>
        <div style={{ width: "48px", height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 0 8px 0" }} />
      </Show>

      {/* Home */}
      <Show when={showHome()}>
        <button
          type="button"
          class="flex items-center justify-center rounded-lg hover:bg-[rgba(25,25,25,0.06)] transition-colors"
          style={{ width: "36px", height: "36px" }}
          onClick={(e) => {
            if (props.onHomeClick) {
              e.stopPropagation()
              props.onHomeClick()
            }
            // Without onHomeClick, let click bubble to parent → opens drawer
          }}
          title={props.homeTitle ?? "Octo Design"}
        >
          <span style={{ "--icon-base": props.homeIconColor ?? "#0a59f7", display: "inline-flex" }}>
            <Icon name={props.homeIcon ?? "tab-make"} size="normal" />
          </span>
        </button>
      </Show>

      {/* Extra icons slot */}
      <Show when={props.extraIcons}>
        {props.extraIcons?.()}
      </Show>

      {/* Spacer */}
      <div class="flex-1" />

      {/* Skills */}
      <Show when={showSkills()}>
        <button
          type="button"
          class="flex items-center justify-center rounded-lg hover:bg-[rgba(25,25,25,0.06)] transition-colors"
          style={{ width: "36px", height: "36px" }}
          onClick={(e) => {
            if (props.onSkillsClick) {
              e.stopPropagation()
              props.onSkillsClick()
            }
          }}
          title={props.skillsTitle ?? "技能库"}
        >
          <IconSkill size={16} />
        </button>
      </Show>

      {/* Settings */}
      <Show when={showSettings()}>
        <button
          type="button"
          class="flex items-center justify-center rounded-lg hover:bg-[rgba(25,25,25,0.06)] transition-colors"
          style={{ width: "36px", height: "36px" }}
          onClick={(e) => {
            e.stopPropagation()
            props.onSettingsClick?.() ?? dialog.show(() => <DialogSettings />)
          }}
          title={props.settingsTitle ?? "设置"}
        >
          <IconSettings size={16} />
        </button>
      </Show>
    </div>
  )
}
