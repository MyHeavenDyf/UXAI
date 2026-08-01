// SPEC-INS-014 §10 / §10.1:「文件管理」——viewMode==="files" 时替换 ResultViewer 整个内容区。
// 功能对齐站内 Design 模块(make/components/design-files/design-files-panel.tsx):
//   面包屑 + 文件夹导航 + 右侧预览面板 + 批量下载/删除 + 上传(文件夹/文件) + 5 项行操作菜单。
// 数据源走 .octo/<sessionId>/{uploads,outputs}/(uploads 支持子文件夹导航);content/delete/archive
// 复用 artifact 分组同款端点(按绝对 path),upload/upload-folder 走 insight 专属端点。
// insight 自包含:不 import make 目录下的组件;图标用 design-files-icons(拷贝自 make)。
// 颜色/圆角统一走 --octo-* 主题变量。

import { createEffect, createMemo, createSignal, For, Show, Switch, Match, on, batch } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { Spinner } from "@opencode-ai/ui/spinner"
import { tracker } from "@/utils/tracker"
import { useParams } from "@solidjs/router"
import {
  fetchInsightFiles,
  toInsightFile,
  fetchInsightContent,
  deleteInsightFile,
  deleteInsightBatch,
  archiveInsightFiles,
  uploadInsightFile,
  uploadInsightFolder,
  pathToLocalUrl,
  kindLabel,
  formatFileSize,
  formatTimeAgo,
  type InsightFile,
  type InsightFileEntry,
  type InsightFolderUploadFile,
} from "../../utils/insight-file-api"
import {
  createInsightFileStore,
  MODIFIED_SECTION_LABELS,
  type GroupMode,
  type ModifiedSection,
  type SortKey,
} from "../../utils/insight-file-store"
import { revealFileInFolder } from "../../utils/local-file-ops"
import { getDesktopApi } from "../../lib/electron-api"
import { getFileIcon } from "../../icons/file-type-icons"
import emptyPng from "../../icons/empty.png"
import emptyFolderPng from "../../icons/empty_folder.png"
import { IconChevronDown, IconSortArrow, IconTableEllipsis, IconUpload } from "../../icons/design-files-icons"
import { ALLOWED_EXT, getExt } from "../../lib/upload"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { FileManagerToolbar } from "./toolbar"
import { Breadcrumb } from "./breadcrumb"
import { PreviewPane } from "./preview-pane"
import { ArchiveDialogs, type ArchiveTarget } from "../archive-flow"

// 把文件管理列表中的非 HTML InsightFile 转成归档 file target(本地读盘 / uri 拉取 → EdmUtil.upload)。
// HTML 归档只在 result-viewer ActionBar 提供(那里有 live iframe 可截图,且避免对用户上传目录整包打包),故本入口不处理 HTML。
function insightFileToArchiveTarget(file: InsightFile, sdkUrl: string, sdkDirectory: string, sessionId: string): ArchiveTarget {
  return {
    mode: "file",
    sessionId,
    projectDir: sdkDirectory,
    fileName: file.name,
    filePath: file.path,
    getFile: async () => {
      const api = getDesktopApi()
      if (api?.readFileBuffer) {
        try {
          const buf = await api.readFileBuffer(file.path)
          if (buf) return new File([buf], file.name, { type: file.mime || undefined })
        } catch (err) {
          console.warn("[octo:archive] read-local-failed", { path: file.path, err })
        }
      }
      // 兜底:走 SDK content 端点(非桌面端 / 读盘失败),base64 解码为二进制 → File。
      try {
        const c = await fetchInsightContent(sdkUrl, sdkDirectory, file.path)
        if (c.encoding === "base64") {
          const binary = atob(c.content)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          return new File([bytes], file.name, { type: c.mimeType || file.mime || undefined })
        }
        return new File([c.content], file.name, { type: c.mimeType || file.mime || undefined })
      } catch (err) {
        console.warn("[octo:archive] fetch-content-failed", { path: file.path, err })
      }
      return null
    },
  }
}

export function InsightFileManager(props: {
  refreshKey?: number
  onOpenFile: (file: InsightFileEntry) => void
  onAddToSession?: (file: InsightFile) => void
  onCloseTabsByPath?: (paths: string[]) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
  onFilesRefresh?: () => void
}): JSX.Element {
  const params = useParams<{ id?: string }>()
  return (
    <Show when={params.id} fallback={<NoSessionEmpty />} keyed>
      {(sessionId) => (
        <FileManagerInner
          sessionId={sessionId}
          refreshKey={props.refreshKey}
          onOpenFile={props.onOpenFile}
          onAddToSession={props.onAddToSession}
          onCloseTabsByPath={props.onCloseTabsByPath}
          onRemoveAttachmentsByPath={props.onRemoveAttachmentsByPath}
          onFilesRefresh={props.onFilesRefresh}
        />
      )}
    </Show>
  )
}

