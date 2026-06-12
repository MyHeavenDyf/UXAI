import {
  createEffect,
  createMemo,
  createResource,
  For,
  Show,
  Switch,
  Match,
  onCleanup,
  createSignal,
} from "solid-js"
import type { JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import {
  createArtifactFileStore,
  kindSortPriority,
  MODIFIED_SECTION_LABELS,
  type ArtifactFile,
  type ArtifactFileKind,
} from "../../utils/artifact-file-store"
import {
  fetchArtifactList,
  deleteArtifactFile,
  deleteArtifactBatch,
  archiveArtifacts,
  renameArtifactFile,
  kindLabel,
  formatFileSize,
  formatTimestamp,
} from "../../utils/artifact-file-api"
import { showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { PreviewPane } from "./preview-pane"

const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, "all"] as const

interface Props {
  sessionId: string
  onOpenFile: (file: ArtifactFile) => void
  onClose: () => void
}

export function DesignFilesPanel(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const dialog = useDialog()
  const fileStore = createArtifactFileStore(props.sessionId)
  const [previewFile, setPreviewFile] = createSignal<ArtifactFile | null>(null)

  const [fetcher] = createResource(
    () => ({ sessionId: props.sessionId, url: globalSDK.url, directory: sdk.directory }),
    async ({ sessionId, url, directory }) => {
      fileStore.setLoading(true)
      try {
        const result = await fetchArtifactList(url, directory, sessionId)
        fileStore.setFiles(result.files)
        fileStore.setError(null)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fileStore.setError(message)
        return { files: [] }
      } finally {
        fileStore.setLoading(false)
      }
    },
  )

  const refresh = async () => {
    fileStore.setLoading(true)
    try {
      const result = await fetchArtifactList(globalSDK.url, sdk.directory, props.sessionId)
      fileStore.setFiles(result.files)
      fileStore.setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      fileStore.setError(message)
    } finally {
      fileStore.setLoading(false)
    }
  }

  const handleDelete = async (file: ArtifactFile) => {
    dialog.show(() => (
      <Dialog title="Delete file" fit>
        <span class="text-[14px]">Delete "{file.name}"?</span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => {
              void doDelete(file)
              dialog.close()
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    ))
  }

  const doDelete = async (file: ArtifactFile) => {
    try {
      await deleteArtifactFile(globalSDK.url, sdk.directory, file.path)
      fileStore.deleteFile(file.path)
      showToast({ title: "Deleted", description: file.name })
    } catch (err) {
      showToast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleBatchDelete = async () => {
    const files = Array.from(fileStore.store.selected)
    if (files.length === 0) return

    dialog.show(() => (
      <Dialog title="Delete files" fit>
        <span class="text-[14px]">Delete {files.length} selected files?</span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => {
              void doBatchDelete(files)
              dialog.close()
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    ))
  }

  const doBatchDelete = async (paths: string[]) => {
    try {
      const result = await deleteArtifactBatch(globalSDK.url, sdk.directory, paths)
      for (const path of paths) {
        fileStore.deleteFile(path)
      }
      fileStore.clearSelection()
      showToast({ title: "Deleted", description: `${result.deleted} files deleted` })
    } catch (err) {
      showToast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleBatchDownload = async () => {
    const files = Array.from(fileStore.store.selected)
    if (files.length === 0) return

    try {
      const blob = await archiveArtifacts(globalSDK.url, sdk.directory, files)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `artifacts-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast({ title: "Download failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleRename = async (file: ArtifactFile) => {
    const newName = prompt("New name:", file.name)
    if (!newName || newName === file.name) return

    const dir = file.path.slice(0, file.path.lastIndexOf(file.name))
    const newPath = dir + newName

    try {
      await renameArtifactFile(globalSDK.url, sdk.directory, file.path, newPath)
      await refresh()
      showToast({ title: "Renamed", description: file.name + " → " + newName })
    } catch (err) {
      showToast({ title: "Rename failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleOpenFile = (file: ArtifactFile) => {
    props.onOpenFile(file)
  }

  const handlePreview = (file: ArtifactFile) => {
    setPreviewFile(file)
  }

  const handleToggleSelection = (file: ArtifactFile) => {
    fileStore.toggleFileSelection(file.path)
  }

  const handleSelectAllPage = () => {
    if (fileStore.allPageSelected()) {
      fileStore.clearSelection()
    } else {
      fileStore.selectAllPage()
    }
  }

  const kindGroupEntries = createMemo(() =>
    Array.from(fileStore.kindGroups().entries())
      .sort(([a], [b]) => kindSortPriority(a) - kindSortPriority(b)),
  )

  return (
    <div class="flex h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div
        class="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={fileStore.store.loading}
            class="p-1.5 rounded-md hover:bg-surface-base-hover transition-colors"
            title="Refresh"
          >
            <Show when={fileStore.store.loading} fallback={<Icon name="ellipsis" size="small" />}>
              <Spinner class="size-[14px]" />
            </Show>
          </button>

          <div class="flex items-center gap-1 text-[12px]" role="group">
            <span style={{ color: "var(--octo-text-secondary)" }}>Group:</span>
            <button
              type="button"
              onClick={() => fileStore.setGroupMode("kind")}
              classList={{
                "px-2 py-1 rounded transition-colors text-[12px]": true,
                "bg-surface-base-interactive-active text-text-interactive-base": fileStore.store.groupMode === "kind",
                "hover:bg-surface-base-hover": fileStore.store.groupMode !== "kind",
              }}
            >
              Kind
            </button>
            <button
              type="button"
              onClick={() => fileStore.setGroupMode("modified")}
              classList={{
                "px-2 py-1 rounded transition-colors text-[12px]": true,
                "bg-surface-base-interactive-active text-text-interactive-base": fileStore.store.groupMode === "modified",
                "hover:bg-surface-base-hover": fileStore.store.groupMode !== "modified",
              }}
            >
              Modified
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Show when={fileStore.store.selected.size > 0}>
            <button
              type="button"
              onClick={handleBatchDownload}
              class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px]"
            >
              <Icon name="chevron-down" size="small" />
              <span>Download ({fileStore.store.selected.size})</span>
            </button>
            <button
              type="button"
              onClick={handleBatchDelete}
              class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px] text-text-diff-delete-base"
            >
              <span>Delete ({fileStore.store.selected.size})</span>
            </button>
          </Show>

          <button
            type="button"
            onClick={props.onClose}
            class="p-1.5 rounded-md hover:bg-surface-base-hover transition-colors"
            title="Close"
          >
            <Icon name="close" size="small" />
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto">
        <Show when={fileStore.store.loading && fileStore.store.files.length === 0}>
          <div class="flex items-center justify-center h-full">
            <Spinner class="size-[20px]" />
          </div>
        </Show>

        <Show when={fileStore.store.error}>
          <div class="p-4 text-text-diff-delete-base text-[14px]">
            Error: {fileStore.store.error}
          </div>
        </Show>

        <Show when={!fileStore.store.loading && fileStore.store.files.length === 0}>
          <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>
              No artifact files
            </div>
            <div class="text-[12px]" style={{ color: "var(--octo-text-disabled)" }}>
              Files will appear here after AI generates artifacts
            </div>
          </div>
        </Show>

        <Show when={fileStore.store.files.length > 0}>
          <table class="w-full text-[13px]">
            <thead>
              <tr style={{ background: "var(--octo-surface-page)" }}>
                <th class="w-[32px] px-2 py-2">
                  <input
                    type="checkbox"
                    checked={fileStore.allPageSelected()}
                    ref={(el) => { el.indeterminate = fileStore.somePageSelected() }}
                    onChange={handleSelectAllPage}
                    class="cursor-pointer"
                  />
                </th>
                <th class="px-2 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => {
                      if (fileStore.store.sortKey === "name") {
                        fileStore.setSortDir(fileStore.store.sortDir === "asc" ? "desc" : "asc")
                      } else {
                        fileStore.setSortKey("name")
                        fileStore.setSortDir("asc")
                      }
                    }}
                    class="flex items-center gap-1 hover:text-text-interactive-base transition-colors"
                  >
                    Name
                    <Show when={fileStore.store.sortKey === "name"}>
                      <Icon name={fileStore.store.sortDir === "asc" ? "chevron-right" : "chevron-down"} size="small" />
                    </Show>
                  </button>
                </th>
                <th class="px-2 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => {
                      if (fileStore.store.sortKey === "kind") {
                        fileStore.setSortDir(fileStore.store.sortDir === "asc" ? "desc" : "asc")
                      } else {
                        fileStore.setSortKey("kind")
                        fileStore.setSortDir("asc")
                      }
                    }}
                    class="flex items-center gap-1 hover:text-text-interactive-base transition-colors"
                  >
                    Kind
                    <Show when={fileStore.store.sortKey === "kind"}>
                      <Icon name={fileStore.store.sortDir === "asc" ? "chevron-right" : "chevron-down"} size="small" />
                    </Show>
                  </button>
                </th>
                <th class="px-2 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => {
                      if (fileStore.store.sortKey === "mtime") {
                        fileStore.setSortDir(fileStore.store.sortDir === "asc" ? "desc" : "asc")
                      } else {
                        fileStore.setSortKey("mtime")
                        fileStore.setSortDir("desc")
                      }
                    }}
                    class="flex items-center gap-1 hover:text-text-interactive-base transition-colors"
                  >
                    Modified
                    <Show when={fileStore.store.sortKey === "mtime"}>
                      <Icon name={fileStore.store.sortDir === "asc" ? "chevron-right" : "chevron-down"} size="small" />
                    </Show>
                  </button>
                </th>
                <th class="px-2 py-2 text-right">Size</th>
                <th class="w-[60px] px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              <Switch>
                <Match when={fileStore.store.groupMode === "kind"}>
                  <For each={kindGroupEntries()}>
                    {([kind, files]) => (
                      <>
                        <tr class="df-section-row" style={{ background: "var(--octo-surface-page)" }}>
                          <td colSpan={6} class="px-2 py-1">
                            <div class="flex items-center gap-2 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
                              <span class="font-medium">{kindLabel(kind)}</span>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised-base">
                                {files.length}
                              </span>
                            </div>
                          </td>
                        </tr>
                        <For each={files}>
                          {(file) => (
                            <FileRow
                              file={file}
                              selected={fileStore.store.selected.has(file.path)}
                              onToggleSelection={() => handleToggleSelection(file)}
                              onPreview={() => handlePreview(file)}
                              onOpen={() => handleOpenFile(file)}
                              onDelete={() => handleDelete(file)}
                              onRename={() => handleRename(file)}
                            />
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </Match>
                <Match when={fileStore.store.groupMode === "modified"}>
                  <For each={fileStore.visibleModifiedSections()}>
                    {(section) => (
                      <>
                        <tr class="df-section-row" style={{ background: "var(--octo-surface-page)" }}>
                          <td colSpan={6} class="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => fileStore.toggleSection(section)}
                              class="flex items-center gap-2 text-[12px] w-full"
                              style={{ color: "var(--octo-text-secondary)" }}
                            >
                              <Icon
                                name={fileStore.store.collapsedSections.has(section) ? "chevron-right" : "chevron-down"}
                                size="small"
                              />
                              <span class="font-medium">{MODIFIED_SECTION_LABELS[section]}</span>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised-base">
                                {fileStore.modifiedGroups()[section].length}
                              </span>
                            </button>
                          </td>
                        </tr>
                        <Show when={!fileStore.store.collapsedSections.has(section)}>
                          <For each={fileStore.modifiedGroups()[section]}>
                            {(file) => (
                              <FileRow
                                file={file}
                                selected={fileStore.store.selected.has(file.path)}
                                onToggleSelection={() => handleToggleSelection(file)}
                                onPreview={() => handlePreview(file)}
                                onOpen={() => handleOpenFile(file)}
                                onDelete={() => handleDelete(file)}
                                onRename={() => handleRename(file)}
                              />
                            )}
                          </For>
                        </Show>
                      </>
                    )}
                  </For>
                </Match>
              </Switch>
            </tbody>
          </table>
        </Show>
      </div>

      <Show when={fileStore.store.files.length > 15}>
        <div
          class="shrink-0 flex items-center justify-between px-4 py-2"
          style={{ "border-top": "1px solid var(--octo-border-divider)" }}
        >
          <div class="flex items-center gap-2 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
            <span>{fileStore.rangeStart()}-{fileStore.rangeEnd()} of {fileStore.sortedFiles().length}</span>
            <select
              value={String(fileStore.store.pageSize)}
              onChange={(e) => {
                const value = e.currentTarget.value
                fileStore.setPageSize(value === "all" ? "all" : Number(value))
              }}
              class="px-2 py-1 rounded bg-surface-raised-base text-[12px]"
            >
              <For each={PAGE_SIZE_OPTIONS}>
                {(size) => <option value={String(size)}>{size === "all" ? "All" : size}</option>}
              </For>
            </select>
          </div>

          <Show when={fileStore.totalPages() > 1}>
            <div class="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileStore.setPage(fileStore.safePage() - 1)}
                disabled={fileStore.safePage() === 0}
                class="p-1.5 rounded hover:bg-surface-base-hover transition-colors disabled:opacity-50"
              >
                <Icon name="chevron-left" size="small" />
              </button>

              <select
                value={fileStore.safePage()}
                onChange={(e) => fileStore.setPage(Number(e.currentTarget.value))}
                class="px-2 py-1 rounded bg-surface-raised-base text-[12px]"
              >
                <For each={Array.from({ length: fileStore.totalPages() }, (_, i) => i)}>
                  {(i) => <option value={i}>{i + 1}</option>}
                </For>
              </select>

              <button
                type="button"
                onClick={() => fileStore.setPage(fileStore.safePage() + 1)}
                disabled={fileStore.safePage() === fileStore.totalPages() - 1}
                class="p-1.5 rounded hover:bg-surface-base-hover transition-colors disabled:opacity-50"
              >
                <Icon name="chevron-right" size="small" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      </div>

      <Show when={previewFile()}>
        {(file) => (
          <PreviewPane
            file={file()}
            sdkUrl={globalSDK.url}
            sdkDirectory={sdk.directory || ""}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </Show>
    </div>
  )
}

function FileRow(props: {
  file: ArtifactFile
  selected: boolean
  onToggleSelection: () => void
  onPreview: () => void
  onOpen: () => void
  onDelete: () => void
  onRename: () => void
}): JSX.Element {
  const [showMenu, setShowMenu] = createSignal(false)

  return (
    <tr
      classList={{
        "hover:bg-surface-base-hover transition-colors cursor-pointer": true,
        "bg-surface-base-interactive-active/10": props.selected,
      }}
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement) return
        if (e.target instanceof HTMLButtonElement) return
        props.onPreview()
      }}
    >
      <td class="w-[32px] px-2 py-1.5">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={props.onToggleSelection}
          onClick={(e) => e.stopPropagation()}
          class="cursor-pointer"
        />
      </td>
      <td class="px-2 py-1.5 truncate max-w-[200px]" title={props.file.name}>
        {props.file.name}
      </td>
      <td class="px-2 py-1.5 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
        {kindLabel(props.file.kind)}
      </td>
      <td class="px-2 py-1.5 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
        {formatTimestamp(props.file.mtime)}
      </td>
      <td class="px-2 py-1.5 text-[12px] text-right" style={{ color: "var(--octo-text-secondary)" }}>
        {formatFileSize(props.file.size)}
      </td>
      <td class="w-[60px] px-2 py-1.5">
        <div class="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu())
            }}
            class="p-1 rounded hover:bg-surface-raised-base transition-colors"
          >
            <Icon name="ellipsis" size="small" />
          </button>

          <Show when={showMenu()}>
            <div
              class="absolute right-0 top-full z-50 min-w-[100px] bg-surface-raised-base rounded-md shadow-lg py-1"
              style={{ border: "1px solid var(--octo-border-divider)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  props.onOpen()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onRename()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onDelete()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors text-text-diff-delete-base"
              >
                Delete
              </button>
            </div>
          </Show>
        </div>
      </td>
    </tr>
  )
}