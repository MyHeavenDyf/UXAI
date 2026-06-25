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
  type ArtifactFile,
  type ArtifactFileKind,
  type ModifiedSection,
} from "../../utils/artifact-file-store"
import {
  fetchArtifactList,
  deleteArtifactFile,
  deleteArtifactBatch,
  archiveArtifacts,
  renameArtifactFile,
  uploadArtifactFile,
  uploadArtifactFolder,
  getArtifactRelativePath,
  fetchArtifactContent,
  formatTimestamp,
  type FolderUploadFile,
} from "../../utils/artifact-file-api"
import { showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { PreviewPane } from "./preview-pane"
import { Breadcrumb } from "./breadcrumb"
import { DesignFilesToolbar } from "./design-files-toolbar"

const kindToI18nKey = (kind: ArtifactFileKind): string => {
  const capitalized = kind.charAt(0).toUpperCase() + kind.slice(1)
  return `designFiles.kind${capitalized}`
}

const modifiedSectionToI18nKey = (section: ModifiedSection): string => {
  const map: Record<ModifiedSection, string> = {
    today: "timeToday",
    yesterday: "timeYesterday",
    previous7Days: "timePrevious7Days",
    previous30Days: "timePrevious30Days",
    older: "timeOlder",
  }
  return `designFiles.${map[section]}`
}

interface Props {
  sessionId: string
  onOpenFile: (file: ArtifactFile) => void
  onAddToSession?: (file: ArtifactFile) => void
  onCloseTabsByPath?: (paths: string[]) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
  onRenameTabByPath?: (oldPath: string, newPath: string, newTitle: string) => void
  onRenameAttachmentPath?: (oldPath: string, newPath: string, newFilename: string) => void
}

export function DesignFilesPanel(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const fileStore = createArtifactFileStore(props.sessionId)
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [showAddMenu, setShowAddMenu] = createSignal(false)
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [filterMenuOpen, setFilterMenuOpen] = createSignal(false)
  let fileInputRef!: HTMLInputElement
  let folderInputRef!: HTMLInputElement
  let filterMenuRef: HTMLDivElement | undefined

  createEffect(on(() => props.sessionId, () => {
    fileStore.setCurrentPath("")
  }))

  const [fetcher] = createResource(
    () => ({ sessionId: props.sessionId, url: globalSDK.url, directory: sdk.directory, currentPath: fileStore.store.currentPath }),
    async ({ sessionId, url, directory, currentPath }) => {
      fileStore.setLoading(true)
      try {
        const result = await fetchArtifactList(url, directory, sessionId, currentPath)
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
      const result = await fetchArtifactList(globalSDK.url, sdk.directory, props.sessionId, fileStore.store.currentPath)
      fileStore.setFiles(result.files)
      fileStore.setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      fileStore.setError(message)
    } finally {
      fileStore.setLoading(false)
    }
  }

  createEffect(() => {
    if (!filterMenuOpen()) return
    const handler = (e: MouseEvent) => {
      if (filterMenuRef && !filterMenuRef.contains(e.target as Node)) {
        setFilterMenuOpen(false)
      }
    }
    document.addEventListener("click", handler)
    onCleanup(() => document.removeEventListener("click", handler))
  })

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
      
      const previewFile = fileStore.previewFile()
      if (previewFile?.path === file.path) {
        fileStore.setPreviewFile(null)
      }
      
      props.onCloseTabsByPath?.([file.path])
      props.onRemoveAttachmentsByPath?.([file.path])
      
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
      fileStore.clearSelection()
      
      const previewFile = fileStore.previewFile()
      if (previewFile && paths.includes(previewFile.path)) {
        fileStore.setPreviewFile(null)
      }
      
      props.onCloseTabsByPath?.(paths)
      props.onRemoveAttachmentsByPath?.(paths)
      
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
    const oldName = file.name
    const oldPath = file.path
    if (!draft || draft === oldName) {
      setRenamingPath(null)
      return
    }

    const dir = file.path.slice(0, file.path.lastIndexOf(oldName))
    const newPath = dir + draft

    try {
      await renameArtifactFile(globalSDK.url, sdk.directory, oldPath, newPath)
      await refresh()
      props.onRenameTabByPath?.(oldPath, newPath, draft)
      props.onRenameAttachmentPath?.(oldPath, newPath, draft)
      showToast({ title: "Renamed", description: oldName + " → " + draft })
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
    if (file.isFolder) return
    fileStore.setPreviewFile(file)
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
    const currentPath = fileStore.store.currentPath
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
            currentPath,
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

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX >= rect.right || 
        e.clientY < rect.top || e.clientY >= rect.bottom) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    
    const items = e.dataTransfer?.items
    if (items) {
      const entries: FileSystemEntry[] = []
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const entry = (item as any).webkitGetAsEntry?.() as FileSystemEntry | null
          if (entry) entries.push(entry)
        }
      }
      void processEntries(entries)
    } else {
      const files = e.dataTransfer?.files
      if (files && files.length > 0) handleUpload(files)
    }
  }

  async function processEntries(entries: FileSystemEntry[]) {
    for (const entry of entries) {
      if (entry.isDirectory) {
        await processDirectoryEntry(entry as FileSystemDirectoryEntry)
      } else if (entry.isFile) {
        await processFileEntry(entry as FileSystemFileEntry)
      }
    }
  }

  async function processDirectoryEntry(dirEntry: FileSystemDirectoryEntry) {
    const folderName = dirEntry.name
    const fileEntries: FolderUploadFile[] = []
    
    async function collectFiles(entry: FileSystemEntry) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry as FileSystemFileEntry)
        const relativePath = entry.fullPath.slice(1 + folderName.length)
        const base64 = await readFileAsBase64(file)
        fileEntries.push({ relativePath, content: base64 })
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const childEntries = await readAllDirectoryEntries(reader)
        for (const child of childEntries) {
          await collectFiles(child)
        }
      }
    }
    
    const reader = dirEntry.createReader()
    const entries = await readAllDirectoryEntries(reader)
    for (const entry of entries) {
      await collectFiles(entry)
    }
    
    if (fileEntries.length === 0) return
    
    try {
      const result = await uploadArtifactFolder(
        globalSDK.url,
        sdk.directory || "",
        props.sessionId,
        folderName,
        fileEntries,
        fileStore.store.currentPath,
      )
      showToast({ title: "Uploaded folder", description: `${folderName} (${result.fileCount} files)` })
      await refresh()
    } catch (err) {
      showToast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  async function processFileEntry(fileEntry: FileSystemFileEntry) {
    const file = await getFileFromEntry(fileEntry)
    await uploadSingleFile(file)
  }

  async function uploadSingleFile(file: File) {
    const currentPath = fileStore.store.currentPath
    const base64 = await readFileAsBase64(file)
    try {
      const result = await uploadArtifactFile(
        globalSDK.url,
        sdk.directory || "",
        props.sessionId,
        file.name,
        base64,
        currentPath,
      )
      showToast({ title: "Uploaded", description: result.name })
      await refresh()
    } catch (err) {
      showToast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const entries: FileSystemEntry[] = []
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
      if (batch.length === 0) break
      entries.push(...batch)
    }
    return entries
  }

  function getFileFromEntry(fileEntry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve) => fileEntry.file(resolve))
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(",")[1] || result)
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  const handleFolderUpload = async (files: FileList) => {
    if (!files || files.length === 0) return

    const firstFile = files[0]
    const folderName = firstFile.webkitRelativePath?.split("/")[0]
    if (!folderName) {
      showToast({ title: "Upload failed", description: "Could not determine folder name" })
      return
    }

    const fileEntries: FolderUploadFile[] = []

    for (const file of Array.from(files)) {
      const relativePath = file.webkitRelativePath.slice(folderName.length + 1)
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = (ev) => {
          const result = ev.target?.result as string
          resolve(result.split(",")[1] || result)
        }
        reader.readAsDataURL(file)
      })
      fileEntries.push({ relativePath, content: base64 })
    }

    try {
      const result = await uploadArtifactFolder(
        globalSDK.url,
        sdk.directory || "",
        props.sessionId,
        folderName,
        fileEntries,
        fileStore.store.currentPath,
      )
      showToast({ title: "Uploaded folder", description: `${folderName} (${result.fileCount} files)` })
      await refresh()
    } catch (err) {
      showToast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const kindGroupEntries = createMemo(() =>
    Array.from(fileStore.kindGroups().entries())
      .sort(([a], [b]) => kindSortPriority(a) - kindSortPriority(b)),
  )

  return (
    <div class="flex h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <div 
        class="flex flex-col flex-1 min-w-0 overflow-hidden relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Show when={isDragOver()}>
          <div 
            class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ 
              background: "rgba(10, 89, 247, 0.15)",
              border: "2px dashed rgba(10, 89, 247, 0.5)"
            }}
          >
            <div class="text-[14px] font-medium" style={{ color: "var(--octo-brand)" }}>
              把文件拖拽到这里上传
            </div>
          </div>
        </Show>
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
        <input
          type="file"
          ref={folderInputRef}
          // @ts-ignore - webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          onChange={(e) => {
            if (e.currentTarget.files) {
              void handleFolderUpload(e.currentTarget.files)
              e.currentTarget.value = ""
            }
          }}
          class="hidden"
        />

        <DesignFilesToolbar
          fileStore={fileStore}
          filterMenuRef={filterMenuRef}
          filterMenuOpen={filterMenuOpen()}
          showAddMenu={showAddMenu()}
          onRefresh={refresh}
          onToggleFilterMenu={() => {
            setFilterMenuOpen(!filterMenuOpen())
            setShowAddMenu(false)
          }}
          onToggleAddMenu={() => setShowAddMenu(!showAddMenu())}
          onUploadFile={() => {
            setShowAddMenu(false)
            fileInputRef?.click()
          }}
          onUploadFolder={() => {
            setShowAddMenu(false)
            folderInputRef?.click()
          }}
          onBatchDownload={handleBatchDownload}
          onBatchDelete={handleBatchDelete}
          fileInputRef={fileInputRef}
          folderInputRef={folderInputRef}
        />

      <Breadcrumb
        currentPath={fileStore.store.currentPath}
        onNavigate={(path) => fileStore.setCurrentPath(path)}
      />

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
              <Icon name="upload" size="small" />
              <span>{language.t("designFiles.uploadFileAction")}</span>
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
                  <span class="flex items-center gap-1">
                    {language.t("designFiles.columnName")}
                  </span>
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
                    {language.t("designFiles.columnKind")}
                    <Show when={fileStore.store.sortKey === "kind"}>
                      <Icon name={fileStore.store.sortDir === "asc" ? "arrow-up" : "arrow-down"} size="small" />
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
                    {language.t("designFiles.columnModified")}
                    <Show when={fileStore.store.sortKey === "mtime"}>
                      <Icon name={fileStore.store.sortDir === "asc" ? "arrow-up" : "arrow-down"} size="small" />
                    </Show>
                  </button>
                </th>
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
                          <td colSpan={5} class="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => fileStore.toggleSection(kind)}
                              class="flex items-center gap-2 text-[12px] w-full"
                              style={{ color: "var(--octo-text-secondary)" }}
                            >
                              <Icon
                                name={fileStore.store.collapsedSections.has(kind) ? "chevron-right" : "chevron-down"}
                                size="small"
                              />
                              <span class="font-medium">{language.t(kindToI18nKey(kind))}</span>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised-base">
                                {files.length}
                              </span>
                            </button>
                          </td>
                        </tr>
                        <Show when={!fileStore.store.collapsedSections.has(kind)}>
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
                                onDownload={file.isFolder ? undefined : () => handleDownload(file)}
                                onNavigateFolder={() => fileStore.navigateToFolder(file)}
                              />
                            )}
                          </For>
                        </Show>
                      </>
                    )}
                  </For>
                </Match>
                <Match when={fileStore.store.groupMode === "modified"}>
                  <For each={fileStore.visibleModifiedSections()}>
                    {(section) => (
                      <>
                        <tr class="df-section-row" style={{ background: "var(--octo-surface-page)" }}>
                          <td colSpan={5} class="px-2 py-1">
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
                              <span class="font-medium">{language.t(modifiedSectionToI18nKey(section))}</span>
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
onDownload={file.isFolder ? undefined : () => handleDownload(file)}
                                onNavigateFolder={() => fileStore.navigateToFolder(file)}
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
    </div>

    <Show when={fileStore.previewFile()}>
        {(file) => (
          <PreviewPane
            file={file()}
            sdkUrl={globalSDK.url}
            sdkDirectory={sdk.directory || ""}
            onClose={() => fileStore.setPreviewFile(null)}
            onOpen={() => handleOpenFile(file())}
            onDownload={() => handleDownload(file())}
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
  onNavigateFolder?: () => void
}): JSX.Element {
  const language = useLanguage()
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
        if (props.file.isFolder) {
          props.onNavigateFolder?.()
        } else {
          props.onPreview()
        }
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
          <span class="flex items-center gap-1">
            <Show when={props.file.isFolder}>
              <Icon name="folder" size="small" style={{ color: "var(--octo-text-secondary)" }} />
            </Show>
            {props.file.name}
          </span>
        </Show>
      </td>
      <td class="px-2 py-1.5 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
        {language.t(kindToI18nKey(props.file.kind))}
      </td>
      <td class="px-2 py-1.5 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
        {formatTimestamp(props.file.mtime, language.t)}
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
              <Show when={props.onAddToSession && !props.file.isFolder}>
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
              <Show when={!props.file.isFolder}>
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
              </Show>
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