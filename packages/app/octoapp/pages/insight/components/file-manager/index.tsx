// SPEC-INS-014 §10 / §10.1 / §10.2:「文件管理」——viewMode==="files" 时替换 ResultViewer 整个内容区。
// 功能对齐站内 Design 模块(make/components/design-files/design-files-panel.tsx):
//   面包屑 + 文件夹导航 + 批量下载/删除 + 上传(文件夹/文件) + 5 项行操作菜单。
// §10.2:单击文件行直接 openTab(不再开右侧预览面板第四栏——那一栏及其自带的一套渲染分支已删),
//   打开后的渲染分流由 extToOutputType 这一唯一入口决定,与对话产物卡片同源。
// 数据源走 .octo/<sessionId>/{uploads,outputs}/(uploads 支持子文件夹导航);delete/archive
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
import { IconChevronDown, IconSortArrow, IconTableEllipsis, IconUpload, IconFolder, IconFile } from "../../icons/design-files-icons"
import { ALLOWED_EXT, getExt } from "../../lib/upload"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { FileManagerToolbar } from "./toolbar"
import { Breadcrumb } from "./breadcrumb"
import { folderRelativeDir, joinSubPath, resolveFolderName } from "./folder-upload-utils"
import { ArchiveDialogs, type ArchiveTarget } from "../archive-flow"
import { archiveFileSizeError } from "../../utils/archive-size"
import { getLargeArchiveFile } from "../../utils/archive-utils"

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
      // 大文件优先走流式 fetch(local://).blob()(Chromium blob 注册表托底,postMessage 只传引用不丢 size)。
      // ≤1.8GiB 返回 null 继续 readFileBuffer 原路径;>1.8GiB streaming 失败抛错(不回退 readFileBuffer
      // —— >阈值必 RangeError,会掩盖 streaming 真实错误成原 toast "无法获取文件内容")。
      const large = await getLargeArchiveFile(file.path, file.name, file.mime)
      if (large) return large
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

