import {
  createEffect,
  createMemo,
  For,
  Show,
  Switch,
  Match,
  onCleanup,
  createSignal,
  on,
  batch,
} from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { tracker } from "@/utils/tracker"
import {
  createArtifactFileStore,
  type ArtifactFile,
  type ArtifactFileKind,
  type ModifiedSection,
  type GroupMode,
} from "../../utils/artifact-file-store"
import {
  fetchArtifactList,
  deleteArtifactFile,
  deleteArtifactBatch,
  archiveArtifacts,
  uploadArtifactFile,
  uploadArtifactFolder,
  fetchArtifactContent,
  formatTimestamp,
  type FolderUploadFile,
} from "../../utils/artifact-file-api"
import { showToast } from "@opencode-ai/ui/toast"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { PreviewPane } from "./preview-pane"
import { Breadcrumb } from "./breadcrumb"
import { DesignFilesToolbar } from "./design-files-toolbar"
import emptyPng from "../../icons/empty.png"
import emptyFolderPng from "../../icons/empty_folder.png"
import { IconChevronDown, IconSortArrow, IconTableEllipsis, IconUpload } from "../../icons/design-files-icons"
import { getFileIcon } from "../../icons/file-type-icons"

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

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface Props {
  sessionId: string
  onOpenFile: (file: ArtifactFile) => void
  onAddToSession?: (file: ArtifactFile) => void
  onCloseTabsByPath?: (paths: string[]) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
}

