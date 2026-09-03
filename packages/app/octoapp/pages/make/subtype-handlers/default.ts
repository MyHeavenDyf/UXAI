import type { SubtypeHandler, SubtypeHandlerContext, CanvasEditResult } from './types'
import type { ResultTab } from '../components/result-viewer/tab-store'
import { showOctoToast } from '../components/octo-toast'
import { getDesktopApi } from '../lib/electron-api'
import { relativePathToId, resolveRelativePath, getExt } from '../utils/history-store'
import JSZip from 'jszip'

/**
 * 默认 SubtypeHandler 实现
 * 
 * 这个文件展示了如何实现自定义 SubtypeHandler。
 * 其他 handler 可以参考此文件了解如何实现各种方法。
 * 
 * 所有方法都是可选的，你可以选择性地实现需要的方法。
 * 返回值语义：
 * - true: 已处理，阻止默认逻辑
 * - false: 未处理，继续执行默认逻辑
 * - void: 已处理（等同于 true）
 */

/** 用户取消系统保存对话框时抛出，由调用方 catch 后静默移除任务项 */
export class DownloadCancelledError extends Error {
  constructor() {
    super("download cancelled")
    this.name = "DownloadCancelledError"
  }
}

// ============ 辅助函数 ============

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled"
}

function stripExtension(title: string, ext: string): string {
  const suffix = `.${ext}`
  if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
    return title.slice(0, -suffix.length)
  }
  return title
}

async function downloadBlob(content: string | Uint8Array, filename: string, mimeType: string): Promise<boolean> {
  const blobPart: BlobPart = typeof content === "string" ? content : new Uint8Array(content.buffer as ArrayBuffer, content.byteOffset, content.byteLength)
  const blob = new Blob([blobPart], { type: mimeType })
  const api = getDesktopApi()

  if (api?.saveFilePicker && api?.writeFileBuffer) {
    const chosen = await api.saveFilePicker({ defaultPath: sanitizeFilename(filename) })
    if (!chosen) return false
    const buffer = await blob.arrayBuffer()
    await api.writeFileBuffer(chosen, buffer)
    showOctoToast({ title: "已下载" })
    return true
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showOctoToast({ title: "已下载" })
  return true
}

function markdownTableToCSV(md: string): string {
  const lines = md.split("\n")
  const tableLines = lines.filter((l) => l.trim().startsWith("|"))
  return tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => `"${cell.trim().replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n")
}

function extractDownloadContent(tab: ResultTab): string {
  if (tab.type === "table") return markdownTableToCSV(tab.content)

  const raw = tab.content

  if (tab.type === "svg") {
    const fenceMatch = raw.match(/```(?:xml|svg)?\s*\n([\s\S]*?)\n?```/i)
    if (fenceMatch) return fenceMatch[1].trim()
    const svgMatch = raw.match(/(<svg[\s>][\s\S]*<\/svg>)/i)
    if (svgMatch) return svgMatch[1]
    return raw.trim()
  }

  if (tab.type === "code-snippet") {
    const fenceMatch = raw.match(/```[\w]*\s*\n([\s\S]*?)\n?```/)
    if (fenceMatch) return fenceMatch[1].trim()
    return raw.trim()
  }

  if (tab.type === "html" || tab.type === "deck") {
    const fenceMatch = raw.match(/```html\s*\n([\s\S]*?)\n?```/i)
    if (fenceMatch) return fenceMatch[1].trim()
    return raw.trim()
  }

  return raw
}

function getCodeSnippetExt(content: string): string {
  const fenceMatch = content.match(/```(\w+)\s*\n/)
  if (fenceMatch) {
    const lang = fenceMatch[1].toLowerCase()
    const extMap: Record<string, string> = {
      typescript: "ts", ts: "ts", javascript: "js", js: "js",
      python: "py", py: "py", rust: "rs", go: "go", java: "java",
      css: "css", html: "html", json: "json", yaml: "yaml", yml: "yml",
      toml: "toml", sh: "sh", bash: "sh", sql: "sql",
      tsx: "tsx", jsx: "jsx", vue: "vue", svelte: "svelte",
    }
    return extMap[lang] || lang
  }
  return "txt"
}