// 文件夹上传结果汇总 toast:流式分支(逐文件可能部分成功)与 base64 分支(单请求原子)共用。
// 空文件夹(total===0 → okCount=0、errors=[])走 errors.length===0 分支,产出「上传完成 / folderName (0 个文件)」。
// 多个错误时 toast 只放首条 + 计数,完整列表 console.warn 便于排查。
function showFolderUploadResult(folderName: string, okCount: number, total: number, errors: string[]) {
  if (errors.length === 0) {
    showToast({ title: "上传完成", description: `${folderName} (${okCount} 个文件)`, variant: "success", duration: 2000 })
    return
  }
  if (errors.length > 1) console.warn("[octo:files] folder-upload partial failures", { folderName, okCount, total, errors })
  const summary = errors.length > 1 ? `${errors[0]} 等 ${errors.length} 个错误` : errors[0]
  if (okCount > 0) {
    showToast({ title: "部分上传失败", description: `${okCount}/${total} 成功;${summary}`, variant: "error" })
    return
  }
  showToast({ title: "上传失败", description: summary, variant: "error" })
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
        const uploads = await fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "uploads", { subPath: store().currentPath })
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
  // 大文件完整性:桌面端走 tryStreamUpload(主进程 fs.copyFile 流式拷贝,与 make design-files-panel 同款),
  // 不把整文件读成 base64 塞进 JSON body。仅在拿不到真实本地路径(剪贴板内存 blob)/ 非桌面端时,
  // 才回退到下面的 base64 over HTTP。

  // base64 回退通道的大小上限。这条通道会把整个文件读进 JS 堆——ArrayBuffer + binary 中间串 +
  // base64 串 + JSON body 串,峰值约为文件大小的 3~4 倍——大文件下渲染进程直接 OOM,白屏且连
  // toast 都弹不出来,比"落盘 0 字节"更难排查。宁可在入口响亮拒绝,也不让它跑到崩。
  // 注意本函数同时服务文件夹上传(handleFolderUpload / 拖拽文件夹)的 base64 回退分支:
  // 桌面端 + 真实本地路径优先走流式(tryStreamFolderUpload),仅在非桌面 / 剪贴板 blob 时回退到这里。
  const BASE64_FALLBACK_MAX = 100 * 1024 * 1024 // 100 MB

  // 产出干净 base64(无 data: 前缀),服务端 Buffer.from(..., "base64") 全量解码。
  // 分块 String.fromCharCode 是为绕开单次调用的参数个数上限,不是为了省内存——内存仍是全量常驻。
  function readFileAsBase64(file: File): Promise<string> {
    if (file.size > BASE64_FALLBACK_MAX) {
      return Promise.reject(
        new Error(
          `该文件超过 ${formatFileSize(BASE64_FALLBACK_MAX)},无法通过当前方式上传。请先将文件保存到本地磁盘,再从本地拖入或选择上传。`,
        ),
      )
    }
    return file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf)
      let binary = ""
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      return btoa(binary)
    })
  }

  // 桌面端流式上传:取真实本地路径 → copyFileToSessionUploads(直接 fs.copyFile 进 uploads/[currentPath])。
  // 返回 true 表示已落地;false 表示不可走流式(非桌面 / 无本地路径),调用方回退 base64。
  async function tryStreamUpload(file: File, currentPath: string): Promise<boolean> {
    const api = getDesktopApi()
    const baseDir = sdk.directory
    if (
      !baseDir ||
      typeof api?.getPathForFile !== "function" ||
      typeof api?.copyFileToSessionUploads !== "function"
    ) {
      return false
    }
    let srcPath = ""
    try {
      srcPath = api.getPathForFile(file)
    } catch {
      // 取不到真实路径(剪贴板内存 blob,无落盘来源)→ 回退 base64
    }
    if (!srcPath) return false
    await api.copyFileToSessionUploads(srcPath, baseDir, props.sessionId, currentPath, file.name)
    return true
  }

  // 桌面端文件夹流式上传:逐文件 copyFileToSessionUploads,绕开 base64/JSON 通道(V8 ~256MB
  // 字符串上限 + 渲染进程 OOM 双重风险)。IPC subPath 已支持嵌套 + 递归建目录(ipc.ts
  // sanitizeUploadsSubPath 允许 / + ensureWorktreeDir 走 mkdir recursive),故 subPath 拼成
  // currentPath/folderName/dirname(relativePath) 即可保留目录结构。
  // 撞名 / 路径解析见 resolveFolderName / folderRelativeDir;任一文件拿不到真实本地路径
  // (剪贴板 blob / 部分 webkitGetAsEntry File)→ 返回 null,调用方回退 base64 +
  // uploadInsightFolder 单请求(保留原子语义)。空文件夹也返回 null:让回退路径的
  // uploadInsightFolder 走服务端 ensureDir 建空目录,与 base64 行为对称(流式逐文件触发,
  // 0 文件时不会建目录)。
  async function tryStreamFolderUpload(
    files: { file: File; relativePath: string }[],
    folderName: string,
    currentPath: string,
  ): Promise<{ finalFolderName: string; okCount: number; errors: string[] } | null> {
    if (files.length === 0) return null
    const api = getDesktopApi()
    const baseDir = sdk.directory
    if (
      !baseDir ||
      typeof api?.getPathForFile !== "function" ||
      typeof api?.copyFileToSessionUploads !== "function"
    ) {
      return null
    }
    // 先确认所有文件都能拿到真实本地路径;有任一拿不到 → 整文件夹回退 base64(保持原 uploadFolder 单请求语义)。
    const resolved: { srcPath: string; name: string; dirPart: string }[] = []
    for (const e of files) {
      let srcPath = ""
      try {
        srcPath = api.getPathForFile(e.file)
      } catch {
        srcPath = ""
      }
      if (!srcPath) return null
      resolved.push({ srcPath, name: e.file.name, dirPart: folderRelativeDir(e.relativePath) })
    }
    const targetList = await fetchInsightFiles(sdk.url, baseDir, props.sessionId, "uploads", { subPath: currentPath }).catch(() => [])
    const finalFolderName = resolveFolderName(folderName, new Set(targetList.map((e) => e.name)))
    let okCount = 0
    const errors: string[] = []
    for (const r of resolved) {
      const subPath = joinSubPath([currentPath, finalFolderName, r.dirPart])
      try {
        await api.copyFileToSessionUploads(r.srcPath, baseDir, props.sessionId, subPath, r.name)
        okCount++
      } catch (err) {
        errors.push(`${r.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { finalFolderName, okCount, errors }
  }

  async function uploadSingleFile(file: File) {
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    try {
      const streamed = await tryStreamUpload(file, currentPath)
      if (!streamed) {
        const base64 = await readFileAsBase64(file)
        await uploadInsightFile(sdk.url, sdk.directory, props.sessionId, file.name, base64, currentPath)
      }
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

  async function handleFolderUpload(files: FileList, inputValue?: string) {
    if (!files) return
    let folderName: string | undefined = files[0]?.webkitRelativePath?.split("/")[0]
    if (!folderName && files.length === 0) {
      // <input webkitdirectory> 选空文件夹时 FileList 为空,拿不到 webkitRelativePath;
      // 从 input.value(Electron/Chrome 形如 "C:\fakepath\FolderName")取末段作为 folder name。
      // fakepath 是 Chrome 的安全伪路径前缀,过滤掉避免拿它当文件夹名。
      const segs = (inputValue ?? "").split(/[\\\/]/).filter(Boolean)
      const last = segs[segs.length - 1]
      if (last && last !== "fakepath") folderName = last
    }
    if (!folderName) {
      showToast({ title: "上传失败", description: "无法识别文件夹名", variant: "error" })
      return
    }
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    const entries = Array.from(files).map((file) => ({
      file,
      relativePath: file.webkitRelativePath.slice(folderName.length + 1),
    }))
    // 读取(readFileAsBase64)必须和上传在同一个 try 内:它会因超出回退通道上限而 reject,
    // 留在 try 外会变成 unhandled rejection —— 用户点了上传却什么提示都没有。
    try {
      // 优先流式(桌面端 + 真实本地路径):绕开 base64/JSON,无 V8 字符串上限 / OOM 风险。
      const streamed = await tryStreamFolderUpload(entries, folderName, currentPath)
      if (streamed) {
        showFolderUploadResult(streamed.finalFolderName, streamed.okCount, entries.length, streamed.errors)
        await refresh()
        props.onFilesRefresh?.()
        return
      }
      // 回退 base64 + uploadInsightFolder 单请求(非桌面 / 剪贴板 blob)。
      const fileEntries: InsightFolderUploadFile[] = []
      for (const e of entries) {
        const base64 = await readFileAsBase64(e.file)
        fileEntries.push({ relativePath: e.relativePath, content: base64 })
      }
      const result = await uploadInsightFolder(sdk.url, sdk.directory, props.sessionId, folderName, fileEntries, currentPath)
      // result.name 是服务端撞名解析后的最终文件夹名(如 "myFolder (1)"),与流式分支的 streamed.finalFolderName 对称。
      showFolderUploadResult(result.name, result.fileCount, entries.length, [])
      await refresh()
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "上传失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  // 拖拽上传:支持整文件夹(DataTransferItem + webkitGetAsEntry 递归)。
  // 从 OS 拖文件进来 dataTransfer.types 只有 "Files";页面内元素/网页图片拖动会
  // 附带 text/uri-list,带 uri-list 的一律拒收,避免误触"释放鼠标上传文件"提示。
  function isExternalFileDrag(e: DragEvent) {
    const types = e.dataTransfer?.types ?? []
    return types.includes("Files") && !types.includes("text/uri-list")
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (!isExternalFileDrag(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none"
      return
    }
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
    if (!isExternalFileDrag(e)) return
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
    const entries: { file: File; relativePath: string }[] = []
    const currentPath = fileStore.isTopLevel() ? "" : store().currentPath
    async function collectFiles(entry: FileSystemEntry) {
      if (entry.isFile) {
        const file = await getFileFromEntry(entry as FileSystemFileEntry)
        // entry.fullPath 形如 "/<folderName>/sub/file.txt",slice(1+folderName.length) 产出
        // "/sub/file.txt"(带前导斜杠);去掉它,与 handleFolderUpload 的 webkitRelativePath 口径一致,
        // 避免流式 subPath 拼出 "folderName//sub" 双斜杠(虽 path.join 能兜底归一化,但脆弱)。
        const relativePath = entry.fullPath.slice(1 + folderName.length).replace(/^\/+/, "")
        entries.push({ file, relativePath })
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const childEntries = await readAllDirectoryEntries(reader)
        for (const child of childEntries) await collectFiles(child)
      }
    }
    const reader = dirEntry.createReader()
    const dirEntries = await readAllDirectoryEntries(reader)
    // collectFiles 不再读 base64,无超上限 reject;但外层是 handleDrop 的 void processEntries(...),
    // 没有 catch —— 仍需在此收住 getFileFromEntry 的潜在失败 + 回退分支的 readFileAsBase64 reject。
    try {
      for (const entry of dirEntries) await collectFiles(entry)
      // 空文件夹不再提前 return:entries=[] → tryStreamFolderUpload 返回 null → 回退
      // uploadInsightFolder(folderName, [], ...) → 服务端 ensureDir 建空目录(与 base64 对称)。
      const streamed = await tryStreamFolderUpload(entries, folderName, currentPath)
      if (streamed) {
        showFolderUploadResult(streamed.finalFolderName, streamed.okCount, entries.length, streamed.errors)
        await refresh()
        props.onFilesRefresh?.()
        return
      }
      // 回退 base64 + uploadInsightFolder 单请求(非桌面 / 剪贴板 blob)。
      const fileEntries: InsightFolderUploadFile[] = []
      for (const e of entries) {
        const base64 = await readFileAsBase64(e.file)
        fileEntries.push({ relativePath: e.relativePath, content: base64 })
      }
      const result = await uploadInsightFolder(sdk.url, sdk.directory, props.sessionId, folderName, fileEntries, currentPath)
      showFolderUploadResult(result.name, result.fileCount, entries.length, [])
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
  // 读原字节:优先 IPC readFileBuffer(SPEC-INS-014 §10.2 / SPEC-INS-026 §5),与上面归档那处同源。
  // 不能直接走 SDK content 端点——其底层 `File.read` 对文本做 `.trim()`,`内容A\n` 会被返回成 `内容A`,
  // 下载下来的文本文件尾部换行静默丢失。content 端点只留作非桌面端 / 读盘失败的兜底。
  async function readFileBlob(file: InsightFile): Promise<Blob> {
    const api = getDesktopApi()
    if (api?.readFileBuffer) {
      try {
        const buf = await api.readFileBuffer(file.path)
        if (buf) return new Blob([buf], { type: file.mime || undefined })
      } catch (err) {
        console.warn("[octo:files] download-read-local-failed", { path: file.path, err })
      }
    }
    const content = await fetchInsightContent(sdk.url, sdk.directory, file.path)
    return content.encoding === "base64"
      ? await fetch(`data:${content.mimeType};base64,${content.content}`).then((r) => r.blob())
      : new Blob([content.content], { type: content.mimeType })
  }

  async function handleDownload(file: InsightFile) {
    try {
      const blob = await readFileBlob(file)
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
      <Dialog title="删除文件" fit class="delete-file-dialog">
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
      fileStore.clearSelection()
      props.onCloseTabsByPath?.(paths)
      props.onRemoveAttachmentsByPath?.(paths)
      showToast({ title: "已删除", description: `${result.deleted} 个文件`, variant: "success", duration: 2000 })
      props.onFilesRefresh?.()
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err), variant: "error" })
    }
  }

  // ── 打开 ────────────────────────────────────────────────────────
  // 单击文件行与行尾 `…` →「在标签页中打开」共用这一个入口(SPEC-INS-014 §10.2),
  // 故两条路径的埋点也共用 files-open-in-tab。
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
  // 头部(工具栏)/ 面包屑的显隐:有文件,或进了子文件夹(即便空)都要显示——
  // 否则点开空文件夹会把头部和面包屑一并藏掉,用户无法返回上一层(对齐 Design design-files-panel)。
  const showHeader = createMemo(() => hasAnyFiles() || !fileStore.isTopLevel())

  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <Show when={showHeader()}>
        <FileManagerToolbar
          fileStore={fileStore}
          onRefresh={refresh}
          onUploadFile={() => fileInputRef?.click()}
          onUploadFolder={() => folderInputRef?.click()}
          onBatchDownload={handleBatchDownload}
          onBatchDelete={handleBatchDelete}
        />
      </Show>

      {/* §10.2 删掉右侧预览面板后,这里不再是"列表 + 预览"的横向双栏,直接由列表铺满剩余高度。 */}
      <div
        class="flex flex-col flex-1 min-h-0 overflow-hidden relative"
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
          onChange={(e) => { const input = e.currentTarget; if (input.files) { void handleFolderUpload(input.files, input.value); input.value = "" } }}
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
        <Match when={!showHeader()}>
          <div class="flex flex-col items-center justify-center flex-1 min-h-0 text-center px-8">
            <EmptyFilesState
              onUploadFile={() => fileInputRef?.click()}
              onUploadFolder={() => folderInputRef?.click()}
            />
          </div>
        </Match>
        <Match when={showHeader()}>
          <div class="flex flex-col flex-1 min-h-0">
            {/* 面包屑固定:不随表格滚动 */}
            <div class="shrink-0" style={{ padding: "24px 24px 0" }}>
              <Breadcrumb currentPath={store().currentPath} onNavigate={(p) => fileStore.setCurrentPath(p)} />
            </div>
            {/* 只滚动表格内容:表头 sticky 吸顶(吸附到本滚动容器顶部,即面包屑下方) */}
            <div class="flex-1 min-h-0 overflow-auto">
              <Show when={hasAnyFiles()} fallback={
                <div class="flex flex-col items-center justify-center h-full text-center px-8">
                  <EmptyFilesState
                    onUploadFile={() => fileInputRef?.click()}
                    onUploadFolder={() => folderInputRef?.click()}
                  />
                </div>
              }>
                <div style={{ padding: "0 24px 24px" }}>
                  <FileTable
                    fileStore={fileStore}
                    onHeaderSort={handleHeaderSort}
                    onSelectAllPage={handleSelectAllPage}
                    onOpen={handleOpenFile}
                    onAddToSession={props.onAddToSession ? handleAddToSession : undefined}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onArchive={handleArchiveFile}
                    onOpenInExplorer={handleOpenInExplorer}
                    onNavigateFolder={(f) => fileStore.navigateToFolder(f)}
                  />
                </div>
              </Show>
            </div>
          </div>
        </Match>
        </Switch>
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
            <button type="button" onClick={() => props.onHeaderSort("mtime")} class="flex items-center gap-1 transition-colors hover:text-[var(--octo-brand)]" style={{ color: "var(--octo-text-primary)", "font-weight": "normal", "min-width": "0" }}>
              <span style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", "min-width": "0" }}>修改时间</span>
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
            <GroupedRows computed={props.fileStore.generated} fileStore={props.fileStore} onOpen={props.onOpen} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} />
          </Show>
          <SectionHeaderRow title="上传文件" collapsed={store().collapsedUploaded} onToggle={() => props.fileStore.toggleUploadedSection()} />
          <Show when={!store().collapsedUploaded}>
            <GroupedRows computed={props.fileStore.uploaded} fileStore={props.fileStore} onOpen={props.onOpen} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />
          </Show>
        </Show>
        <Show when={!props.fileStore.isTopLevel()}>
          <GroupedRows computed={props.fileStore.uploaded} fileStore={props.fileStore} onOpen={props.onOpen} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />
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
              <For each={files}>{(file) => <FileRow file={file} selected={props.fileStore.store.selected.has(file.path)} store={props.fileStore} onOpen={props.onOpen} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />}</For>
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
                {(file) => <FileRow file={file} selected={props.fileStore.store.selected.has(file.path)} store={props.fileStore} onOpen={props.onOpen} onAddToSession={props.onAddToSession} onDownload={props.onDownload} onDelete={props.onDelete} onArchive={props.onArchive} onOpenInExplorer={props.onOpenInExplorer} onNavigateFolder={props.onNavigateFolder} />}
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
  onAddToSession?: (file: InsightFile) => void
  onDownload: (file: InsightFile) => void
  onDelete?: (file: InsightFile) => void
  onArchive?: (file: InsightFile) => void
  onOpenInExplorer: (file: InsightFile) => void
  onNavigateFolder?: (folder: InsightFile) => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [imageError, setImageError] = createSignal(false)
  // 归档大小校验每行算一次(createMemo),供 MenuItem 的 disabled / disabledHint 共用,避免各调一次。
  const archiveSizeErr = createMemo(() => archiveFileSizeError(props.file.size))

  // 单击:文件夹 → 进入下一层;文件 → 直接开 tab 并聚焦(SPEC-INS-014 §10.2,回归 §10 原始决定)。
  // 复选框 / 菜单触发器自行 stopPropagation,不会误触发本行 onClick。
  // 行尾 `…` 的"在标签页中打开"与单击同效(走同一个 onOpen),保留给熟悉旧交互的用户;
  // tabStore.openTab 按 (filePath,type) 去重,两条路径不会开出第二个 tab。
  // 埋点统一收口在 handleOpenFile,这里只做行为路由。
  const handleClick = (e: MouseEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.target instanceof HTMLButtonElement) return
    if (props.file.isFolder) {
      props.onNavigateFolder?.(props.file)
      tracker.interaction({ module: "insight", name: "files-navigate-folder" })
    } else {
      props.onOpen(props.file)
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
      <td class="px-4 text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{formatTimeAgo(props.file.mtime)}</td>
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
                  <MenuItem label="归档" disabled={archiveSizeErr() !== null} disabledHint={archiveSizeErr() ?? undefined} onClick={() => { props.onArchive!(props.file); setMenuOpen(false) }} />
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

// 无文件空状态(顶层空 / 空子文件夹共用):图片 + 标题 + 描述 + 上传按钮 popover。
// 外层居中容器由调用方提供(顶层用 flex-1 撑满,子文件夹用 h-full 撑满滚动区)。
// popover 的 open 状态由本组件自管:两个挂载点互斥,各自持有独立 signal,卸载即重置,
// 避免跨挂载点残留 open 状态导致下一个空状态挂载时 popover 自动弹出。
function EmptyFilesState(props: {
  onUploadFile: () => void
  onUploadFolder: () => void
}): JSX.Element {
  const [uploadOpen, setUploadOpen] = createSignal(false)
  return (
    <>
      <img src={emptyPng} style={{ width: "150px", height: "150px" }} alt="" draggable={false} />
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-secondary)", "margin-bottom": "20px" }}>暂无文件</span>
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-primary)", "margin-bottom": "20px" }}>点击上传或拖入本地文件，统一管理会话文件</span>
      <Kobalte open={uploadOpen()} onOpenChange={setUploadOpen} modal={false} placement="bottom" gutter={4}>
        <Kobalte.Trigger
          as="button"
          type="button"
          class="flex items-center justify-center gap-2 transition-colors"
          style={{
            background: "var(--octo-brand)",
            color: "white",
            "border-radius": "999px",
            height: "32px",
            width: "108px",
            "font-size": "14px",
            "line-height": "22px",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.setProperty("background-color", "var(--octo-brand-hover)") }}
          onMouseLeave={(e) => { e.currentTarget.style.setProperty("background-color", "var(--octo-brand)") }}
          onMouseDown={(e) => { e.currentTarget.style.setProperty("background-color", "var(--octo-brand-active)") }}
          onMouseUp={(e) => { e.currentTarget.style.setProperty("background-color", "var(--octo-brand-hover)") }}
        >
          <IconUpload size={16} />
          <span>上传文件</span>
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
    </>
  )
}

function NoSessionEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center px-8" style={{ background: "var(--octo-surface-page)" }}>
      <img src={emptyPng} style={{ width: "150px", height: "150px" }} alt="" draggable={false} />
      <span class="text-[14px] leading-[22px]" style={{ color: "var(--octo-text-secondary)" }}>新建或进入一个会话后，这里会显示会话的文件</span>
    </div>
  )
}
