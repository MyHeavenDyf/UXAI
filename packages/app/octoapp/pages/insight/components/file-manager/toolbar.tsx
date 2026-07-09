// SPEC-INS-014 §10.1:文件管理面板顶部工具栏。结构参照 Design 模块
// (make/components/design-files/design-files-toolbar.tsx),但 insight 自包含——图标用 insight 自己的
// icons/ + @opencode-ai/ui/icon,不导入 make 的 design-files-icons.tsx。
// 布局:刷新 | [类型 ⇄ 修改时间] 分组切换 | 按类型筛选 popover ……… 上传

import { createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { IconRefresh } from "../../icons"
import { kindLabel, type InsightFileKind } from "../../utils/insight-file-api"
import type { createInsightFileStore } from "../../utils/insight-file-store"

interface ToolbarProps {
  fileStore: ReturnType<typeof createInsightFileStore>
  onRefresh: () => void
  onUpload: () => void
}

export function FileManagerToolbar(props: ToolbarProps): JSX.Element {
  const [filterOpen, setFilterOpen] = createSignal(false)
  const store = () => props.fileStore.store

  const filterButtonText = () => {
    const size = store().kindFilter.size
    if (size === 0) return "按类型筛选"
    if (size === 1) return kindLabel(Array.from(store().kindFilter)[0])
    return `已选 ${size} 类`
  }

  return (
    <div
      class="flex items-center justify-between px-4 py-2 shrink-0"
      style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          onClick={() => props.onRefresh()}
          disabled={store().loading}
          class="p-1.5 rounded-md transition-colors hover:bg-[var(--octo-surface-hover)]"
          style={{ color: "var(--octo-text-secondary)" }}
          title="刷新"
        >
          <Show when={store().loading} fallback={<IconRefresh size={16} />}>
            <Spinner class="size-[16px]" />
          </Show>
        </button>

        <div class="shrink-0 mx-2" style={{ width: "1px", height: "12px", background: "var(--octo-border-divider)" }} />

        {/* 分组模式切换:类型 ⇄ 修改时间 */}
        <div
          class="flex items-center p-[2px] rounded-full"
          role="group"
          style={{ background: "var(--octo-surface-selected)" }}
        >
          <GroupModeButton
            active={store().groupMode === "kind"}
            label="类型"
            onClick={() => props.fileStore.setGroupMode("kind")}
          />
          <GroupModeButton
            active={store().groupMode === "modified"}
            label="修改时间"
            onClick={() => props.fileStore.setGroupMode("modified")}
          />
        </div>

        <div class="shrink-0 mx-2" style={{ width: "1px", height: "12px", background: "var(--octo-border-divider)" }} />

        <Kobalte open={filterOpen()} onOpenChange={setFilterOpen} modal={false} placement="bottom-start" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            class="flex items-center gap-1 px-2 py-1 rounded-md text-[13px] transition-colors hover:bg-[var(--octo-surface-hover)]"
            style={{ color: store().kindFilter.size > 0 ? "var(--octo-brand)" : "var(--octo-text-secondary)" }}
          >
            <Icon name="sliders" class="size-4" />
            <span>{filterButtonText()}</span>
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 rounded-lg p-2 min-w-[190px]"
              style={{ background: "var(--octo-surface-raised, #fff)", "box-shadow": "0 4px 16px rgba(0,0,0,0.14)", border: "1px solid var(--octo-border-divider)" }}
            >
              <div class="flex items-center justify-between px-2 pb-1 mb-1" style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}>
                <span class="text-xs" style={{ color: "var(--octo-text-tertiary)" }}>按类型筛选</span>
                <Show when={store().kindFilter.size > 0}>
                  <button
                    type="button"
                    onClick={() => props.fileStore.clearKindFilter()}
                    class="text-xs hover:underline"
                    style={{ color: "var(--octo-brand)" }}
                  >
                    清除
                  </button>
                </Show>
              </div>
              <Show
                when={props.fileStore.availableKinds().length > 0}
                fallback={<div class="px-2 py-2 text-xs" style={{ color: "var(--octo-text-tertiary)" }}>暂无可筛选类型</div>}
              >
                <ul class="flex flex-col gap-0.5">
                  <For each={props.fileStore.availableKinds()}>
                    {(kind) => (
                      <li>
                        <label
                          class="flex items-center gap-2 px-2 h-8 rounded-md cursor-pointer text-[13px] hover:bg-[var(--octo-surface-hover)]"
                          style={{ color: "var(--octo-text-primary)" }}
                        >
                          <input
                            type="checkbox"
                            checked={store().kindFilter.has(kind as InsightFileKind)}
                            onChange={() => props.fileStore.toggleKindFilter(kind as InsightFileKind)}
                            style={{ width: "15px", height: "15px", "accent-color": "var(--octo-brand)", cursor: "pointer" }}
                          />
                          <span>{kindLabel(kind as InsightFileKind)}</span>
                          <span class="ml-auto text-xs" style={{ color: "var(--octo-text-tertiary)" }}>
                            {props.fileStore.kindCounts().get(kind as InsightFileKind) ?? 0}
                          </span>
                        </label>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </div>

      <button
        type="button"
        onClick={() => props.onUpload()}
        class="flex items-center gap-1 px-2.5 py-1 rounded-md text-[13px] transition-colors hover:bg-[var(--octo-surface-hover)]"
        style={{ color: "var(--octo-text-secondary)" }}
        title="上传文件到当前会话"
      >
        <Icon name="upload" class="size-4" />
        <span>上传</span>
      </button>
    </div>
  )
}

function GroupModeButton(props: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="px-3 h-7 rounded-full text-[13px] transition-colors"
      style={{
        color: props.active ? "var(--octo-brand)" : "var(--octo-text-secondary)",
        background: props.active ? "var(--octo-surface-raised, #fff)" : "transparent",
        "box-shadow": props.active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
        "font-weight": props.active ? "500" : "400",
      }}
    >
      {props.label}
    </button>
  )
}
