import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Root as TabsRoot, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@kobalte/core/tabs"
import { useLanguage } from "@/context/language"
import { SettingsGeneral } from "./settings-general"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
// jk-j60099994-replace-with-dialog-settings-1-start
// jk-j60099994-replace-with-dialog-settings-1-end


const sectionTitle: Record<string, string> = {
  "font-size": "14px",
  "font-weight": "bold",
  "line-height": "22px",
  padding: "12px 16px",
  color: "rgba(0, 0, 0, 0.9)",
}

const triggerStyle: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "12px",
  width: "100%",
  padding: "12px 16px",
  "font-size": "14px",
  "line-height": "22px",
  cursor: "pointer",
  border: "none",
  background: "none",
  color: "rgba(0, 0, 0, 0.9)",
  "border-radius": "8px",
  "box-sizing": "border-box",
  outline: "none",
  position: "relative",
}

const iconBase: Record<string, string> = {
  width: "20px",
  height: "20px",
  "flex-shrink": "0",
  "background-color": "currentColor",
  "mask-size": "20px 20px",
  "mask-repeat": "no-repeat",
  "mask-position": "center",
  "-webkit-mask-size": "20px 20px",
  "-webkit-mask-repeat": "no-repeat",
  "-webkit-mask-position": "center",
}

export const DialogSettings: Component = () => {
  const language = useLanguage()

  return (
    <Dialog size="x-large" transition class="settings-dialog">
      <div data-settings-dialog style={{ display: "contents" }}>
        <style>{`
          
          .settings-dialog {
            border-radius: 20px !important;
            box-shadow: 0 16px 48px 0 rgba(0, 0, 0, 0.16) !important;
            background: #fff !important;
          }
          [data-settings-dialog] button[aria-selected="true"] {
            background-color: rgba(10, 89, 247, 0.08) !important;
            color: #0a59f7 !important;
            border-radius: 8px !important;
          }
          [data-settings-dialog] button[aria-selected="true"]::after {
            content: "";
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            width: 4px;
            height: 32px;
            border-radius: 999px;
            background: #0a59f7;
          }
          [data-settings-dialog] [data-slot="switch-control"] {
            width: 38px !important;
            height: 20px !important;
            border-radius: 999px !important;
            background: #c2c2c2 !important;
            border: none !important;
          }
          [data-settings-dialog] [data-slot="switch-thumb"] {
            width: 16px !important;
            height: 16px !important;
            border-radius: 999px !important;
            background: #fff !important;
            box-shadow: 0 0 4px 0 rgba(0, 0, 0, 0.4) !important;
            border: none !important;
            transform: translateX(2px) !important;
          }
          [data-settings-dialog] [data-checked] [data-slot="switch-control"] {
            background: #0a59f7 !important;
            border: none !important;
          }
          [data-settings-dialog] [data-checked] [data-slot="switch-thumb"] {
            transform: translateX(20px) !important;
            border: none !important;
          }
        `}</style>
        <TabsRoot orientation="vertical" defaultValue="general" class="h-full" style={{ display: "flex" }}>
          <TabsList
            style={{
              width: "240px",
              background: "#fff",
              padding: "8px 16px 24px",
              display: "flex",
              "flex-direction": "column",
              "justify-content": "space-between",
              "flex-shrink": 0,
              "border-right": "1px solid rgba(0, 0, 0, 0.1)",
              gap: "0",
              "overflow-y": "auto",
              outline: "none",
            }}
          >
            <div>
              <div style={sectionTitle}>{language.t("settings.section.desktop")}</div>
              <TabsTrigger value="general" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/generalIcon.svg)",
                    "-webkit-mask-image": "url(/setting/generalIcon.svg)",
                  }}
                />
                {language.t("settings.tab.general")}
              </TabsTrigger>

              <div style={sectionTitle}>{language.t("settings.section.server")}</div>
              <TabsTrigger value="providers" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/providerIcon.svg)",
                    "-webkit-mask-image": "url(/setting/providerIcon.svg)",
                  }}
                />
                {language.t("settings.providers.title")}
              </TabsTrigger>
              <TabsTrigger value="models" style={triggerStyle}>
                <div
                  style={{
                    ...iconBase,
                    "mask-image": "url(/setting/modeIcon.svg)",
                    "-webkit-mask-image": "url(/setting/modeIcon.svg)",
                  }}
                />
                {language.t("settings.models.title")}
              </TabsTrigger>
            </div>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                gap: "12px",
                padding: "0",
                "margin-top": "24px"
              }}
            >
              <img src="/setting/OctoAgentLogo.png" width={114} height={28} alt="" />
              {/* jk-j60099994-replace-with-dialog-settings-2-start */}
              <span style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0, 0, 0, 0.6)" }}>v1.14.41</span>
              {/* jk-j60099994-replace-with-dialog-settings-2-end */}
            </div>
          </TabsList>
          <TabsContent value="general" style={{ flex: 1, overflow: "auto", padding: "8px 20px" }}>
            <SettingsGeneral />
          </TabsContent>
          <TabsContent value="providers" style={{ flex: 1, overflow: "auto", padding: "8px 20px" }}>
            <SettingsProviders />
          </TabsContent>
          <TabsContent value="models" style={{ flex: 1, overflow: "auto", padding: "8px 20px" }}>
            <SettingsModels />
          </TabsContent>
        </TabsRoot>
      </div>
    </Dialog>
  )
}