export function DesignFilesPanel(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const fileStore = createArtifactFileStore(props.sessionId)
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")
  const [isDragOver, setIsDragOver] = createSignal(false)
  let fileInputRef!: HTMLInputElement
  let folderInputRef!: HTMLInputElement

  createEffect(on(
    [() => props.sessionId, () => fileStore.store.currentPath],
    ([sessionId], prev) => {
      if (prev && prev[0] !== sessionId) {
        batch(() => {
          fileStore.setCurrentPath("")
          fileStore.clearKindFilter()
          fileStore.setGeneratedFiles([])
          fileStore.setUploadedFiles([])
        })
      }
      void refresh()
    }
  ))

  const refresh = async () => {
    fileStore.setLoading(true)
    try {
      if (fileStore.isTopLevel()) {
        const [genResult, uplResult] = await Promise.all([
          fetchArtifactList(globalSDK.url, sdk.directory, props.sessionId, "generated"),
          fetchArtifactList(globalSDK.url, sdk.directory, props.sessionId, "uploaded"),
        ])
        fileStore.setGeneratedFiles(genResult.files)
        fileStore.setUploadedFiles(uplResult.files)
      } else {
        const result = await fetchArtifactList(
          globalSDK.url,
          sdk.directory,
          props.sessionId,
          "uploaded",
          fileStore.store.currentPath,
        )
        fileStore.setUploadedFiles(result.files)
        fileStore.setGeneratedFiles([])
      }
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
        <span class="text-[14px] leading-[22px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
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
      tracker.interaction({ module: "design", name: "files-delete-file" })
    } catch (err) {
      showToast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleBatchDelete = async () => {
    const files = fileStore.selectedUploadedFiles()
    if (files.length === 0) return

    dialog.show(() => (
      <Dialog title={language.t("file.delete.title")} fit class="delete-dialog">
        <span class="text-[14px] leading-[22px] leading-[22px]" style={{ color: "rgba(0,0,0,0.9)" }}>
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
      tracker.interaction({ module: "design", name: "files-batch-delete", extend: JSON.stringify({ count: result.deleted }) })
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
      tracker.interaction({ module: "design", name: "files-batch-download", extend: JSON.stringify({ count: files.length }) })
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

      if ((window as any).api?.saveFilePicker) {
        const filePath = await (window as any).api.saveFilePicker({
          defaultPath: file.name,
        })
        if (!filePath) return
        await (window as any).api.writeFileBuffer(filePath, await blob.arrayBuffer())
        showToast({ title: "下载完成", description: file.name })
        tracker.interaction({ module: "design", name: "files-download-file" })
        return
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成", description: file.name })
      tracker.interaction({ module: "design", name: "files-download-file" })
    } catch (err) {
      showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleOpenFile = (file: ArtifactFile) => {
    props.onOpenFile(file)
    tracker.interaction({ module: "design", name: "files-open-in-tab" })
  }

  const handlePreview = (file: ArtifactFile) => {
    if (file.isFolder) return
    fileStore.setPreviewFile(file)
    tracker.interaction({ module: "design", name: "files-preview-file" })
  }

  const handleOpenInExplorer = (file: ArtifactFile) => {
    const api = (window as any).api
    if (typeof api?.showItemInFolder !== "function") {
      showToast({ title: "打开失败", description: "当前环境不支持此操作", variant: "error" })
      return
    }
    api.showItemInFolder(file.path)
    tracker.interaction({ module: "design", name: "files-open-in-explorer" })
  }

  const startRename = (file: ArtifactFile) => {
    setRenamingPath(file.path)
    setRenameDraft(file.name)
  }

  const saveRename = async (file: ArtifactFile) => {
    const newName = renameDraft().trim()
    setRenamingPath(null)
    if (!newName || newName === file.name) return

    const api = (window as any).api
    if (typeof api?.renameArtifactFile === "function") {
      try {
        await api.renameArtifactFile(file.path, newName)
        tracker.interaction({ module: "design", name: "files-rename-file" })
        await refresh()
      } catch (err) {
        showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const handleUpload = async (files: FileList) => {
    const currentPath = fileStore.isTopLevel() ? "" : fileStore.store.currentPath
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
          tracker.interaction({ module: "design", name: "files-upload-file", extend: JSON.stringify({ count: 1 }) })
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
    const currentPath = fileStore.isTopLevel() ? "" : fileStore.store.currentPath

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
        currentPath,
      )
      showToast({ title: "Uploaded folder", description: `${folderName} (${result.fileCount} files)` })
      tracker.interaction({ module: "design", name: "files-upload-folder", extend: JSON.stringify({ fileCount: result.fileCount }) })
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
    const currentPath = fileStore.isTopLevel() ? "" : fileStore.store.currentPath
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
    const currentPath = fileStore.isTopLevel() ? "" : fileStore.store.currentPath

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
        currentPath,
      )
      showToast({ title: "Uploaded folder", description: `${folderName} (${result.fileCount} files)` })
      tracker.interaction({ module: "design", name: "files-upload-folder", extend: JSON.stringify({ fileCount: result.fileCount }) })
      await refresh()
    } catch (err) {
      showToast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleSelectAllPage = () => {
    if (fileStore.allPageSelected()) {
      fileStore.clearSelection()
    } else {
      fileStore.selectAllPage()
    }
  }

  const hasAnyFiles = createMemo(() =>
    fileStore.store.generatedFiles.length > 0 || fileStore.store.uploadedFiles.length > 0)

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
            class="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
            style={{
              background: "rgba(194, 214, 255, 0.11)",
              border: "2px dashed rgba(10, 89, 247, 1)",
            }}
          >
            <img src={emptyFolderPng} style={{ width: "52px", height: "52px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
            <span
              class="text-[16px]"
              style={{ color: "#191919", "line-height": "24px", "margin-top": "12px" }}
            >
              释放鼠标上传文件
            </span>
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

        <Show when={hasAnyFiles()}>
          <DesignFilesToolbar
            fileStore={fileStore}
            onRefresh={refresh}
            onUploadFile={() => fileInputRef?.click()}
            onUploadFolder={() => folderInputRef?.click()}
            onBatchDownload={handleBatchDownload}
            onBatchDelete={handleBatchDelete}
          />
        </Show>

        <div class="flex-1 min-h-0 overflow-auto">
          <div style={{ padding: "24px" }} class="h-full">
            <Show when={hasAnyFiles()}>
              <Breadcrumb
                currentPath={fileStore.store.currentPath}
                onNavigate={(path) => fileStore.setCurrentPath(path)}
              />
            </Show>
            <Show when={fileStore.store.loading && fileStore.store.generatedFiles.length === 0 && fileStore.store.uploadedFiles.length === 0}>
            <div class="flex items-center justify-center h-full">
              <Spinner class="size-[20px]" />
            </div>
          </Show>

          <Show when={fileStore.store.error}>
            <div class="p-4 text-text-diff-delete-base text-[14px] leading-[22px]">
              Error: {fileStore.store.error}
            </div>
          </Show>

          <Show when={!fileStore.store.loading && fileStore.store.generatedFiles.length === 0 && fileStore.store.uploadedFiles.length === 0 && fileStore.isTopLevel()}>
            <div class="flex flex-col items-center justify-center h-full text-center px-8">
              <img src={emptyPng} style={{ width: "150px", height: "150px" }} alt="" draggable={false} />
              <span
                class="text-[14px] leading-[22px]"
                style={{ color: "#666", "margin-bottom": "20px" }}
              >
                {language.t("designFiles.emptyHint")}
              </span>
              <button
                type="button"
                onClick={() => fileInputRef?.click()}
                class="flex items-center justify-center gap-2 transition-colors"
                style={{
                  background: "#0a59F7",
                  color: "white",
                  "border-radius": "4px",
                  height: "32px",
                  width: "108px",
                  "font-size": "14px",
                  "line-height": "22px",
                }}
              >
                <IconUpload size={16} />
                <span>{language.t("designFiles.uploadFileAction")}</span>
              </button>
            </div>
          </Show>

          <Show when={!fileStore.isTopLevel() && !fileStore.store.loading && fileStore.store.uploadedFiles.length === 0}>
            <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <span class="text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>暂无文件</span>
              <button
                type="button"
                onClick={() => fileInputRef?.click()}
                class="flex items-center gap-2 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors"
                style={{
                  background: "var(--octo-brand)",
                  color: "white",
                }}
              >
                <IconUpload size={16} />
                <span>{language.t("designFiles.uploadFileAction")}</span>
              </button>
            </div>
          </Show>

          <Show when={hasAnyFiles()}>
            <table class="w-full text-[14px] leading-[22px]" style={{ "border-collapse": "separate", "border-spacing": "0", "table-layout": "fixed" }}>
              <thead>
                <tr style={{ background: "rgba(0, 0, 0, 0.03)", height: "56px" }}>
                  <th style={{ width: "48px", "min-width": "48px", "max-width": "48px", padding: "12px 16px", "box-sizing": "border-box", "vertical-align": "middle", "border-top-left-radius": "8px", "text-align": "left" }}>
                    <input
                      type="checkbox"
                      checked={fileStore.allPageSelected()}
                      ref={(el) => { el.indeterminate = fileStore.somePageSelected() }}
                      onChange={handleSelectAllPage}
                      style={{
                        width: "16px",
                        height: "16px",
                        "border-radius": "2px",
                        border: "1px solid rgba(147, 147, 147, 1)",
                        cursor: "pointer",
                        "accent-color": "#0a59f7",
                        "vertical-align": "middle",
                      }}
                    />
                  </th>
                  <th class="px-4 py-2 text-left" style={{ width: "45%" }}>
                    <span class="flex items-center gap-1" style={{ color: "rgba(0, 0, 0, 0.9)", "font-weight": "normal" }}>
                      {language.t("designFiles.columnName")}
                    </span>
                  </th>
                  <th class="px-4 py-2 text-left" style={{ width: "30%" }}>
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
                      style={{ color: "rgba(0, 0, 0, 0.9)", "font-weight": "normal" }}
                    >
                      {language.t("designFiles.columnKind")}
                    </button>
                  </th>
                  <th class="px-4 py-2 text-left" style={{ width: "25%" }}>
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
                      style={{ color: "rgba(0, 0, 0, 0.9)", "font-weight": "normal" }}
                    >
                      {language.t("designFiles.columnModified")}
                      <IconSortArrow size={14} dir={fileStore.store.sortDir} active={fileStore.store.sortKey === "mtime"} />
                    </button>
                  </th>
                  <th class="px-4 py-2" style={{ width: "60px", "border-top-right-radius": "8px" }}></th>
                </tr>
              </thead>
              <tbody>
                <Show when={fileStore.isTopLevel()}>
                  <SectionRow
                    title="生成文件"
                    count={fileStore.store.generatedFiles.length}
                    collapsed={fileStore.store.collapsedGenerated}
                    onToggle={() => fileStore.toggleGeneratedSection()}
                  />
                  <Show when={!fileStore.store.collapsedGenerated}>
                    <KindGroupRows
                      kindGroupEntries={fileStore.generated.kindGroupEntries()}
                      modifiedGroups={fileStore.generated.modifiedGroups()}
                      visibleModifiedSections={fileStore.generated.visibleModifiedSections()}
                      collapsedSections={fileStore.store.collapsedSections}
                      groupMode={fileStore.store.groupMode}
                      sectionKey="generated"
                      selected={fileStore.store.selected}
                      renamingPath={renamingPath()}
                      renameDraft={renameDraft()}
                      setRenamingPath={setRenamingPath}
                      setRenameDraft={setRenameDraft}
                      saveRename={saveRename}
                      startRename={startRename}
                      onToggleSection={(key) => fileStore.toggleSection(key)}
                      onToggleSelection={(file) => fileStore.toggleFileSelection(file.path)}
                      onPreview={handlePreview}
                      onOpen={handleOpenFile}
                      onDownload={handleDownload}
                      onOpenInExplorer={handleOpenInExplorer}
                      onAddToSession={props.onAddToSession}
                      language={language}
                    />
                  </Show>

                  <SectionRow
                    title="上传文件"
                    count={fileStore.store.uploadedFiles.length}
                    collapsed={fileStore.store.collapsedUploaded}
                    onToggle={() => fileStore.toggleUploadedSection()}
                  />
                  <Show when={!fileStore.store.collapsedUploaded}>
                    <KindGroupRows
                      kindGroupEntries={fileStore.uploaded.kindGroupEntries()}
                      modifiedGroups={fileStore.uploaded.modifiedGroups()}
                      visibleModifiedSections={fileStore.uploaded.visibleModifiedSections()}
                      collapsedSections={fileStore.store.collapsedSections}
                      groupMode={fileStore.store.groupMode}
                      sectionKey="uploaded"
                      selected={fileStore.store.selected}
                      renamingPath={renamingPath()}
                      renameDraft={renameDraft()}
                      setRenamingPath={setRenamingPath}
                      setRenameDraft={setRenameDraft}
                      saveRename={saveRename}
                      startRename={startRename}
                      onToggleSection={(key) => fileStore.toggleSection(key)}
                      onToggleSelection={(file) => fileStore.toggleFileSelection(file.path)}
                      onPreview={handlePreview}
                      onOpen={handleOpenFile}
                      onDelete={handleDelete}
                      onDownload={handleDownload}
                      onOpenInExplorer={handleOpenInExplorer}
                      onNavigateFolder={(folder) => fileStore.navigateToFolder(folder)}
                      onAddToSession={props.onAddToSession}
                      language={language}
                    />
                  </Show>
                </Show>

                <Show when={!fileStore.isTopLevel()}>
                  <KindGroupRows
                    kindGroupEntries={fileStore.uploaded.kindGroupEntries()}
                    modifiedGroups={fileStore.uploaded.modifiedGroups()}
                    visibleModifiedSections={fileStore.uploaded.visibleModifiedSections()}
                    collapsedSections={fileStore.store.collapsedSections}
                    groupMode={fileStore.store.groupMode}
                    sectionKey=""
                    selected={fileStore.store.selected}
                    renamingPath={renamingPath()}
                    renameDraft={renameDraft()}
                    setRenamingPath={setRenamingPath}
                    setRenameDraft={setRenameDraft}
                    saveRename={saveRename}
                    startRename={startRename}
                    onToggleSection={(key) => fileStore.toggleSection(key)}
                    onToggleSelection={(file) => fileStore.toggleFileSelection(file.path)}
                    onPreview={handlePreview}
                    onOpen={handleOpenFile}
                    onDelete={handleDelete}
                    onDownload={handleDownload}
                    onOpenInExplorer={handleOpenInExplorer}
                    onNavigateFolder={(folder) => fileStore.navigateToFolder(folder)}
                    onAddToSession={props.onAddToSession}
                    language={language}
                  />
                </Show>
              </tbody>
            </table>
          </Show>
          </div>
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

function SectionRow(props: {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <tr class="df-section-row" style={{ background: "var(--octo-surface-page)", height: "54px" }}>
      <td colSpan={5} class="px-2 py-1" style={{ "border-bottom": props.collapsed ? "1px solid rgba(0, 0, 0, 0.1)" : "none" }}>
        <button
          type="button"
          onClick={props.onToggle}
          class="flex items-center gap-2 w-full"
          style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "14px", "line-height": "22px" }}
        >
          <IconChevronDown
            size={16}
            style={{ transform: props.collapsed ? "rotate(-90deg)" : "none" }}
          />
          <span class="font-medium">{props.title}</span>
        </button>
      </td>
    </tr>
  )
}

function KindGroupRows(props: {
  kindGroupEntries: Array<[ArtifactFileKind, ArtifactFile[]]>
  modifiedGroups: Record<ModifiedSection, ArtifactFile[]>
  visibleModifiedSections: ModifiedSection[]
  collapsedSections: Set<string>
  groupMode: GroupMode
  sectionKey: string
  selected: Set<string>
  renamingPath: string | null
  renameDraft: string
  setRenamingPath: (v: string | null) => void
  setRenameDraft: (v: string) => void
  saveRename: (file: ArtifactFile) => void
  startRename: (file: ArtifactFile) => void
  onToggleSection: (key: string) => void
  onToggleSelection: (file: ArtifactFile) => void
  onPreview: (file: ArtifactFile) => void
  onOpen: (file: ArtifactFile) => void
  onDelete?: (file: ArtifactFile) => void
  onDownload?: (file: ArtifactFile) => void
  onOpenInExplorer: (file: ArtifactFile) => void
  onNavigateFolder?: (folder: ArtifactFile) => void
  onAddToSession?: (file: ArtifactFile) => void
  language: ReturnType<typeof useLanguage>
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.groupMode === "kind"}>
        <For each={props.kindGroupEntries}>
          {([kind, files]) => {
            const sectionKey = props.sectionKey ? `${props.sectionKey}-${kind}` : kind
            return (
              <>
                <tr class="df-section-row" style={{ background: "var(--octo-surface-page)", height: "54px" }}>
                  <td colSpan={5} class="px-2 py-1" style={{ "border-bottom": props.collapsedSections.has(sectionKey) ? "1px solid rgba(0, 0, 0, 0.1)" : "none" }}>
                    <button
                      type="button"
                      onClick={() => props.onToggleSection(sectionKey)}
                      class="flex items-center gap-2 w-full"
                      style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "14px", "line-height": "22px" }}
                    >
                      <IconChevronDown
                        size={16}
                        style={{ transform: props.collapsedSections.has(sectionKey) ? "rotate(-90deg)" : "none" }}
                      />
                      <span class="font-medium">{props.language.t(kindToI18nKey(kind))}</span>
                    </button>
                  </td>
                </tr>
                <Show when={!props.collapsedSections.has(sectionKey)}>
                  <For each={files}>
                    {(file) => (
                      <FileRow
                        file={file}
                        selected={props.selected.has(file.path)}
                        renaming={props.renamingPath === file.path}
                        renameDraft={props.renameDraft}
                        onToggleSelection={() => props.onToggleSelection(file)}
                        onPreview={() => props.onPreview(file)}
                        onOpen={() => props.onOpen(file)}
                        onDelete={props.onDelete ? () => props.onDelete!(file) : undefined}
                        onDownload={file.isFolder ? undefined : () => props.onDownload?.(file)}
                        onOpenInExplorer={() => props.onOpenInExplorer(file)}
                        onNavigateFolder={props.onNavigateFolder && file.isFolder ? () => props.onNavigateFolder!(file) : undefined}
                        onAddToSession={props.onAddToSession && !file.isFolder ? () => props.onAddToSession!(file) : undefined}
                        onRename={() => props.startRename(file)}
                        onRenameInput={(v) => props.setRenameDraft(v)}
                        onRenameKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") { e.preventDefault(); void props.saveRename(file) }
                          if (e.key === "Escape") { e.preventDefault(); props.setRenamingPath(null) }
                        }}
                        onRenameBlur={() => void props.saveRename(file)}
                      />
                    )}
                  </For>
                </Show>
              </>
            )
          }}
        </For>
      </Match>
      <Match when={props.groupMode === "modified"}>
        <For each={props.visibleModifiedSections}>
          {(section) => {
            const sectionKey = props.sectionKey ? `${props.sectionKey}-${section}` : section
            const files = props.modifiedGroups[section]
            return (
              <>
                <tr class="df-section-row" style={{ background: "var(--octo-surface-page)", height: "54px" }}>
                  <td colSpan={5} class="px-2 py-1" style={{ "border-bottom": props.collapsedSections.has(sectionKey) ? "1px solid rgba(0, 0, 0, 0.1)" : "none" }}>
                    <button
                      type="button"
                      onClick={() => props.onToggleSection(sectionKey)}
                      class="flex items-center gap-2 w-full"
                      style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "14px", "line-height": "22px" }}
                    >
                      <IconChevronDown
                        size={16}
                        style={{ transform: props.collapsedSections.has(sectionKey) ? "rotate(-90deg)" : "none" }}
                      />
                      <span class="font-medium">{props.language.t(modifiedSectionToI18nKey(section))}</span>
                    </button>
                  </td>
                </tr>
                <Show when={!props.collapsedSections.has(sectionKey)}>
                  <For each={files}>
                    {(file) => (
                      <FileRow
                        file={file}
                        selected={props.selected.has(file.path)}
                        renaming={props.renamingPath === file.path}
                        renameDraft={props.renameDraft}
                        onToggleSelection={() => props.onToggleSelection(file)}
                        onPreview={() => props.onPreview(file)}
                        onOpen={() => props.onOpen(file)}
                        onDelete={props.onDelete ? () => props.onDelete!(file) : undefined}
                        onDownload={file.isFolder ? undefined : () => props.onDownload?.(file)}
                        onOpenInExplorer={() => props.onOpenInExplorer(file)}
                        onNavigateFolder={props.onNavigateFolder && file.isFolder ? () => props.onNavigateFolder!(file) : undefined}
                        onAddToSession={props.onAddToSession && !file.isFolder ? () => props.onAddToSession!(file) : undefined}
                        onRename={() => props.startRename(file)}
                        onRenameInput={(v) => props.setRenameDraft(v)}
                        onRenameKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") { e.preventDefault(); void props.saveRename(file) }
                          if (e.key === "Escape") { e.preventDefault(); props.setRenamingPath(null) }
                        }}
                        onRenameBlur={() => void props.saveRename(file)}
                      />
                    )}
                  </For>
                </Show>
              </>
            )
          }}
        </For>
      </Match>
    </Switch>
  )
}

