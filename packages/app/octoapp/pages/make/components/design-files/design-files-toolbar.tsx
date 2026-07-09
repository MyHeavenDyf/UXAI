import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import type { ArtifactFileKind } from "../../utils/artifact-file-api"
import { useLanguage } from "@/context/language"
import { tracker } from "@/utils/tracker"
import { IconUpload, IconRefresh, IconFilter, IconDownload, IconFolder, IconFile } from "../../icons/design-files-icons"

const kindToI18nKey = (kind: ArtifactFileKind): string => {
  const capitalized = kind.charAt(0).toUpperCase() + kind.slice(1)
  return `designFiles.kind${capitalized}`
}

interface ToolbarProps {
  fileStore: ReturnType<typeof import("../../utils/artifact-file-store").createArtifactFileStore>
  onRefresh: () => void
  onUploadFile: () => void
  onUploadFolder: () => void
  onBatchDownload: () => void
  onBatchDelete: () => void
}

export function DesignFilesToolbar(props: ToolbarProps): JSX.Element {
  const language = useLanguage()
  const [uploadOpen, setUploadOpen] = createSignal(false)
  const [filterOpen, setFilterOpen] = createSignal(false)

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

  const availableKinds = createMemo(() => {
    const counts = new Map<ArtifactFileKind, number>()
    for (const file of props.fileStore.store.generatedFiles) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    for (const file of props.fileStore.store.uploadedFiles) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    return Array.from(counts.keys()).sort((a, b) => {
      const priority: Record<string, number> = {
        folder: -1, html: 0, svg: 1, markdown: 2, image: 3, code: 4, text: 5, pdf: 6, video: 7, audio: 8, document: 9, binary: 10,
      }
      return (priority[a] ?? 10) - (priority[b] ?? 10)
    })
  })

  const kindCounts = createMemo(() => {
    const counts = new Map<ArtifactFileKind, number>()
    for (const file of props.fileStore.store.generatedFiles) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    for (const file of props.fileStore.store.uploadedFiles) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    return counts
  })

  return (
    <div
      class="flex items-center justify-between px-4 py-2 shrink-0"
      style={{ "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            props.onRefresh()
            tracker.interaction({ module: "design", name: "files-refresh" })
          }}
          disabled={props.fileStore.store.loading}
          class="p-1.5 rounded-md hover:bg-surface-base-hover transition-colors"
          title="Refresh"
        >
          <Show when={props.fileStore.store.loading} fallback={<IconRefresh size={16} />}>
            <Spinner class="size-[16px]" />
          </Show>
        </button>

        <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "#c9c9c9", margin: "0 8px" }} />

        <div
          class="flex items-center"
          role="group"
          style={{
            height: "32px",
            padding: "2px",
            "border-radius": "999px",
            background: "rgba(0, 0, 0, 0.05)",
            "font-size": "14px",
            "line-height": "22px",
            color: "rgba(0, 0, 0, 0.6)",
            gap: "4px",
          }}
        >
          <button
            type="button"
            onClick={() => {
              props.fileStore.setGroupMode("kind")
              tracker.interaction({ module: "design", name: "files-group-mode", extend: JSON.stringify({ mode: "kind" }) })
            }}
            class="transition-colors"
            style={{
              "min-width": "88px",
              height: "28px",
              padding: "0 16px",
              "border-radius": "999px",
              "font-size": "14px",
              "line-height": "22px",
              cursor: "pointer",
              color: props.fileStore.store.groupMode === "kind" ? "#0a59f7" : "rgba(0, 0, 0, 0.6)",
              background: props.fileStore.store.groupMode === "kind" ? "#fff" : "transparent",
              "box-shadow": props.fileStore.store.groupMode === "kind" ? "0 1px 6px 0 rgba(0, 0, 0, 0.08)" : "none",
            }}
          >
            {language.t("designFiles.groupKind")}
          </button>
          <button
            type="button"
            onClick={() => {
              props.fileStore.setGroupMode("modified")
              tracker.interaction({ module: "design", name: "files-group-mode", extend: JSON.stringify({ mode: "modified" }) })
            }}
            class="transition-colors"
            style={{
              "min-width": "88px",
              height: "28px",
              padding: "0 16px",
              "border-radius": "999px",
              "font-size": "14px",
              "line-height": "22px",
              cursor: "pointer",
              color: props.fileStore.store.groupMode === "modified" ? "#0a59f7" : "rgba(0, 0, 0, 0.6)",
              background: props.fileStore.store.groupMode === "modified" ? "#fff" : "transparent",
              "box-shadow": props.fileStore.store.groupMode === "modified" ? "0 1px 6px 0 rgba(0, 0, 0, 0.08)" : "none",
            }}
          >
            {language.t("designFiles.groupModified")}
          </button>
        </div>

        <div class="shrink-0" style={{ width: "1px", height: "10px", "border-radius": "9px", background: "#c9c9c9", margin: "0 8px" }} />

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
              class="z-50 bg-surface-raised-stronger-non-alpha rounded-md p-2 min-w-[180px]"
              style={{ "box-shadow": "0 4px 12px rgba(0,0,0,0.16)" }}
            >
              <div class="flex items-center justify-between px-3 shrink-0" style={{ "border-bottom": "1px solid rgba(0, 0, 0, 0.08)", height: "28px" }}>
                <span style={{ "font-size": "12px", "line-height": "20px", color: "#808080" }}>{language.t("designFiles.filter")}</span>
                <Show when={props.fileStore.store.kindFilter.size > 0}>
                  <button
                    type="button"
                    onClick={() => props.fileStore.clearKindFilter()}
                    class="text-text-interactive-base hover:underline"
                    style={{ "font-size": "12px", "line-height": "20px", cursor: "pointer" }}
                  >
                    {language.t("designFiles.filterClear")}
                  </button>
                </Show>
              </div>
              <ul class="flex flex-col gap-1 pt-1">
                <For each={availableKinds()}>
                  {(kind) => (
                    <li>
                      <label class="flex items-center gap-2 px-3 cursor-pointer hover:bg-[rgba(0,0,0,0.1)] active:bg-[rgba(0,0,0,0.15)] transition-colors"
                        style={{
                          height: "36px",
                          "border-radius": "6px",
                          "font-size": "14px",
                          "line-height": "22px",
                          color: "#191919",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={props.fileStore.store.kindFilter.has(kind)}
                          onChange={() => {
                            props.fileStore.toggleKindFilter(kind)
                            tracker.interaction({ module: "design", name: "files-filter", extend: JSON.stringify({ kinds: Array.from(props.fileStore.store.kindFilter) }) })
                          }}
                          style={{
                            width: "16px",
                            height: "16px",
                            "border-radius": "2px",
                            border: "1px solid rgba(147, 147, 147, 1)",
                            cursor: "pointer",
                          }}
                        />
                        <span>{language.t(kindToI18nKey(kind))}</span>
                        <span class="ml-auto" style={{ color: "var(--octo-text-secondary)" }}>
                          {kindCounts().get(kind) ?? 0}
                        </span>
                      </label>
                    </li>
                  )}
                </For>
              </ul>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </div>

      <div class="flex items-center gap-2">
        <Show when={hasSelection()}>
          <button
            type="button"
            onClick={props.onBatchDownload}
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer"
            style={{ "font-size": "14px", "line-height": "22px" }}
          >
            <IconDownload size={16} />
            <span>{language.t("designFiles.download")} ({props.fileStore.store.selected.size})</span>
          </button>
          <button
            type="button"
            onClick={props.onBatchDelete}
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors text-text-diff-delete-base cursor-pointer"
            style={{ "font-size": "14px", "line-height": "22px" }}
          >
            <span>{language.t("designFiles.batchDelete")} ({props.fileStore.store.selected.size})</span>
          </button>
        </Show>

        <Kobalte open={uploadOpen()} onOpenChange={setUploadOpen} modal={false} placement="bottom-end" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            class="flex items-center gap-1 px-2 py-1 rounded transition-colors"
            style={{
              height: "32px",
              "font-size": "14px",
              "line-height": "22px",
              cursor: "pointer",
              color: uploadOpen() ? "#0a59f7" : "rgba(0, 0, 0, 0.9)",
            }}
            title={language.t("designFiles.upload")}
          >
            <IconUpload size={16} />
            <span>{language.t("designFiles.upload")}</span>
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 flex flex-col gap-1 bg-surface-raised-stronger-non-alpha rounded-md p-2"
              style={{ "box-shadow": "0 4px 12px rgba(0,0,0,0.16)", "min-width": "122px" }}
            >
              <button
                type="button"
                onClick={() => { props.onUploadFolder(); setUploadOpen(false) }}
                class="w-full px-2 text-left transition-colors flex items-center gap-1 hover:bg-[rgba(0,0,0,0.1)] active:bg-[rgba(0,0,0,0.15)]"
                style={{
                  height: "36px",
                  "border-radius": "6px",
                  "font-size": "14px",
                  "line-height": "22px",
                  color: "#191919",
                }}
              >
                <IconFolder size={16} />
                <span>{language.t("designFiles.uploadFolder")}</span>
              </button>
              <button
                type="button"
                onClick={() => { props.onUploadFile(); setUploadOpen(false) }}
                class="w-full px-2 text-left transition-colors flex items-center gap-1 hover:bg-[rgba(0,0,0,0.1)] active:bg-[rgba(0,0,0,0.15)]"
                style={{
                  height: "36px",
                  "border-radius": "6px",
                  "font-size": "14px",
                  "line-height": "22px",
                  color: "#191919",
                }}
              >
                <IconFile size={16} />
                <span>{language.t("designFiles.uploadFile")}</span>
              </button>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </div>
    </div>
  )
}
