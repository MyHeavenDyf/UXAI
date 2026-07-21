// SPEC-INS-014 §10.1:文件管理面板顶部工具栏。结构对齐 Design 模块
// (make/components/design-files/design-files-toolbar.tsx)。图标用 design-files-icons(拷贝自 make,自包含)。
// 布局:刷新 | [类型 ⇄ 修改时间] | 按类型筛选 ……… [选中时:下载(N) / 删除(N)] | 上传(文件夹/文件)
// 颜色/圆角统一走 --octo-* 主题变量。

import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import { IconRefresh, IconFilter, IconUpload, IconDownload, IconFolder, IconFile } from "../../icons/design-files-icons"
import { kindLabel, type InsightFileKind } from "../../utils/insight-file-api"
import type { createInsightFileStore } from "../../utils/insight-file-store"

interface ToolbarProps {
  fileStore: ReturnType<typeof createInsightFileStore>
  onRefresh: () => void
  onUploadFile: () => void
  onUploadFolder: () => void
  onBatchDownload: () => void
  onBatchDelete: () => void
}

export function FileManagerToolbar(props: ToolbarProps): JSX.Element {
  const [filterOpen, setFilterOpen] = createSignal(false)
  const [uploadOpen, setUploadOpen] = createSignal(false)
  const store = () => props.fileStore.store
  const hasSelection = createMemo(() => store().selected.size > 0)
  const deletableCount = createMemo(() => store().selected.size)

  const filterButtonText = createMemo(() => {
    const size = store().kindFilter.size
    if (size === 0) return "按类型筛选"
    if (size === 1) return kindLabel(Array.from(store().kindFilter)[0])
    return `已选 ${size} 类`
  })

  return (
    <div
      class="flex items-center justify-between px-4 py-2 shrink-0"
      style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={() => props.onRefresh()}
          disabled={store().loading}
          class="p-1.5 rounded-md hover:bg-[var(--octo-surface-hover)] transition-colors"
          title="刷新"
        >
          <Show when={store().loading} fallback={<IconRefresh size={16} />}>
            <Spinner class="size-[16px]" />
          </Show>
        </button>

        <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "var(--octo-border-input)", margin: "0 8px" }} />

        {/* 分组模式切换:类型 ⇄ 修改时间 */}
        <div
          class="flex items-center"
          role="group"
          style={{
            height: "32px",
            padding: "2px",
            "border-radius": "999px",
            background: "var(--octo-surface-hover)",
            "font-size": "14px",
            "line-height": "22px",
            color: "var(--octo-text-secondary)",
            gap: "4px",
          }}
        >
          <GroupModeButton active={store().groupMode === "kind"} label="类型" onClick={() => props.fileStore.setGroupMode("kind")} />
          <GroupModeButton active={store().groupMode === "modified"} label="修改时间" onClick={() => props.fileStore.setGroupMode("modified")} />
        </div>

        <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "var(--octo-border-input)", margin: "0 8px" }} />

        <Kobalte open={filterOpen()} onOpenChange={setFilterOpen} modal={false} placement="bottom-start" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{ "font-size": "14px", "line-height": "22px", cursor: "pointer" }}
          >
            <IconFilter size={16} />
            <span>{filterButtonText()}</span>
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 rounded-md p-2 min-w-[180px]"
              style={{ "box-shadow": "0 4px 12px rgba(0,0,0,0.16)", "background-color": "var(--octo-surface-page)" }}
            >
              <div class="flex items-center justify-between px-3 shrink-0" style={{ "border-bottom": "1px solid var(--octo-border-divider)", height: "28px" }}>
                <span style={{ "font-size": "12px", "line-height": "20px", color: "var(--octo-text-secondary)" }}>按类型筛选</span>
                <Show when={store().kindFilter.size > 0}>
                  <button
                    type="button"
                    onClick={() => props.fileStore.clearKindFilter()}
                    class="hover:underline"
                    style={{ "font-size": "12px", "line-height": "20px", cursor: "pointer", color: "var(--octo-brand)" }}
                  >
                    清除
                  </button>
                </Show>
              </div>
              <Show
                when={props.fileStore.availableKinds().length > 0}
                fallback={<div class="px-3 py-2" style={{ "font-size": "12px", "line-height": "20px", color: "var(--octo-text-secondary)" }}>暂无可筛选类型</div>}
              >
                <ul class="flex flex-col gap-1 pt-1">
                  <For each={props.fileStore.availableKinds()}>
                    {(kind) => (
                      <li>
                        <label
                          class="flex items-center gap-2 px-3 cursor-pointer hover:bg-[var(--octo-surface-hover)] transition-colors"
                          style={{ height: "36px", "border-radius": "var(--octo-radius-md)", "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)" }}
                        >
                          <input
                            type="checkbox"
                            checked={store().kindFilter.has(kind as InsightFileKind)}
                            onChange={() => props.fileStore.toggleKindFilter(kind as InsightFileKind)}
                            style={{ width: "16px", height: "16px", "border-radius": "2px", border: "1px solid var(--octo-border-input)", cursor: "pointer", "accent-color": "var(--octo-brand)" }}
                          />
                          <span>{kindLabel(kind as InsightFileKind)}</span>
                          <span class="ml-auto" style={{ color: "var(--octo-text-secondary)" }}>
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

      <div class="flex items-center gap-2">
        {/* 多选后:批量下载 / 批量删除 */}
        <Show when={hasSelection()}>
          <button
            type="button"
            onClick={props.onBatchDownload}
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer"
            style={{ "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)" }}
          >
            <IconDownload size={16} />
            <span>下载 ({store().selected.size})</span>
          </button>
          {/* 批量删除作用于全部选中文件(上传+生成);无可删项则不显示 */}
          <Show when={deletableCount() > 0}>
            <button
              type="button"
              onClick={props.onBatchDelete}
              class="flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer"
              style={{ "font-size": "14px", "line-height": "22px", color: "var(--octo-danger, #dc2626)" }}
            >
              <span>删除 ({deletableCount()})</span>
            </button>
          </Show>
        </Show>

        {/* 上传:popover 分"上传文件夹 / 上传文件"(对齐 Design) */}
        <Kobalte open={uploadOpen()} onOpenChange={setUploadOpen} modal={false} placement="bottom-end" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{ height: "32px", "font-size": "14px", "line-height": "22px", cursor: "pointer", color: uploadOpen() ? "var(--octo-brand)" : "var(--octo-text-primary)" }}
            title="上传"
          >
            <IconUpload size={16} />
            <span>上传</span>
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 flex flex-col gap-1 rounded-md p-2"
              style={{ "box-shadow": "0 4px 12px rgba(0,0,0,0.16)", "min-width": "122px", "background-color": "var(--octo-surface-page)" }}
            >
              <button
                type="button"
                onClick={() => { props.onUploadFolder(); setUploadOpen(false) }}
                class="w-full px-2 text-left transition-colors flex items-center gap-1 hover:bg-[var(--octo-surface-hover)]"
                style={{ height: "36px", "border-radius": "var(--octo-radius-md)", "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)" }}
              >
                <IconFolder size={16} />
                <span>上传文件夹</span>
              </button>
              <button
                type="button"
                onClick={() => { props.onUploadFile(); setUploadOpen(false) }}
                class="w-full px-2 text-left transition-colors flex items-center gap-1 hover:bg-[var(--octo-surface-hover)]"
                style={{ height: "36px", "border-radius": "var(--octo-radius-md)", "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)" }}
              >
                <IconFile size={16} />
                <span>上传文件</span>
              </button>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </div>
    </div>
  )
}

function GroupModeButton(props: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="transition-colors"
      style={{
        "min-width": "88px",
        height: "28px",
        padding: "0 16px",
        "border-radius": "999px",
        "font-size": "14px",
        "line-height": "22px",
        cursor: "pointer",
        color: props.active ? "var(--octo-brand)" : "var(--octo-text-secondary)",
        background: props.active ? "var(--octo-surface-page)" : "transparent",
        "box-shadow": props.active ? "0 1px 6px 0 rgba(0,0,0,0.08)" : "none",
      }}
    >
      {props.label}
    </button>
  )
}