function getDownloadInfo(tab: ResultTab): { filename: string; mime: string } {
  switch (tab.type) {
    case "html":
      return { filename: `${stripExtension(tab.title, "html")}.html`, mime: "text/html;charset=utf-8" }
    case "deck":
      return { filename: `${stripExtension(tab.title, "pdf")}.pdf`, mime: "application/pdf" }
    case "svg":
      return { filename: `${stripExtension(tab.title, "svg")}.svg`, mime: "image/svg+xml;charset=utf-8" }
    case "json":
      return { filename: `${stripExtension(tab.title, "json")}.json`, mime: "application/json;charset=utf-8" }
    case "table":
      return { filename: `${stripExtension(tab.title, "csv")}.csv`, mime: "text/csv;charset=utf-8" }
    case "code-snippet":
      const ext = getCodeSnippetExt(tab.content)
      return { filename: `${stripExtension(tab.title, ext)}.${ext}`, mime: "text/plain;charset=utf-8" }
    case "markdown":
    case "markdown-document":
      return { filename: `${stripExtension(tab.title, "md")}.md`, mime: "text/markdown;charset=utf-8" }
    default:
      return { filename: `${stripExtension(tab.title, "txt")}.txt`, mime: "text/plain;charset=utf-8" }
  }
}

function exportDeckAsPDF(content: string, title: string) {
  const html = extractDownloadContent({ type: "deck", content } as ResultTab)
  const printHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 0; size: 1920px 1080px; }
  body { margin: 0; padding: 0; }
  .slide { page-break-after: always; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; }
  .slide:last-child { page-break-after: auto; }