function FileManagerInner(props: {
  sessionId: string
  refreshKey?: number
  onOpenFile: (file: InsightFileEntry) => void
  onAddToSession?: (file: InsightFile) => void
  onCloseTabsByPath?: (paths: string[]) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
  onFilesRefresh?: () => void
}): JSX.Element {
  const sdk = useSDK()
  const dialog = useDialog()
  const fileStore = createInsightFileStore()
  const store = () => fileStore.store
  const [isDragOver, setIsDragOver] = createSignal(false)
  let fileInputRef!: HTMLInputElement
  let folderInputRef!: HTMLInputElement

  // 切会话 / 切路径 → 重置并刷新。sessionId 变化时清掉路径/筛选/两段文件,避免残留。
  createEffect(on(
    [() => props.sessionId, () => store().currentPath],
    ([sid, path], prev) => {
      if (prev && prev[0] !== sid) {
        // 切会话:清筛选/两段文件;若之前不在顶层,重置 currentPath 会再次触发本 effect(path 依赖),
        // 由那次触发统一 refresh,这里 return 掉,避免同一次切会话拉两遍。
        const wasInSubFolder = path !== ""
        batch(() => {
          fileStore.setCurrentPath("")
          fileStore.clearKindFilter()
          fileStore.setGeneratedFiles([])
          fileStore.setUploadedFiles([])
        })
        if (wasInSubFolder) return
      }
      void refresh()
    },
  ))

  const refresh = async () => {
    fileStore.setLoading(true)
    try {
      if (fileStore.isTopLevel()) {
        const [outputs, uploads] = await Promise.all([
          fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "outputs"),
          fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "uploads"),
        ])
        fileStore.setGeneratedFiles(outputs.map(toInsightFile))
        fileStore.setUploadedFiles(uploads.map(toInsightFile))
      } else {
        const uploads = await fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "uploads", store().currentPath)
        fileStore.setUploadedFiles(uploads.map(toInsightFile))
        fileStore.setGeneratedFiles([])
      }
      fileStore.setError(null)
    } catch (err) {
      fileStore.setError(err instanceof Error ? err.message : String(err))
    } finally {
      fileStore.setLoading(false)
    }
  }

  // 外部触发刷新(如对话上传文件落地会话目录后,父组件递增 refreshKey)。defer 避免与挂载时的
  // session/path effect 重复拉取;仅响应后续 refreshKey 变化(对齐 make design-files-panel 的 refreshKey 机制)。
  createEffect(on(() => props.refreshKey, () => { void refresh() }, { defer: true }))

  // ── 上传 ────────────────────────────────────────────────────────
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

  async function uploadSingleFile(file: File) {
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    const base64 = await readFileAsBase64(file)
    try {
      await uploadInsightFile(sdk.url, sdk.directory, props.sessionId, file.name, base64, currentPath)
      showToast({ title: "上传完成", description: file.name, variant: "success", duration: 2000 })
      await refresh()
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "上传失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  async function handleUpload(files: FileList) {
    for (const file of Array.from(files)) {
      await uploadSingleFile(file)
    }
  }

  async function handleFolderUpload(files: FileList) {
    if (!files || files.length === 0) return
    const firstFile = files[0]
    const folderName = firstFile.webkitRelativePath?.split("/")[0]
    if (!folderName) {
      showToast({ title: "上传失败", description: "无法识别文件夹名", variant: "error" })
      return
    }
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    const fileEntries: InsightFolderUploadFile[] = []
    for (const file of Array.from(files)) {
      const relativePath = file.webkitRelativePath.slice(folderName.length + 1)
      const base64 = await readFileAsBase64(file)
      fileEntries.push({ relativePath, content: base64 })
    }
    try {
      const result = await uploadInsightFolder(sdk.url, sdk.directory, props.sessionId, folderName, fileEntries, currentPath)
      showToast({ title: "上传完成", description: `${folderName} (${result.fileCount} 个文件)`, variant: "success", duration: 2000 })
      await refresh()
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "上传失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  // 拖拽上传:支持整文件夹(DataTransferItem + webkitGetAsEntry 递归)。
  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    const t = e.currentTarget as HTMLElement
    if (!t) return
    const r = t.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setIsDragOver(false)
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
      if (files && files.length > 0) void handleUpload(files)
    }
  }
  async function processEntries(entries: FileSystemEntry[]) {
    for (const entry of entries) {
      if (entry.isDirectory) await processDirectoryEntry(entry as FileSystemDirectoryEntry)
      else if (entry.isFile) await processFileEntry(entry as FileSystemFileEntry)
    }
  }
  async function processDirectoryEntry(dirEntry: FileSystemDirectoryEntry) {
    const folderName = dirEntry.name
    const fileEntries: InsightFolderUploadFile[] = []
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    async function collectFiles(entry: FileSystemEntry) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry as FileSystemFileEntry)
        const relativePath = entry.fullPath.slice(1 + folderName.length)
        const base64 = await readFileAsBase64(file)
        fileEntries.push({ relativePath, content: base64 })
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const childEntries = await readAllDirectoryEntries(reader)
        for (const child of childEntries) await collectFiles(child)
      }
    }
    const reader = dirEntry.createReader()
    const entries = await readAllDirectoryEntries(reader)
    for (const entry of entries) await collectFiles(entry)
    if (fileEntries.length === 0) return
    try {
      const result = await uploadInsightFolder(sdk.url, sdk.directory, props.sessionId, folderName, fileEntries, currentPath)
      showToast({ title: "上传完成", description: `${folderName} (${result.fileCount} 个文件)`, variant: "success", duration: 2000 })
      await refresh()
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "上传失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }
  async function processFileEntry(fileEntry: FileSystemFileEntry) {
    const file = await getFileFromEntry(fileEntry)
    await uploadSingleFile(file)
  }
  async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const entries: FileSystemEntry[] = []
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      entries.push(...batch)
    }
    return entries
  }
  function getFileFromEntry(fileEntry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve) => fileEntry.file(resolve))
  }

  // ── 下载 ────────────────────────────────────────────────────────
  async function handleDownload(file: InsightFile) {
    try {
      const content = await fetchInsightContent(sdk.url, sdk.directory, file.path)
      const blob = content.encoding === "base64"
        ? await fetch(`data:${content.mimeType};base64,${content.content}`).then((r) => r.blob())
        : new Blob([content.content], { type: content.mimeType })
      const api = getDesktopApi()
      if (api?.saveFilePicker) {
        const filePath = await api.saveFilePicker({ defaultPath: file.name })
        if (!filePath) return
        await api.writeFileBuffer!(filePath, await blob.arrayBuffer())
        showToast({ title: "下载完成", description: file.name, variant: "success", duration: 2000 })
        tracker.interaction({ module: "insight", name: "files-download-file" })
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成", description: file.name, variant: "success", duration: 2000 })
      tracker.interaction({ module: "insight", name: "files-download-file" })
    } catch (err) {
      showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  async function handleBatchDownload() {
    const files = Array.from(store().selected)
    if (files.length === 0) return
    try {
      const blob = await archiveInsightFiles(sdk.url, sdk.directory, files)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `insight-files-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      tracker.interaction({ module: "insight", name: "files-batch-download", extend: JSON.stringify({ count: files.length }) })
    } catch (err) {
      showToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  // ── 删除 ────────────────────────────────────────────────────────
  function showDeleteDialog(body: JSX.Element, onConfirm: () => void) {
    dialog.show(() => (
      <Dialog title="删除文件" fit class="delete-dialog">
        {body}
        <div class="flex justify-end gap-2" style={{ "margin-top": "12px" }}>
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>取消</Button>
          <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={() => { onConfirm(); dialog.close() }}>删除</Button>
        </div>
      </Dialog>
    ))
  }

  function handleDelete(file: InsightFile) {
    showDeleteDialog(
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)" }}>确定删除 {file.name}?</span>,
      () => void doDelete(file),
    )
  }

  async function doDelete(file: InsightFile) {
    try {
      await deleteInsightFile(sdk.url, sdk.directory, file.path)
      fileStore.deleteFile(file.path)
      props.onCloseTabsByPath?.([file.path])
      props.onRemoveAttachmentsByPath?.([file.path])
      showToast({ title: "已删除", description: file.name, variant: "success", duration: 2000 })
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  function handleBatchDelete() {
    const files = Array.from(store().selected)
    if (files.length === 0) return
    showDeleteDialog(
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)" }}>确定删除选中的 {files.length} 个文件?</span>,
      () => void doBatchDelete(files),
    )
  }

  async function doBatchDelete(paths: string[]) {
    try {
      const result = await deleteInsightBatch(sdk.url, sdk.directory, paths)
      for (const path of paths) fileStore.deleteFile(path)
      if (fileStore.previewFile() && paths.includes(fileStore.previewFile()!.path)) fileStore.setPreviewFile(null)
      fileStore.clearSelection()
      props.onCloseTabsByPath?.(paths)
      props.onRemoveAttachmentsByPath?.(paths)
      showToast({ title: "已删除", description: `${result.deleted} 个文件`, variant: "success", duration: 2000 })
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  // ── 预览 / 打开 ────────────────────────────────────────────────
  // 单击文件 → 右侧预览面板(对齐 make design-files-panel handlePreview)。
  function handlePreview(file: InsightFile) {
    if (file.isFolder) return
    fileStore.setPreviewFile(file)
    tracker.interaction({ module: "insight", name: "files-preview-file" })
  }
  function handleOpenFile(file: InsightFile) {
    props.onOpenFile(file)
    tracker.interaction({ module: "insight", name: "files-open-in-tab" })
  }
  function handleAddToSession(file: InsightFile) {
    props.onAddToSession?.(file)
    tracker.interaction({ module: "insight", name: "files-add-to-session" })
  }
  function handleOpenInExplorer(file: InsightFile) {
    void revealFileInFolder(file.path)
    tracker.interaction({ module: "insight", name: "files-open-in-explorer" })
  }

  // ── 归档(列表行 `…` 菜单入口;逻辑抽到 ../archive-flow)───────────────────────
  const [archiveTarget, setArchiveTarget] = createSignal<ArchiveTarget | null>(null)
  const [archiveDialogOpen, setArchiveDialogOpen] = createSignal(false)
  function handleArchiveFile(file: InsightFile) {
    setArchiveTarget(insightFileToArchiveTarget(file, sdk.url, sdk.directory || "", props.sessionId))
    setArchiveDialogOpen(true)
    tracker.interaction({ module: "insight", name: "files-archive", extend: JSON.stringify({ kind: file.kind }) })
  }

  function handleHeaderSort(key: SortKey) {
    if (store().sortKey === key) fileStore.setSortDir(store().sortDir === "asc" ? "desc" : "asc")
    else { fileStore.setSortKey(key); fileStore.setSortDir(key === "mtime" ? "desc" : "asc") }
  }
  const handleSelectAllPage = () => fileStore.selectAllPage()

  const hasAnyFiles = createMemo(() => store().uploadedFiles.length > 0 || store().generatedFiles.length > 0)
  const showInitialSpinner = createMemo(() => store().loading && !hasAnyFiles() && !store().error)

  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <Show when={hasAnyFiles()}>
        <FileManagerToolbar
          fileStore={fileStore}
          onRefresh={refresh}
          onUploadFile={() => fileInputRef?.click()}
          onUploadFolder={() => folderInputRef?.click()}
          onBatchDownload={handleBatchDownload}
          onBatchDelete={handleBatchDelete}
        />
      </Show>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <div
          class="flex flex-col flex-1 min-w-0 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            multiple
            ref={fileInputRef}
            class="hidden"
            onChange={(e) => { if (e.currentTarget.files) { void handleUpload(e.currentTarget.files); e.currentTarget.value = "" } }}
          />
          <input
            type="file"
            ref={folderInputRef}
            // @ts-ignore - webkitdirectory 非标准但广泛支持
            webkitdirectory=""
            class="hidden"
            onChange={(e) => { if (e.currentTarget.files) { void handleFolderUpload(e.currentTarget.files); e.currentTarget.value = "" } }}
          />

          <Show when={isDragOver()}>
            <div
              class="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
              style={{ background: "var(--octo-brand-a8)", border: "2px dashed var(--octo-brand)" }}
            >
              <img src={emptyFolderPng} style={{ width: "52px", height: "52px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
              <span class="text-[16px]" style={{ color: "var(--octo-text-primary)", "line-height": "24px", "margin-top": "12px" }}>释放鼠标上传文件</span>
            </div>
          </Show>

          <Switch>
          <Match when={store().error}>
            <div class="flex flex-col items-center justify-center flex-1 min-h-0 gap-2" style={{ "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)" }}>
              <span>加载文件列表失败</span>
              <button
                type="button"
                onClick={() => void refresh()}
                class="flex items-center justify-center gap-2 transition-colors"
                style={{ background: "var(--octo-brand)", color: "white", "border-radius": "var(--octo-radius-sm)", height: "32px", width: "108px", "font-size": "14px", "line-height": "22px", cursor: "pointer" }}
              >
                重试
              </button>
            </div>
          </Match>
          <Match when={showInitialSpinner()}>
            <div class="flex items-center justify-center flex-1 min-h-0"><Spinner class="size-[20px]" /></div>
          </Match>
          <Match when={!hasAnyFiles()}>
            <div class="flex flex-col items-center justify-center flex-1 min-h-0 text-center px-8">
              <img src={emptyPng} style={{ width: "150px", height: "150px" }} alt="" draggable={false} />
              <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-secondary)", "margin-bottom": "20px" }}>暂无内容，点击上传新增文件吧</span>
              <button
                type="button"
                onClick={() => fileInputRef?.click()}
                class="flex items-center justify-center gap-2 transition-colors"
                style={{ background: "var(--octo-brand)", color: "white", "border-radius": "var(--octo-radius-sm)", height: "32px", width: "108px", "font-size": "14px", "line-height": "22px", cursor: "pointer" }}
              >
                <IconUpload size={16} style={{ color: "white" }} />
                <span>上传文件</span>
              </button>
            </div>
          </Match>
          <Match when={hasAnyFiles()}>
            <div class="flex flex-col flex-1 min-h-0">
              {/* 面包屑固定:不随表格滚动 */}
              <div class="shrink-0" style={{ padding: "24px 24px 0" }}>
                <Breadcrumb currentPath={store().currentPath} onNavigate={(p) => fileStore.setCurrentPath(p)} />
              </div>
              {/* 只滚动表格内容:表头 sticky 吸顶(吸附到本滚动容器顶部,即面包屑下方) */}
              <div class="flex-1 min-h-0 overflow-auto">
                <div style={{ padding: "0 24px 24px" }}>
                  <FileTable
                    fileStore={fileStore}
                    onHeaderSort={handleHeaderSort}
                    onSelectAllPage={handleSelectAllPage}
                    onOpen={handleOpenFile}
                    onPreview={handlePreview}
                    onAddToSession={props.onAddToSession ? handleAddToSession : undefined}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onArchive={handleArchiveFile}
                    onOpenInExplorer={handleOpenInExplorer}
                    onNavigateFolder={(f) => fileStore.navigateToFolder(f)}
                  />
                </div>
              </div>
            </div>
          </Match>
        </Switch>
        </div>

        {/* 右侧预览面板:单击文件行触发(对齐 make design-files-panel.tsx 的同款布局)。 */}
        <Show when={fileStore.previewFile()}>
          {(file) => (
            <PreviewPane
              file={file()}
              sdkUrl={sdk.url}
              sdkDirectory={sdk.directory || ""}
              onClose={() => fileStore.setPreviewFile(null)}
              onOpen={() => handleOpenFile(file())}
              onDownload={() => handleDownload(file())}
            />
          )}
        </Show>
      </div>

      <ArchiveDialogs
        target={archiveTarget()}
        open={archiveDialogOpen()}
        onClose={() => setArchiveDialogOpen(false)}
      />
    </div>
  )
}

// ── 表格 ──────────────────────────────────────────────────────────
function FileTable(props: {
  fileStore: ReturnType<typeof createInsightFileStore>
  onHeaderSort: (key: SortKey) => void
  onSelectAllPage: () => void
  onOpen: (file: InsightFile) => void
  onPreview: (file: InsightFile) => void
  onAddToSession?: (file: InsightFile) => void
  onDownload: (file: InsightFile) => void
  onDelete: (file: InsightFile) => void
  onArchive?: (file: InsightFile) => void
  onOpenInExplorer: (file: InsightFile) => void
  onNavigateFolder: (folder: InsightFile) => void
}): JSX.Element {
  const store = () => props.fileStore.store
  let selectAllRef!: HTMLInputElement
  // indeterminate 是 DOM 属性(非标准 attribute),ref 回调只在挂载跑一次无法响应;
  // 用 createEffect 跟踪 somePageSelected() 变化,选中部分行时实时刷新半选状态。
  createEffect(() => {
    selectAllRef.indeterminate = props.fileStore.somePageSelected()
  })

  return (
    <table class="w-full text-[14px] leading-[22px]" style={{ "border-collapse": "separate", "border-spacing": "0", "table-layout": "fixed" }}>
      <thead>
        <tr style={{ background: "var(--octo-surface-hover)", height: "56px", position: "sticky", top: "0", "z-index": "10" }}>
          <th style={{ width: "48px", "min-width": "48px", "max-width": "48px", padding: "12px 16px", "box-sizing": "border-box", "vertical-align": "middle", "text-align": "left", "border-bottom": "1px solid var(--octo-border-divider)" }}>
            <input
              type="checkbox"
              ref={selectAllRef}
              checked={props.fileStore.allPageSelected()}
              onChange={props.onSelectAllPage}
              style={{ width: "16px", height: "16px", "border-radius": "2px", border: "1px solid var(--octo-border-input)", cursor: "pointer", "accent-color": "var(--octo-brand)", "vertical-align": "middle" }}
            />
          </th>
          <th class="px-4 py-2 text-left" style={{ width: "45%", "border-bottom": "1px solid var(--octo-border-divider)" }}>
            <span class="flex items-center gap-1" style={{ color: "var(--octo-text-primary)", "font-weight": "normal" }}>名称</span>
          </th>
          <th class="px-4 py-2 text-left" style={{ width: "30%", "border-bottom": "1px solid var(--octo-border-divider)" }}>
            <button type="button" onClick={() => props.onHeaderSort("kind")} class="flex items-center gap-1 transition-colors hover:text-[var(--octo-brand)]" style={{ color: "var(--octo-text-primary)", "font-weight": "normal" }}>类型</button>
          </th>
          <th class="px-4 py-2 text-left" style={{ width: "25%", "border-bottom": "1px solid var(--octo-border-divider)" }}>
            <button type="button" onClick={() => props.onHeaderSort("mtime")} class="flex items-center gap-1 transition-colors hover:text-[var(--octo-brand)]" style={{ color: "var(--octo-text-primary)", "font-weight": "normal" }}>
              修改时间
              <IconSortArrow size={14} dir={store().sortDir} active={store().sortKey === "mtime"} />
            </button>
          </th>
          <th class="px-4 py-2" style={{ width: "60px", "border-bottom": "1px solid var(--octo-border-divider)" }} />
        </tr>
      </thead>
      <tbody>
        {/* 顶层:生成文件 + 上传文件 两段;非顶层(进文件夹):仅上传文件,不分段 */}
        <Show when={props.fileStore.isTopLevel()}>
          <SectionHeaderRow title="生成文件" collapsed={store().collapsedGenerated} onToggle={() => props.fileStore.toggleGeneratedSection()} />
          <Show when={!store().collapsedGenerated}>
            <GroupedRows computed={props.fileStore.generated} fileStore={props.fileStore} onOpen={props.onOpen} onPreview={props.onPreview} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} />
          </Show>
          <SectionHeaderRow title="上传文件" collapsed={store().collapsedUploaded} onToggle={() => props.fileStore.toggleUploadedSection()} />
          <Show when={!store().collapsedUploaded}>
            <GroupedRows computed={props.fileStore.uploaded} fileStore={props.fileStore} onOpen={props.onOpen} onPreview={props.onPreview} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />
          </Show>
        </Show>
        <Show when={!props.fileStore.isTopLevel()}>
          <GroupedRows computed={props.fileStore.uploaded} fileStore={props.fileStore} onOpen={props.onOpen} onPreview={props.onPreview} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />
        </Show>
      </tbody>
    </table>
  )
}

function SectionHeaderRow(props: { title: string; collapsed: boolean; onToggle: () => void }): JSX.Element {
  return (
    <tr style={{ background: "var(--octo-surface-page)", height: "54px" }}>
      <td colSpan={5} class="px-2 py-1" style={{ "border-bottom": props.collapsed ? "1px solid var(--octo-border-divider)" : "none" }}>
        <button type="button" onClick={props.onToggle} class="flex items-center gap-2 w-full" style={{ color: "var(--octo-text-primary)", "font-size": "14px", "line-height": "22px" }}>
          <IconChevronDown size={16} style={{ transform: props.collapsed ? "rotate(-90deg)" : "none" }} />
          <span class="font-medium">{props.title}</span>
        </button>
      </td>
    </tr>
  )
}

// 段内按 groupMode 再分组:类型 → 各 kind 小标题;修改时间 → 今天/昨天/… 小标题。
function GroupedRows(props: {
  computed: ReturnType<typeof createInsightFileStore>["uploaded"]
  fileStore: ReturnType<typeof createInsightFileStore>
  onOpen: (file: InsightFile) => void
  onPreview: (file: InsightFile) => void
  onAddToSession?: (file: InsightFile) => void
  onDownload: (file: InsightFile) => void
  onDelete?: (file: InsightFile) => void
  onArchive?: (file: InsightFile) => void
  onOpenInExplorer: (file: InsightFile) => void
  onNavigateFolder?: (folder: InsightFile) => void
}): JSX.Element {
  const groupMode = (): GroupMode => props.fileStore.store.groupMode
  return (
    <Switch>
      <Match when={groupMode() === "kind"}>
        <For each={props.computed.kindGroupEntries()}>
          {([kind, files]) => (
            <>
              <SubGroupHeaderRow label={kindLabel(kind)} />
              <For each={files}>{(file) => <FileRow file={file} selected={props.fileStore.store.selected.has(file.path)} store={props.fileStore} onOpen={props.onOpen} onPreview={props.onPreview} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />}</For>
            </>
          )}
        </For>
      </Match>
      <Match when={groupMode() === "modified"}>
        <For each={props.computed.visibleModifiedSections()}>
          {(section: ModifiedSection) => (
            <>
              <SubGroupHeaderRow label={MODIFIED_SECTION_LABELS[section]} />
              <For each={props.computed.modifiedGroups()[section]}>
                {(file) => <FileRow file={file} selected={props.fileStore.store.selected.has(file.path)} store={props.fileStore} onOpen={props.onOpen} onPreview={props.onPreview} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />}
              </For>
            </>
          )}
        </For>
      </Match>
    </Switch>
  )
}

function SubGroupHeaderRow(props: { label: string }): JSX.Element {
  return (
    <tr style={{ background: "var(--octo-surface-page)", height: "54px" }}>
      <td colSpan={5} class="px-2 py-1" style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <div class="flex items-center gap-2 w-full" style={{ color: "var(--octo-text-secondary)", "font-size": "14px", "line-height": "22px" }}>
          <span class="font-medium">{props.label}</span>
        </div>
      </td>
    </tr>
  )
}

function FileRow(props: {
  file: InsightFile
  selected: boolean
  store: ReturnType<typeof createInsightFileStore>
  onOpen: (file: InsightFile) => void
  onPreview: (file: InsightFile) => void
  onAddToSession?: (file: InsightFile) => void
  onDownload: (file: InsightFile) => void
  onDelete?: (file: InsightFile) => void
  onArchive?: (file: InsightFile) => void
  onOpenInExplorer: (file: InsightFile) => void
  onNavigateFolder?: (folder: InsightFile) => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [imageError, setImageError] = createSignal(false)

  // 单击:文件夹 → 进入下一层;文件 → 右侧预览面板(对齐 make design-files-panel FileRow 的 onClick)。
  // 复选框 / 菜单触发器自行 stopPropagation,不会误触发本行 onClick。
  // 在标签页中打开 → 由行尾 `…` 菜单的"在标签页中打开"项触发(对齐 Design 同款交互,无双击打开)。
  // 埋点统一收口在 handlePreview / handleOpenFile,这里只做行为路由。
  const handleClick = (e: MouseEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.target instanceof HTMLButtonElement) return
    if (props.file.isFolder) {
      props.onNavigateFolder?.(props.file)
      tracker.interaction({ module: "insight", name: "files-navigate-folder" })
    } else {
      props.onPreview(props.file)
    }
  }

  return (
    <tr
      class="transition-colors cursor-pointer"
      style={{ background: props.selected ? "var(--octo-brand-a8)" : "transparent", height: "78px" }}
      onMouseEnter={(e) => { if (!props.selected) e.currentTarget.style.background = "var(--octo-brand-a8)" }}
      onMouseLeave={(e) => { if (!props.selected) e.currentTarget.style.background = "transparent" }}
      onClick={handleClick}
    >
      <td style={{ width: "48px", "min-width": "48px", "max-width": "48px", padding: "12px 16px", "box-sizing": "border-box", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        {/* 文件夹不参与批量选择(archive 不递归目录,批量删按文件口径),不显示复选框 */}
        <Show when={!props.file.isFolder}>
          <input
            type="checkbox"
            checked={props.selected}
            onChange={() => props.store.toggleFileSelection(props.file.path)}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "16px", height: "16px", "border-radius": "2px", border: "1px solid var(--octo-border-input)", cursor: "pointer", "vertical-align": "middle", "accent-color": "var(--octo-brand)" }}
          />
        </Show>
      </td>
      <td class="px-4 truncate max-w-[200px]" title={props.file.name} style={{ color: "var(--octo-text-primary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <div class="flex items-center" style={{ gap: "10px" }}>
          {(() => {
            if (props.file.kind === "image" && !imageError()) {
              return <img src={pathToLocalUrl(props.file.path)} width={32} height={32} style={{ "object-fit": "cover", "border-radius": "var(--octo-radius-sm)", "flex-shrink": "0" }} alt={props.file.name} onError={() => setImageError(true)} />
            }
            const FileIcon = getFileIcon(props.file.kind)
            return <FileIcon size={32} />
          })()}
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="truncate">{props.file.name}</span>
            <Show when={!props.file.isFolder}>
              <span class="text-[14px]" style={{ color: "var(--octo-text-secondary)" }}>{formatFileSize(props.file.size)}</span>
            </Show>
          </div>
        </div>
      </td>
      <td class="px-4 text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>{kindLabel(props.file.kind)}</td>
      <td class="px-4 text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>{formatTimeAgo(props.file.mtime)}</td>
      <td class="w-[60px] px-4" style={{ "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <Kobalte open={menuOpen()} onOpenChange={setMenuOpen} modal={false} placement="bottom-end" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            onClick={(e) => e.stopPropagation()}
            class="flex items-center justify-center size-7 rounded-[4px] transition-colors hover:bg-[var(--octo-surface-hover)] outline-none"
            classList={{ "bg-[var(--octo-surface-hover)]": menuOpen() }}
            style={{ color: "var(--octo-text-secondary)" }}
          >
            <IconTableEllipsis size={16} />
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 rounded-[12px] p-2"
              style={{ "box-shadow": "0 4px 12px 0 rgba(0,0,0,0.16)", width: "183px", "background-color": "var(--octo-surface-page)" }}
            >
              {/* 五项操作(对齐 Design):添加至会话区 / 在标签页中打开 / 打开所在文件夹 / 下载 / 删除 */}
              <Show when={props.onAddToSession && !props.file.isFolder}>
                <MenuItem
                  label="添加至会话区"
                  disabled={!ALLOWED_EXT.includes(getExt(props.file.name) as (typeof ALLOWED_EXT)[number])}
                  disabledHint="当前会话不支持上传该文件格式"
                  onClick={() => { props.onAddToSession!(props.file); setMenuOpen(false) }}
                />
                <MenuDivider />
              </Show>
              <Show when={!props.file.isFolder}>
                <MenuItem label="在标签页中打开" onClick={() => { props.onOpen(props.file); setMenuOpen(false) }} />
              </Show>
              <MenuItem label="打开所在文件夹" onClick={() => { props.onOpenInExplorer(props.file); setMenuOpen(false) }} />
              <Show when={!props.file.isFolder}>
                <MenuItem label="下载" onClick={() => { props.onDownload(props.file); setMenuOpen(false) }} />
                <Show when={props.onArchive && props.file.kind !== "html"}>
                  <MenuItem label="归档" onClick={() => { props.onArchive!(props.file); setMenuOpen(false) }} />
                </Show>
              </Show>
              <Show when={props.onDelete}>
                <MenuDivider />
                <MenuItem label="删除" danger onClick={() => { props.onDelete!(props.file); setMenuOpen(false) }} />
              </Show>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </td>
    </tr>
  )
}

function MenuItem(props: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; disabledHint?: string }): JSX.Element {
  const inner = (
    <button
      type="button"
      onClick={props.disabled ? undefined : props.onClick}
      disabled={props.disabled}
      class="w-full h-[36px] px-3 rounded-[8px] text-left text-[14px] leading-[22px] transition-colors outline-none"
      classList={{
        "hover:bg-[var(--octo-surface-hover)]": !props.disabled,
        "cursor-not-allowed": props.disabled,
      }}
      style={{ color: props.danger ? "var(--octo-danger, #dc2626)" : props.disabled ? "var(--octo-text-disabled, #BFBFBF)" : "var(--octo-text-primary)", "margin-bottom": props.danger ? "4px" : undefined }}
    >
      {props.label}
    </button>
  )
  if (props.disabled && props.disabledHint) {
    return (
      <Tooltip placement="left" value={props.disabledHint} contentStyle={{ "white-space": "nowrap", "max-width": "none", "z-index": "60" }}>
        {inner}
      </Tooltip>
    )
  }
  return inner
}

function MenuDivider(): JSX.Element {
  return <div style={{ height: "1px", background: "var(--octo-border-divider)", margin: "4px 0" }} />
}

function NoSessionEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center px-8" style={{ background: "var(--octo-surface-page)" }}>
      <img src={emptyPng} style={{ width: "150px", height: "150px" }} alt="" draggable={false} />
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-secondary)" }}>新建或进入一个会话后，这里会显示会话的文件</span>
    </div>
  )
}
