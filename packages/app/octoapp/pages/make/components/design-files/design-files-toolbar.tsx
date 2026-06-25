import { createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { IconRefresh } from "../../icons"
import type { ArtifactFileStore } from "../../utils/artifact-file-store"
import type { ArtifactFileKind } from "../../utils/artifact-file-api"
import { useLanguage } from "@/context/language"

const kindToI18nKey = (kind: ArtifactFileKind): string => {
  const capitalized = kind.charAt(0).toUpperCase() + kind.slice(1)
  return `designFiles.kind${capitalized}`
}

interface ToolbarProps {
  fileStore: ReturnType<typeof import("../../utils/artifact-file-store").createArtifactFileStore>
  filterMenuRef: HTMLDivElement | undefined
  filterMenuOpen: boolean
  showAddMenu: boolean
  onRefresh: () => void
  onToggleFilterMenu: () => void
  onToggleAddMenu: () => void
  onUploadFile: () => void
  onUploadFolder: () => void
  onBatchDownload: () => void
  onBatchDelete: () => void
  fileInputRef: HTMLInputElement
  folderInputRef: HTMLInputElement
}

export function DesignFilesToolbar(props: ToolbarProps): JSX.Element {
  const language = useLanguage()

  const hasSelection = createMemo(() => props.fileStore.store.selected.size > 0)

  const filterButtonText = createMemo(() => {
    const filterSize = props.fileStore.store.kindFilter.size
    if (filterSize === 0) return language.t("designFiles.filter")
    if (filterSize === 1) {
      const kind = Array.from(props.fileStore.store.kindFilter)[0]
      return language.t(kindToI18nKey(kind))
    }
    return language.t("designFiles.filterCount", { n: filterSize })
  })

  return (
    <div
      class="flex items-center justify-between px-4 py-2 shrink-0"
      style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.fileStore.store.loading}
          class="p-1.5 rounded-md hover:bg-surface-base-hover transition-colors"
          title="Refresh"
        >
          <Show when={props.fileStore.store.loading} fallback={<IconRefresh size={14} />}>
            <Spinner class="size-[14px]" />
          </Show>
        </button>

        <div class="flex items-center gap-1 text-[12px]" role="group">
          <span style={{ color: "var(--octo-text-secondary)" }}>{language.t("designFiles.group")}</span>
          <button
            type="button"
            onClick={() => props.fileStore.setGroupMode("kind")}
            classList={{
              "px-2 py-1 rounded transition-colors text-[12px]": true,
              "bg-surface-base-interactive-active text-text-interactive-base": props.fileStore.store.groupMode === "kind",
              "hover:bg-surface-base-hover": props.fileStore.store.groupMode !== "kind",
            }}
          >
            {language.t("designFiles.groupKind")}
          </button>
          <button
            type="button"
            onClick={() => props.fileStore.setGroupMode("modified")}
            classList={{
              "px-2 py-1 rounded transition-colors text-[12px]": true,
              "bg-surface-base-interactive-active text-text-interactive-base": props.fileStore.store.groupMode === "modified",
              "hover:bg-surface-base-hover": props.fileStore.store.groupMode !== "modified",
            }}
          >
            {language.t("designFiles.groupModified")}
          </button>
        </div>

        <div class="relative" ref={props.filterMenuRef}>
          <button
            type="button"
            onClick={props.onToggleFilterMenu}
            classList={{
              "flex items-center gap-1 px-2 py-1 rounded transition-colors text-[12px]": true,
              "bg-surface-base-interactive-active text-text-interactive-base": props.fileStore.store.kindFilter.size > 0,
              "hover:bg-surface-base-hover": props.fileStore.store.kindFilter.size === 0,
            }}
          >
            <span>{filterButtonText()}</span>
          </button>

          <Show when={props.filterMenuOpen}>
              <div
                class="absolute left-0 top-full z-50 bg-surface-raised-base rounded-md shadow-lg py-1 min-w-[180px]"
                style={{ border: "1px solid var(--octo-border-divider)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div class="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}>
                  <span class="text-[12px] font-medium">{language.t("designFiles.filter")}</span>
                  <Show when={props.fileStore.store.kindFilter.size > 0}>
                    <button
                      type="button"
                      onClick={() => props.fileStore.clearKindFilter()}
                      class="text-[12px] text-text-interactive-base hover:underline"
                    >
                      {language.t("designFiles.filterClear")}
                    </button>
                  </Show>
                </div>
                <ul class="py-1">
                  <For each={props.fileStore.availableKinds()}>
                    {(kind) => (
                      <li>
                        <label class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-surface-base-hover transition-colors">
                          <input
                            type="checkbox"
                            checked={props.fileStore.store.kindFilter.has(kind)}
                            onChange={() => props.fileStore.toggleKindFilter(kind)}
                            class="cursor-pointer"
                          />
                          <span class="text-[12px]">{language.t(kindToI18nKey(kind))}</span>
                          <span class="text-[12px] ml-auto" style={{ color: "var(--octo-text-secondary)" }}>
                            {props.fileStore.kindCounts().get(kind) ?? 0}
                          </span>
                        </label>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          </div>
        </div>

      <div class="flex items-center gap-2">
        <Show when={hasSelection()}>
          <button
            type="button"
            onClick={props.onBatchDownload}
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px]"
          >
            <Icon name="chevron-down" size="small" />
            <span>{language.t("designFiles.download")} ({props.fileStore.store.selected.size})</span>
          </button>
          <button
            type="button"
            onClick={props.onBatchDelete}
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px] text-text-diff-delete-base"
          >
            <span>{language.t("designFiles.batchDelete")} ({props.fileStore.store.selected.size})</span>
          </button>
        </Show>

        <div class="relative">
          <button
            type="button"
            onClick={props.onToggleAddMenu}
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px]"
            title={language.t("designFiles.upload")}
          >
            <Icon name="upload" size="small" />
            <span>{language.t("designFiles.upload")}</span>
            <Icon name="chevron-down" size="small" />
          </button>

          <Show when={props.showAddMenu}>
            <div
              class="absolute right-0 top-full z-50 bg-surface-raised-base rounded-md shadow-lg py-1"
              style={{ border: "1px solid var(--octo-border-divider)", width: "140px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={props.onUploadFile}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors flex items-center gap-2"
              >
                <Icon name="file-tree" size="small" />
                <span>{language.t("designFiles.uploadFile")}</span>
              </button>
              <button
                type="button"
                onClick={props.onUploadFolder}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors flex items-center gap-2"
              >
                <Icon name="folder" size="small" />
                <span>{language.t("designFiles.uploadFolder")}</span>
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}