</style>
</head>
<body>${html}</body>
</html>`

  const desktopApi = (window as unknown as { api?: { htmlToPdf?: (html: string) => Promise<ArrayBuffer> } }).api
  if (desktopApi?.htmlToPdf) {
    desktopApi.htmlToPdf(printHtml).then(async (buffer) => {
      await downloadBlob(new Uint8Array(buffer), `${title}.pdf`, "application/pdf")
    }).catch(console.error)
    return
  }

  const win = window.open("", "_blank")
  if (!win) return
  win.document.write(printHtml)
  win.document.close()
  win.onload = () => win.print()
}

// ============ Handler 实现 ============

const DEFAULT_HISTORY_FILES = ['.']

const defaultHandler: SubtypeHandler = {
  name: '_default',
  
  /**
   * 处理下载
   * 
   * 默认行为：
   * 1. HTML 类型：生成 ZIP（包含资源文件）
   * 2. Deck 类型：导出为 PDF
   * 3. 其他类型：使用桌面 API 或浏览器下载
   * 
   * @example
   * // 自定义下载：导出到 Figma
   * async handleDownload(ctx) {
   *   const { tab, showOctoToast } = ctx
   *   showOctoToast({ title: "正在导出到 Figma..." })
   *   await exportToFigma(tab)
   *   return true  // 阻止默认下载
   * }
   */
  async handleDownload(ctx) {
    const { tab, showOctoToast, extractCodeBlock, getDesktopApi, observedUrlsGetter } = ctx
    
    // 导入依赖（在函数内部导入，避免循环依赖）
    const { createHtmlAssetsZip } = await import('../utils/html-assets-zip')
    
    // HTML 类型：生成 ZIP（包含资源文件）
    if (tab.type === "html") {
      const htmlContent = extractDownloadContent(tab)
      const htmlFileNameInZip = `${stripExtension(tab.title, "html")}.html`
      
      try {
        const observedUrls = observedUrlsGetter?.() || []
        const zipBlob = await createHtmlAssetsZip({
          htmlContent,
          htmlFilePath: tab.filePath || "",
          htmlFileNameInZip,
          observedUrls,
        })
        
        const zipName = `${stripExtension(tab.title, "zip")}.zip`
        const zipBytes = new Uint8Array(await zipBlob.arrayBuffer())
        if (!(await downloadBlob(zipBytes, zipName, "application/zip"))) throw new DownloadCancelledError()
      } catch (err) {
        if (err instanceof DownloadCancelledError) throw err
        showOctoToast({ title: "下载失败", description: err instanceof Error ? err.message : String(err) })
      }
      return true
    }
    
    // Deck 类型：导出为 PDF
    if (tab.type === "deck") {
      exportDeckAsPDF(tab.content, stripExtension(tab.title, "pdf"))
      return true
    }
    
    // 其他类型：使用桌面 API 或浏览器下载
    const api = getDesktopApi()
    const supportedTypes = ["html", "svg", "image", "video", "audio", "pdf", "text"]
    
    if (tab.filePath && supportedTypes.includes(tab.type) && api?.saveFilePicker && api?.readFileBuffer && api?.writeFileBuffer) {
      const chosen = await api.saveFilePicker({ defaultPath: tab.title })
      if (!chosen) throw new DownloadCancelledError()
      
      const buffer = await api.readFileBuffer(tab.filePath)
      if (!buffer) {
        showOctoToast({ title: "读取文件失败", variant: "error" })
        return true
      }
      
      await api.writeFileBuffer(chosen, buffer)
      showOctoToast({ title: "已保存" })
      return true
    }
    
    // 默认下载
    const info = getDownloadInfo(tab)
    const content = extractDownloadContent(tab)
    if (!(await downloadBlob(content, info.filename, info.mime))) throw new DownloadCancelledError()
    return true
  },
  
  async handleCanvasEdit(ctx): Promise<CanvasEditResult> {
    const { tab, showOctoToast, getDesktopApi, sessionId, sdkDirectory, observedUrlsGetter } = ctx
    
    const isLoggedIn = !!localStorage.getItem('uiplusToken')
    if (!isLoggedIn) {
      showOctoToast({ title: "请先登录" })
      return { handled: true }
    }

    const htmlContent = ctx.extractCodeBlock(tab.content, "html")
    const { createC2DZip } = await import('../utils/canvas-to-design')
    
    return {
      handled: true,
      options: {
        getZip: async () => {
          showOctoToast({ title: "生成ZIP文件..." })
          return await createC2DZip({
            htmlContent,
            htmlFilePath: tab.filePath || "",
            tabTitle: tab.title,
            observedUrls: observedUrlsGetter?.() || [],
          })
        },
        downloadHtml: async (data) => {
          const api = getDesktopApi()
          const baseDir = sdkDirectory
          const sid = sessionId
          
          if (!baseDir || !sid || !api?.writeFileBuffer) {
            showOctoToast({ title: "无法保存文件", variant: "error" })
            return
          }
          
          const uploadsDir = `${baseDir}/.octo/${sid}/uploads`
          const lastDotIndex = data.filename.lastIndexOf('.')
          const baseName = lastDotIndex > 0 ? data.filename.slice(0, lastDotIndex) : data.filename
          const ext = lastDotIndex >= 0 ? data.filename.slice(lastDotIndex) : ''
          
          // ZIP file: extract to folder
          if (ext.toLowerCase() === '.zip' && api.listDirectory) {
            let folderName = baseName
            let folderPath = `${uploadsDir}/${folderName}`
            
            let counter = 0
            while (await folderExists(folderPath, api)) {
              counter++
              folderName = `${baseName} (${counter})`
              folderPath = `${uploadsDir}/${folderName}`
            }
            
            const buffer = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
            const zip = await JSZip.loadAsync(buffer)
            
            for (const [relativePath, file] of Object.entries(zip.files)) {
              if (!file.dir) {
                const content = await file.async('uint8array')
                await api.writeFileBuffer(`${folderPath}/${relativePath}`, content.buffer as ArrayBuffer)
              }
            }
            
            showOctoToast({ title: "已保存", description: folderName })
            return
          }
          
          // Non-ZIP file: save directly
          let finalFilename = data.filename
          
          if (api.fileExists) {
            let counter = 0
            while (await api.fileExists(`${uploadsDir}/${finalFilename}`)) {
              counter++
              finalFilename = `${baseName} (${counter})${ext}`
            }
          }
          
          const buffer = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
          await api.writeFileBuffer(`${uploadsDir}/${finalFilename}`, buffer.buffer)
          showOctoToast({ title: "已保存", description: finalFilename })
        },
        config: {
          designName: tab.title,
          sessionId: sessionId || "",
        },
      },
    }
  },
  
  /**
   * 处理标注切换
   * 
   * 默认行为：切换 commenting 状态，显示标准标注 UI
   * 返回 false 表示不处理，让系统执行默认逻辑
   * 
   * @example
   * // 自定义标注：使用自定义标注面板
   * async handleComment(ctx) {
   *   const { tab, showOctoToast } = ctx
   *   // 打开自定义标注面板
   *   await openCustomCommentPanel(tab)
   *   return true  // 阻止默认标注 UI
   * }
   */
  async handleComment(ctx) {
    // 返回 false，让系统执行默认逻辑（切换 featureMutex.state.commenting）
    return false
  },
  
  /**
   * 处理归档切换
   * 
   * 默认行为：切换 archiving 状态，显示 ArchiveDialog
   * 返回 false 表示不处理，让系统执行默认逻辑
   * 
   * @example
   * // 自定义归档：上传到云存储
   * async handleArchive(ctx) {
   *   const { tab, showOctoToast } = ctx
   *   await uploadToCloud(tab)
   *   showOctoToast({ title: "已归档到云端" })
   *   return true
   * }
   */
  async handleArchive(ctx) {
    // 返回 false，让系统执行默认逻辑（切换 featureMutex.state.archiving）
    return false
  },
  
  /**
   * 功能开启前的钩子
   * 
   * 默认行为：允许所有功能开启
   * 返回 true 表示允许开启，false 表示阻止
   * 
   * @example
   * // 只在登录时允许归档
   * async beforeFeatureEnable(feature, ctx) {
   *   if (feature === 'archive') {
   *     const isLoggedIn = checkLogin()
   *     if (!isLoggedIn) {
   *       ctx.showOctoToast({ title: "请先登录" })
   *       return false
   *     }
   *   }
   *   return true
   * }
   */
  async beforeFeatureEnable(feature, ctx) {
    return true
  },
  
  /**
   * UI 配置
   * 
   * 默认行为：使用标准 Action Bar 按钮
   * 
   * icon 支持三种格式：
   * 1. 图标组件（推荐）：`<IconSync size={16} />`
   * 2. emoji/字符：`'🔄'`
   * 3. 文本：`'Aa'`
   * 
   * position 支持以下值：
   * - 'start': 最前面（左侧区域开始）
   * - 'after-download': 下载按钮之后
   * - 'after-archive': 归档按钮之后
   * - 'before-fullscreen': 全屏按钮之前
   * - 'end': 最后面（默认）
   * 
   * @example
   * // 指定按钮位置
   * components: {
   *   actionBar: {
   *     extraButtons: [
   *       {
   *         id: 'sync',
   *         label: '同步',
   *         icon: <IconSync size={16} />,
   *         position: 'after-download',  // 在下载按钮之后
   *         order: 1
   *       },
   *       {
   *         id: 'share',
   *         label: '分享',
   *         position: 'before-fullscreen',  // 在全屏按钮之前
   *         order: 1
   *       },
   *       {
   *         id: 'custom-start',
   *         label: '自定义',
   *         position: 'start'  // 最前面
   *       }
   *     ]
   *   }
   * }
   * 
   * @example
   * // 多个按钮排序
   * components: {
   *   actionBar: {
   *     extraButtons: [
   *       {
   *         id: 'sync',
   *         label: '同步',
   *         position: 'after-download',
   *         order: 1  // 第一个
   *       },
   *       {
   *         id: 'share',
   *         label: '分享',
   *         position: 'after-download',
   *         order: 2  // 第二个
   *       }
   *     ]
   *   }
   * }
   */
  components: {
    actionBar: {
      extraButtons: []
    }
  },

  onHistoryTrigger(_event, _ctx) {
    return DEFAULT_HISTORY_FILES
  },

  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi, updateTabContent } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !api?.readFileBuffer || !tab.filePath) return

    for (const rel of DEFAULT_HISTORY_FILES) {
      const id = relativePathToId(rel)
      const ext = getExt(resolveRelativePath(rel, tab.filePath))
      const versionFileName = id + ext
      const versionFile = files.find((f) => f.fileName === versionFileName)
      if (!versionFile) continue
      const originalPath = resolveRelativePath(rel, tab.filePath)
      try {
        await api.copyFileTo(versionFile.filePath, originalPath)
      } catch {}
    }

    const buf = await api.readFileBuffer(tab.filePath)
    if (buf && updateTabContent) {
      updateTabContent(tab.id, new TextDecoder().decode(buf))
    }
  },
}

export default defaultHandler satisfies SubtypeHandler

async function folderExists(path: string, api: ReturnType<typeof getDesktopApi>): Promise<boolean> {
  if (!api?.listDirectory) return false
  const parent = path.replace(/[/\\][^/\\]+$/, '')
  const items = await api.listDirectory(parent)
  if (!items) return false
  return items.some(item => item.path === path && item.type === 'directory')
}