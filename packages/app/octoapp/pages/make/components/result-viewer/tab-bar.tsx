import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ResultTab } from "./tab-store"
import { IconTabClose, IconCardPlan } from "../../icons"
import { IconFolder } from "../../icons/design-files-icons"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  viewMode?: "tabs" | "files" | "plan"
  onViewModeChange?: (mode: "tabs" | "files" | "plan") => void
  /** 设计规划入口 — plan artifact 存在时显示,点击切换到 plan 模式 */
  showPlanEntry?: boolean
  planConfirmed?: boolean
  planEnded?: boolean
}): JSX.Element {
  return (
    <div
      class="flex items-center shrink-0 gap-2 px-6 py-3"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        height: "56px",
        background: "var(--octo-surface-page)",
      }}
    >
      <Show when={props.onViewModeChange}>
        <button
          type="button"
          onClick={() => props.onViewModeChange?.("files")}
          class="flex items-center justify-center transition-colors font-medium shrink-0"
          style={{
            padding: "0px 16px",
            "border-radius": "999px",
            "font-size": "14px",
            "line-height": "22px",
            gap: "4px",
            height: "32px",
            width: "108px",
            "box-sizing": "border-box",
            "flex": "0 0 108px",
            color: props.viewMode === "files" ? "#0a59f7" : "#666",
            background: props.viewMode === "files" ? "rgba(10, 89, 247, 0.08)" : "rgba(0, 0, 0, 0.05)",
          }}
        >
          <IconFolder
            size={16}
            style={{ color: props.viewMode === "files" ? "#0a59f7" : "#666" }}
          />
          <span>文件管理</span>
        </button>

        {/* 设计规划入口 — plan artifact 存在时出现,点击切换到 plan 模式 */}
        <Show when={(props.showPlanEntry || props.planEnded || props.viewMode === "plan") && props.onViewModeChange}>
          <div
            class="shrink-0"
            style={{
              width: "1px",
              height: "16px",
              background: "rgba(0,0,0,0.1)",
              "margin-left": "8px",
              "margin-right": "8px",
            }}
          />
          <button
            type="button"
            onClick={() => props.onViewModeChange?.("plan")}
            class="flex items-center transition-colors font-medium"
            style={{
              padding: "0px 16px",
              "border-radius": "999px",
              "font-size": "14px",
              "line-height": "22px",
              gap: "4px",
              height: "32px",
              color: props.viewMode === "plan" ? "#0a59f7" : props.planConfirmed || props.planEnded ? "#999" : "#666",
              background: props.viewMode === "plan" ? "rgba(10, 89, 247, 0.08)" : "rgba(0, 0, 0, 0.05)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
              <path d="M9.33376 1.34338C9.36376 1.34338 9.39043 1.34672 9.42043 1.35005C9.4371 1.35338 9.47376 1.36338 9.4871 1.37005C9.4971 1.37338 9.5671 1.40338 9.5771 1.40672C9.5971 1.42338 9.67376 1.47672 9.69043 1.49672L13.1604 4.98005C13.3038 5.12338 13.3471 5.33672 13.2671 5.52338C13.1904 5.71005 13.0071 5.83338 12.8071 5.83338L10.3338 5.83338C9.50376 5.83338 8.83376 5.16005 8.83376 4.33338L8.83043 2.34338L4.69043 2.34338C4.14043 2.34338 3.69043 2.79338 3.69043 3.34338L3.69043 12.6534C3.69043 13.2034 4.14043 13.6534 4.69043 13.6534L11.3071 13.6534C11.8571 13.6534 12.3071 13.2034 12.3071 12.6534L12.3071 6.99672C12.3071 6.72005 12.5304 6.49672 12.8071 6.49672C13.0838 6.49672 13.3071 6.72005 13.3071 6.99672L13.3071 12.6534C13.3071 13.7567 12.4104 14.6534 11.3071 14.6534L4.69043 14.6534C3.5871 14.6534 2.69043 13.7567 2.69043 12.6534L2.69043 3.34338C2.69043 2.24005 3.5871 1.34338 4.69043 1.34338L9.33376 1.34338ZM9.83376 3.05338L9.83376 4.33338C9.83376 4.60672 10.0571 4.83338 10.3338 4.83338L11.6038 4.83338L9.83376 3.05338Z" fill="currentColor" fill-rule="evenodd" />
            </svg>
            <span>{props.planConfirmed ? "方案已确认" : props.planEnded ? "方案已结束" : "设计规划"}</span>
          </button>
        </Show>

        <Show when={props.tabs.length > 0}>
          <div class="w-px h-4 shrink-0 ml-2 mr-2" style={{ background: "var(--octo-border-divider)", "border-radius": "999px" }} />
        </Show>
      </Show>

      <div
        class="octo-tab-scroller flex items-center gap-2 flex-1 min-w-0 overflow-x-auto"
      >
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === props.activeId && props.viewMode === "tabs"
            return (
              <div
                class="octo-tab"
                data-active={isActive() ? "true" : undefined}
                onClick={() => {
                  props.onActivate(tab.id)
                  props.onViewModeChange?.("tabs")
                }}
              >
                <span class="truncate min-w-0 text-left outline-none">{tab.title}</span>
                <button
                  type="button"
                  class="octo-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onClose(tab.id)
                  }}
                >
                  <IconTabClose size={16} />
                </button>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
