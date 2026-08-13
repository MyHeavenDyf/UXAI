import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconNotepad } from "@/pages/_shell/icons"
import type { ResultTab } from "./tab-store"
import { IconTabClose } from "../../icons"
import { IconFolder } from "../../icons/design-files-icons"
import { TruncatedText } from "./truncated-text"

export function TabBar(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** 收起任务面板(保留 tab,仅隐藏容器);未传则不渲染收起按钮 */
  onCollapse?: () => void
  /** SPEC-INS-014 §10:tabs/files 页面级切换;未传则不渲染"文件管理"pill(向后兼容旧调用点) */
  viewMode?: "tabs" | "files"
  onViewModeChange?: (mode: "tabs" | "files") => void
}): JSX.Element {
  return (
    <div
      class="flex items-center shrink-0 px-[16px] gap-[8px]"
      style={{
        "border-bottom": "1px solid var(--octo-border-divider)",
        "min-height": "48px",
      }}
    >
      {/* tab 列表横向滚动:tab 多了溢出,octo-result-tabs-scroll 提供细横向滚动条作可视提示;
          收起按钮固定在右侧不随滚动 */}
      <div class="octo-result-tabs-scroll flex items-center gap-[8px] flex-1 min-w-0">
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
            "min-width": "108px",
            "box-sizing": "border-box",
            color: props.viewMode === "files" ? "var(--octo-brand)" : "#666",
            background: props.viewMode === "files" ? "rgba(10, 89, 247, 0.08)" : "rgba(0, 0, 0, 0.05)",
          }}
        >
          <IconFolder
            size={16}
            style={{ color: props.viewMode === "files" ? "var(--octo-brand)" : "#666" }}
          />
          <span>文件管理</span>
        </button>
        <Show when={props.tabs.length > 0}>
          <div class="w-px h-4 shrink-0" style={{ background: "var(--octo-border-divider)", "border-radius": "999px" }} />
        </Show>
      </Show>
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.activeId && props.viewMode !== "files"
          return (
            <div
              class="octo-tab"
              data-active={isActive() ? "true" : undefined}
              onClick={() => {
                props.onActivate(tab.id)
                props.onViewModeChange?.("tabs")
              }}
            >
              <TruncatedText
                class="flex-1 min-w-0"
                textClass="block w-full min-w-0 text-left truncate outline-none"
                text={tab.title}
              />
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

      <Show when={props.onCollapse}>
        <button
          type="button"
          onClick={() => props.onCollapse?.()}
          title="收起面板"
          aria-label="收起面板"
          class="shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-full cursor-pointer transition-colors hover:bg-black/5 active:bg-black/10 outline-none"
          style={{ color: "var(--octo-text-secondary)" }}
        >
          <IconNotepad size={16} />
        </button>
      </Show>
    </div>
  )
}
