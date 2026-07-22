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
        <Show when={props.showPlanEntry && props.onViewModeChange}>
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
              color: props.viewMode === "plan" ? "#0a59f7" : props.planConfirmed ? "#999" : "#666",
              background: props.viewMode === "plan" ? "rgba(10, 89, 247, 0.08)" : "rgba(0, 0, 0, 0.05)",
            }}
          >
            <IconCardPlan
              size={16}
              style={{ color: props.viewMode === "plan" ? "#0a59f7" : props.planConfirmed ? "#999" : "#666" }}
            />
            <span>{props.planConfirmed ? "方案已确认" : "设计规划"}</span>
          </button>
        </Show>

        <Show when={props.tabs.length > 0}>
          <div class="w-px h-4 shrink-0" style={{ background: "var(--octo-border-divider)" }} />
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
