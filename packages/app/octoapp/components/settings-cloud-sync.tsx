import { Component } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { useSettings } from "@/context/settings"
import { tracker } from "@/utils/tracker"
import { SettingsList } from "./settings-list"

/**
 * 设置 → 云同步&推送。
 *
 */
export const SettingsCloudSync: Component = () => {
  const settings = useSettings()

  const onToggle = (checked: boolean) => {
    settings.general.setCloudSyncPush(checked)
    tracker.interaction({ module: "design", name: "toggle-auto-archive", extend: JSON.stringify({ enabled: checked }) })
  }

  return (
    <div data-settings-cloud-sync class="flex flex-col" style={{ gap: "12px", "padding-top": "4px" }}>
      {/* 右侧标题：纯文字（无图标），模式同 settings-models 标题行 */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "12px 0" }}>
        <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "font-weight": "bold" }}>
          云同步&Welink推送
        </span>
      </div>
      <SettingsList>
        <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "12px 16px", background: "rgba(0, 0, 0, 0.03)", "border-radius": "8px" }}>
          <div style={{ display: "flex", "min-width": 0, flex: 1, "flex-direction": "column", gap: "4px" }}>
            <span style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}>
              生成原型云端同步并在WeLink内原型推送
            </span>
            <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)" }}>
              开启后将为您把生成后的设计原型自动同步云端，并为您通过应用号推送云端链接，可在WeLink应用号内查看
            </span>
          </div>
          <div style={{ display: "flex", "align-items": "center", "flex-shrink": 0 }}>
            <div data-action="settings-cloud-sync-push">
              <Switch checked={settings.general.cloudSyncPush()} onChange={onToggle} />
            </div>
          </div>
        </div>
      </SettingsList>
    </div>
  )
}
