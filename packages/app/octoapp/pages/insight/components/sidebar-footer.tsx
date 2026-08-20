import { createSignal, For, Show, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { DialogSettings } from "@/components/dialog-settings"
import {
  IconSkill, IconSkill1,
  IconAsset, IconAsset1,
  IconSettings,
} from "@/pages/insight/icons"
import { IconSettings1 } from "@/pages/_shell/icons"

/**
 * SidebarFooter —— insight 侧栏底部「技能库 / 资产库 / 设置」公共栏目。
 *
 * 注入到 InsightSidebar 的 bottom 槽(SPEC-INS-010 §11:D7 由宿主注入)。
 * 与 _shell/sidebar.tsx、make/sidebar.tsx 的底部块同一套交互/视觉:
 *   - 技能库 → 切 sidebarSource=cowork 并 navigate("/skills")
 *   - 资产库 → 切 sidebarSource=cowork 并 navigate("/assets")
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

  const [settingsActive, setSettingsActive] = createSignal(false)

  return (
    <>
      {/* 技能库 / 资产库 */}
      <div class="shrink-0 flex flex-col gap-[2px] px-[12px] pt-[12px]">
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () =>
              item.key === "skill_market"
                ? location.pathname === "/skills"
                : location.pathname === "/assets"
            return (
              <button
                type="button"
                onClick={() => {
                  layout.sidebarSource.set("cowork")
                  navigate(item.key === "skill_market" ? "/skills" : "/assets")
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
            setSettingsActive(true)
            dialog.show(() => <DialogSettings />, () => setSettingsActive(false))
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
      </div>
    </>
  )
}
