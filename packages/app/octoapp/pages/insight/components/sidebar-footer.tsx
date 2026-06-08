import { createSignal, For, Show, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { DialogSettings } from "@/components/dialog-settings"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings,
} from "@/pages/_shell/icons"

/**
 * SidebarFooter —— insight 侧栏底部「技能库 / 资产库 / 设置」公共栏目。
 *
 * 注入到 InsightSidebar 的 bottom 槽(SPEC-INS-010 §11:D7 由宿主注入)。
 * 与 _shell/sidebar.tsx、make/sidebar.tsx 的底部块同一套交互/视觉:
 *   - 技能库 → 切 sidebarSource=cowork 并 navigate("/skills")
 *   - 资产库 → 本地 activeNav 高亮(目标页未接,先沿用上游占位行为)
 *   - 设置   → 弹 DialogSettings
 */
const NAV_ITEMS = [
  { key: "skill_market", label: "技能库", Icon: IconSkill, IconActive: IconSkill1 },
  { key: "knowledge_base", label: "资产库", Icon: IconAsset, IconActive: IconAsset1 },
] as const

export function SidebarFooter(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const layout = useLayout()

  const [activeNav, setActiveNav] = createSignal<string | null>(null)

  return (
    <>
      {/* 技能库 / 资产库 */}
      <div class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[12px]">
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () =>
              item.key === "skill_market"
                ? location.pathname === "/skills"
                : activeNav() === item.key
            return (
              <button
                type="button"
                onClick={() => {
                  if (item.key === "skill_market") {
                    layout.sidebarSource.set("cowork")
                    navigate("/skills")
                  } else {
                    setActiveNav((v) => (v === item.key ? null : item.key))
                  }
                }}
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
            )
          }}
        </For>
      </div>

      {/* 设置 */}
      <div class="shrink-0 px-[12px] pb-[24px]">
        <button
          type="button"
          title="设置"
          class="w-full flex items-center gap-[12px] px-[12px] rounded-[4px] transition-colors"
          style={{ height: "36px", color: "var(--text-strong)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-base-hover)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          onClick={() => dialog.show(() => <DialogSettings />)}
        >
          <IconSettings size={16} />
          <span class="text-[14px] leading-[22px]">设置</span>
        </button>
      </div>
    </>
  )
}
