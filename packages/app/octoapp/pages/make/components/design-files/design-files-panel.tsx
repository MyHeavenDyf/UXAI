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
  on,
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
  uploadArtifactFile,
  fetchArtifactContent,
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
import { useLanguage } from "@/context/language"
import { PreviewPane } from "./preview-pane"

const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, "all"] as const

interface Props {
  sessionId: string
  onOpenFile: (file: ArtifactFile) => void
  onAddToSession?: (file: ArtifactFile) => void
}

export function DesignFilesPanel(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const fileStore = createArtifactFileStore(props.sessionId)
  const [previewFile, setPreviewFile] = createSignal<ArtifactFile | null>(null)
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  let fileInputRef!: HTMLInputElement

  createEffect(on(() => props.sessionId, () => {
    setPreviewFile(null)
  }))

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
      <Dialog title={language.t("file.delete.title")} fit class="delete-dialog">
        <span class="text-[14px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
          {language.t("file.delete.confirm", { name: file.name })}
        </span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            class="delete-dialog-btn delete-dialog-btn-primary"
            onClick={() => {
              void doDelete(file)
              dialog.close()
            }}
          >
            {language.t("file.delete.button")}
          </Button>
        </div>
      </Dialog>
    ))
  }

  const doDelete = async (file: ArtifactFile) => {
    try {
      await deleteArtifactFile(globalSDK.url, sdk.directory, file.path)
      fileStore.deleteFile(file.path)
      if (previewFile()?.path === file.path) setPreviewFile(null)
      showToast({ title: "Deleted", description: file.name })
    } catch (err) {
      showToast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleBatchDelete = async () => {
    const files = Array.from(fileStore.store.selected)
    if (files.length === 0) return

    dialog.show(() => (
      <Dialog title={language.t("file.delete.title")} fit class="delete-dialog">
        <span class="text-[14px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
          {language.t("file.delete.plural.confirm", { count: files.length })}
        </span>
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            class="delete-dialog-btn delete-dialog-btn-primary"
            onClick={() => {
              void doBatchDelete(files)
              dialog.close()
            }}
          >
            {language.t("file.delete.button")}
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
      if (previewFile() && paths.includes(previewFile()!.path)) setPreviewFile(null)
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

  async function handleDownload(file: ArtifactFile) {
    try {
      const content = await fetchArtifactContent(globalSDK.url, sdk.directory, file.path)
      const blob = content.encoding === "base64"
        ? await fetch(`data:${content.mimeType};base64,${content.content}`).then(r => r.blob())
        : new Blob([content.content], { type: content.mimeType })

      // Electron 环境：使用原生 API（阻塞等待用户选择）
      if ((window as any).api?.saveFilePicker) {
        const filePath = await (window as any).api.saveFilePicker({
          defaultPath: file.name,
        })
        if (!filePath) return
        await (window as any).api.writeFileBuffer(filePath, await blob.arrayBuffer())
        showToast({ title: "下载完成", description: file.name })
        return
      }

      // 浏览器环境：fallback 到传统下载
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成", description: file.name })
    } catch (err) {
      showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  function startRename(file: ArtifactFile) {
    setRenamingPath(file.path)
    setRenameDraft(file.name)
  }

  async function saveRename(file: ArtifactFile) {
    const draft = renameDraft().trim()
    if (!draft || draft === file.name) {
      setRenamingPath(null)
      return
    }

    const dir = file.path.slice(0, file.path.lastIndexOf(file.name))
    const newPath = dir + draft

    try {
      await renameArtifactFile(globalSDK.url, sdk.directory, file.path, newPath)
      await refresh()
      showToast({ title: "Renamed", description: file.name + " → " + draft })
    } catch (err) {
      showToast({ title: "Rename failed", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setRenamingPath(null)
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

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const base64 = ev.target?.result as string
        const content = base64.split(",")[1] || base64
        try {
          const result = await uploadArtifactFile(
            globalSDK.url,
            sdk.directory || "",
            props.sessionId,
            file.name,
            content,
          )
          showToast({ title: "Uploaded", description: result.name })
          await refresh()
        } catch (err) {
          showToast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err) })
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const kindGroupEntries = createMemo(() =>
    Array.from(fileStore.kindGroups().entries())
      .sort(([a], [b]) => kindSortPriority(a) - kindSortPriority(b)),
  )

  return (
    <div class="flex h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={(e) => {
            if (e.currentTarget.files) {
              handleUpload(e.currentTarget.files)
              e.currentTarget.value = ""
            }
          }}
          class="hidden"
        />
        <Show when={fileStore.store.files.length > 0}>
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
                <span>删除 ({fileStore.store.selected.size})</span>
              </button>
            </Show>

            <button
              type="button"
              onClick={() => fileInputRef?.click()}
              class="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-base-hover transition-colors text-[12px]"
              title="上传文件"
            >
              <Icon name="chevron-down" size="small" />
              <span>添加</span>
            </button>
          </div>
        </div>
      </Show>

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
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <button
              type="button"
              onClick={() => fileInputRef?.click()}
              class="flex items-center gap-2 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors"
              style={{
                background: "var(--octo-brand)",
                color: "white",
              }}
            >
              <Icon name="plus" size="small" />
              <span>Upload File</span>
            </button>
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
                              renaming={renamingPath() === file.path}
                              renameDraft={renameDraft()}
                              onToggleSelection={() => handleToggleSelection(file)}
                              onPreview={() => handlePreview(file)}
                              onOpen={() => handleOpenFile(file)}
                              onDelete={() => handleDelete(file)}
                              onRename={() => startRename(file)}
                              onRenameInput={(v) => setRenameDraft(v)}
                              onRenameKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === "Enter") { e.preventDefault(); void saveRename(file) }
                                if (e.key === "Escape") { e.preventDefault(); setRenamingPath(null) }
                              }}
                              onRenameBlur={() => void saveRename(file)}
                              onAddToSession={() => props.onAddToSession?.(file)}
                              onDownload={() => handleDownload(file)}
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
                                renaming={renamingPath() === file.path}
                                renameDraft={renameDraft()}
                                onToggleSelection={() => handleToggleSelection(file)}
                                onPreview={() => handlePreview(file)}
                                onOpen={() => handleOpenFile(file)}
                                onDelete={() => handleDelete(file)}
                                onRename={() => startRename(file)}
                                onRenameInput={(v) => setRenameDraft(v)}
                                onRenameKeyDown={(e) => {
                                  e.stopPropagation()
                                  if (e.key === "Enter") { e.preventDefault(); void saveRename(file) }
                                  if (e.key === "Escape") { e.preventDefault(); setRenamingPath(null) }
                                }}
                                onRenameBlur={() => void saveRename(file)}
                                onAddToSession={() => props.onAddToSession?.(file)}
                                onDownload={() => handleDownload(file)}
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
  renaming?: boolean
  renameDraft?: string
  onToggleSelection: () => void
  onPreview: () => void
  onOpen: () => void
  onDelete: () => void
  onRename: () => void
  onRenameInput?: (value: string) => void
  onRenameKeyDown?: (e: KeyboardEvent) => void
  onRenameBlur?: () => void
  onAddToSession?: () => void
  onDownload?: () => void
}): JSX.Element {
  const [showMenu, setShowMenu] = createSignal(false)
  let renameInputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (props.renaming && renameInputRef) {
      renameInputRef.focus()
    }
  })

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
        <Show when={!props.renaming} fallback={
          <input
            ref={renameInputRef}
            value={props.renameDraft}
            onInput={(e) => props.onRenameInput?.(e.currentTarget.value)}
            onKeyDown={(e) => props.onRenameKeyDown?.(e)}
            onBlur={() => props.onRenameBlur?.()}
            onClick={(e) => e.stopPropagation()}
            class="w-full text-[12px] px-1 py-0.5 rounded"
            style={{ border: "1px solid #0a59f7", outline: "none" }}
          />
        }>
          {props.file.name}
        </Show>
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
              class="absolute right-0 top-full z-50 bg-surface-raised-base rounded-md shadow-lg py-1"
              style={{ border: "1px solid var(--octo-border-divider)", width: "183px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <Show when={props.onAddToSession}>
                <button
                  type="button"
                  onClick={() => {
                    props.onAddToSession!()
                    setShowMenu(false)
                  }}
                  class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
                >
                  添加至会话区
                </button>
              </Show>
              <button
                type="button"
                onClick={() => {
                  props.onOpen()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
              >
                在标签页中打开
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onRename()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
              >
                重命名
              </button>
              <Show when={props.onDownload}>
                <button
                  type="button"
                  onClick={() => {
                    props.onDownload!()
                    setShowMenu(false)
                  }}
                  class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors"
                >
                  下载
                </button>
              </Show>
              <button
                type="button"
                onClick={() => {
                  props.onDelete()
                  setShowMenu(false)
                }}
                class="w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-base-hover transition-colors text-text-diff-delete-base"
              >
                删除
              </button>
            </div>
          </Show>
        </div>
      </td>
    </tr>
  )
}