function FileRow(props: {
  file: ArtifactFile
  selected: boolean
  renaming: boolean
  renameDraft: string
  onToggleSelection: () => void
  onPreview: () => void
  onOpen: () => void
  onDelete?: () => void
  onDownload?: () => void
  onOpenInExplorer: () => void
  onNavigateFolder?: () => void
  onAddToSession?: () => void
  onRename: () => void
  onRenameInput: (v: string) => void
  onRenameKeyDown: (e: KeyboardEvent) => void
  onRenameBlur: () => void
}): JSX.Element {
  const language = useLanguage()
  const [showMenu, setShowMenu] = createSignal(false)

  return (
    <tr
      class="transition-colors cursor-pointer"
      style={{
        background: props.selected ? "rgba(10, 89, 247, 0.05)" : "transparent",
        height: "78px",
      }}
      onMouseEnter={(e) => {
        if (!props.selected) e.currentTarget.style.background = "rgba(10, 89, 247, 0.05)"
      }}
      onMouseLeave={(e) => {
        if (!props.selected) e.currentTarget.style.background = "transparent"
      }}
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement) return
        if (e.target instanceof HTMLButtonElement) return
        if (props.file.isFolder) {
          props.onNavigateFolder?.()
          tracker.interaction({ module: "design", name: "files-navigate-folder" })
        } else {
          props.onPreview()
        }
      }}
    >
      <td style={{ width: "48px", "min-width": "48px", "max-width": "48px", padding: "12px 16px", "box-sizing": "border-box", "vertical-align": "middle", "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}>
        <input
          type="checkbox"
          checked={props.selected}
          onChange={props.onToggleSelection}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "16px",
            height: "16px",
            "border-radius": "2px",
            border: "1px solid rgba(147, 147, 147, 1)",
            cursor: "pointer",
            "vertical-align": "middle",
            "accent-color": "#0a59f7",
          }}
        />
      </td>
      <td class="px-4 truncate max-w-[200px]" title={props.file.name} style={{ color: "rgba(0, 0, 0, 0.9)", "vertical-align": "middle", "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}>
        <Show when={!props.renaming} fallback={
          <input
            value={props.renameDraft}
            onInput={(e) => props.onRenameInput(e.currentTarget.value)}
            onKeyDown={(e) => props.onRenameKeyDown(e)}
            onBlur={() => props.onRenameBlur()}
            onClick={(e) => e.stopPropagation()}
            class="w-full text-[14px] leading-[22px] px-1 py-0.5 rounded"
            style={{ border: "1px solid #0a59f7", outline: "none" }}
          />
        }>
          <div class="flex items-center" style={{ gap: "10px" }}>
            {(() => {
              const FileIcon = getFileIcon(props.file.kind, props.file.name)
              return <FileIcon size={32} />
            })()}
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="truncate">{props.file.name}</span>
              <Show when={!props.file.isFolder}>
                <span class="text-[14px]" style={{ color: "var(--octo-text-secondary)" }}>
                  {formatFileSize(props.file.size)}
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </td>
      <td class="px-4 text-[14px] leading-[22px]" style={{ color: "rgba(0, 0, 0, 0.9)", "vertical-align": "middle", "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}>
        {language.t(kindToI18nKey(props.file.kind))}
      </td>
      <td class="px-4 text-[14px] leading-[22px]" style={{ color: "rgba(0, 0, 0, 0.9)", "vertical-align": "middle", "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}>
        {formatTimestamp(props.file.mtime, language.t)}
      </td>
      <td class="w-[60px] px-4" style={{ "vertical-align": "middle", "border-bottom": "1px solid rgba(0, 0, 0, 0.1)" }}>
        <Kobalte open={showMenu()} onOpenChange={setShowMenu} modal={false} placement="bottom-end" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            onClick={(e) => e.stopPropagation()}
            class="flex items-center justify-center size-7 rounded-[4px] transition-colors hover:bg-[rgba(0,0,0,0.03)]"
            classList={{ "bg-[rgba(0,0,0,0.03)]": showMenu() }}
            style={{ color: "rgba(0,0,0,0.6)" }}
          >
            <IconTableEllipsis size={16} />
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 rounded-[12px] p-2"
              style={{ "box-shadow": "0 4px 12px 0 rgba(0,0,0,0.16)", width: "183px", "background-color": "#fff" }}
            >
              <Show when={props.onAddToSession}>
                <button
                  type="button"
                  onClick={() => {
                    props.onAddToSession!()
                    tracker.interaction({ module: "design", name: "files-add-to-session" })
                    setShowMenu(false)
                  }}
                  class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                  style={{ color: "rgba(0,0,0,0.9)" }}
                >
                  添加至会话区
                </button>
                <div style={{ height: "1px", background: "rgba(0, 0, 0, 0.1)", margin: "4px 0" }} />
              </Show>
              <Show when={!props.file.isFolder}>
                <button
                  type="button"
                  onClick={() => {
                    props.onOpen()
                    setShowMenu(false)
                  }}
                  class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                  style={{ color: "rgba(0,0,0,0.9)" }}
                >
                  在标签页中打开
                </button>
              </Show>
              <Show when={typeof (window as any).api?.showItemInFolder === "function"}>
                <button
                  type="button"
                  onClick={() => {
                    props.onOpenInExplorer()
                    setShowMenu(false)
                  }}
                  class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                  style={{ color: "rgba(0,0,0,0.9)" }}
                >
                  打开所在文件夹
                </button>
              </Show>
              <button
                type="button"
                onClick={() => {
                  props.onRename()
                  setShowMenu(false)
                }}
                class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                style={{ color: "rgba(0,0,0,0.9)" }}
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
                  class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                  style={{ color: "rgba(0,0,0,0.9)" }}
                >
                  下载
                </button>
              </Show>
              <Show when={props.onDelete}>
                <div style={{ height: "1px", background: "rgba(0, 0, 0, 0.1)", margin: "4px 0" }} />
                <button
                  type="button"
                  onClick={() => {
                    props.onDelete!()
                    setShowMenu(false)
                  }}
                  class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] hover:bg-[#eee] transition-colors"
                  style={{ color: "#E02128", "margin-bottom": "4px" }}
                >
                  删除
                </button>
              </Show>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </td>
    </tr>
  )
}
