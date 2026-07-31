import JSZip from "jszip"
import type { AnnotationRecord } from "./annotation-persist"
import { getDesktopApi } from "./desktop-api"
// 复用 make 页面的 REST 上传函数,避免重复实现
import { buildArchivePath, createDeliverable, getArchiveBaseUrl, uploadCover, uploadVersion } from "../../make/utils/archive-utils"

export { buildArchivePath, createDeliverable, getArchiveBaseUrl, uploadCover, uploadVersion }

export interface PatternArchiveZipOptions {
  annotations: AnnotationRecord[]
  sessionId: string
  pageJson: unknown
  screenshotBlob: Blob
  projectDir: string
}

/**
 * 归档 ZIP 构建工具
 *
 * 生成的 ZIP 结构:
 *   data/
 *     comments.json        ← 批注(去除 rawRect, selector 规范化,含 account/userName)
 *     screenshot.jpg       ← 预览截图
 *     {annoId}/{attId}     ← 批注附件文件(attId 已含扩展名)
 *   src/                   ← 占位空目录
 *   preview/
 *     index.html           ← 来自 previewdist(A2UI runtime)
 *     data.js              ← 注入当前页面 A2UI JSON
 *     assets/...           ← previewdist 的字体/CSS/JS
 *     uploads/xxx.png      ← 样式引用的背景图(扁平,只保留文件名)
 *
 * 与 make 页面 createArchiveZip 的区别:
 *   - preview 内容不同(make 单 HTML + 同目录资源,pattern 拷贝整个 previewdist + 注入 data.js)
 *   - 附件目录结构一致(data/{annoId}/{attId}),attId 已含扩展名(make 在归档时拼 ext,pattern 落盘时已拼)
 */

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

// 拼接绝对路径,统一用正斜杠(Node 在 Windows 上也能正确处理)
// POSIX 绝对路径(/...)、Windows 盘符(C:/...)、UNC(//server/...)都视为绝对路径
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("//")
}

function joinPath(base: string, relative: string): string {
  const nb = base.replace(/\\/g, "/")
  const nr = relative.replace(/\\/g, "/")
  // relative 已是绝对路径(如 listDirectory 返回的绝对 file.path),直接返回,避免与 base 拼出重复前缀
  if (isAbsolutePath(nr)) return nr
  // relative 已含 base 前缀时直接返回:大小写不敏感比较(Windows/macOS 文件系统大小写不敏感)
  // + 路径段边界检查,避免 /foo/bar 误匹配 /foo/barbaz 这类字符串前缀
  const lower = nb.toLowerCase()
  const lowerRel = nr.toLowerCase()
  if (lowerRel === lower || lowerRel.startsWith(lower + "/")) return nr
  return (nb.endsWith("/") ? nb : nb + "/") + nr
}

export async function createPatternArchiveZip(options: PatternArchiveZipOptions): Promise<Blob> {
  const zip = new JSZip()

  zip.folder("data")
  zip.folder("src")
  zip.folder("preview")

  // ── 批注:去除 rawRect(仅用于画布定位,归档无意义),规范 selector ──
  // selector 规范化:确保以 # 开头,且 : 前加 \ 转义(如 a:1 → #a\:1)
  const stripped = options.annotations.map(({ rawRect, selector, ...rest }) => ({
    ...rest,
    selector: (selector.startsWith("#") ? selector : "#" + selector).replace(/(?<!\\):/g, "\\:"),
  }))
  zip.file("data/comments.json", JSON.stringify(stripped, null, 2))

  // ── 截图(来自离屏窗口捕获的当前页面,作交付物封面与预览) ──
  const screenshotBytes = await blobToUint8Array(options.screenshotBlob)
  zip.file("data/screenshot.jpg", screenshotBytes)

  // ── 附件文件:从磁盘 {projectDir}/.octo/design/history/{sessionId}/annotations/uploads/{attId} 拷贝到 data/{annoId}/{attId} ──
  const api = getDesktopApi()
  if (api?.readFileBuffer && options.projectDir) {
    for (const anno of options.annotations) {
      if (!anno.attachments.length) continue
      for (const att of anno.attachments) {
        try {
          const filePath = joinPath(options.projectDir, `.octo/design/history/${options.sessionId}/annotations/uploads/${att.id}`)
          const buffer = await api.readFileBuffer(filePath)
          if (buffer) zip.file(`data/${anno.id}/${att.id}`, new Uint8Array(buffer))
        } catch (err) {
          console.warn(`[Archive] Failed to read attachment:`, att.id, err)
        }
      }
    }
  }

  // ── preview/ 目录:拷贝 previewdist 全部文件(开发态为 packages/previewdist,安装态为 resources/previewdist) ──
  // 跳过 data.js,后续单独注入当前页面 JSON
  if (api?.getPreviewDistDir && api?.listDirectory && api?.readFileBuffer) {
    try {
      const dir = await api.getPreviewDistDir()
      const files = await api.listDirectory(dir)
      for (const file of files) {
        if (file.type !== 'file') continue
        const relPath = file.path.replace(/\\/g, "/")
        if (relPath === "data.js") continue
        try {
          const absolutePath = joinPath(dir, file.path)
          const buffer = await api.readFileBuffer(absolutePath)
          if (buffer) zip.file(`preview/${relPath}`, new Uint8Array(buffer))
        } catch (err) {
          console.warn(`[Archive] Failed to read previewdist file:`, file.path, err)
        }
      }
    } catch (err) {
      console.warn('[Archive] Failed to list previewdist directory:', err)
    }
  }

  // ── 注入 preview/data.js:当前页面 A2UI JSON ──
  // JSON 中可能有 /history/ses_xxx/uploads/yyy.png 形式的资源引用,
  // 需要同步拷贝资源到 preview/uploads/ 并改写为相对路径
  let jsonStr = typeof options.pageJson === "string"
    ? options.pageJson
    : JSON.stringify(options.pageJson ?? {})

  // 扫描 JSON 中所有 /uploads/文件名 引用,去重后只保留文件名
  const uploadPattern = /\/uploads\/([a-zA-Z0-9_\-.]+)/g
  const uniqueBasenames = new Set([...jsonStr.matchAll(uploadPattern)].map(m => m[1]))

  if (uniqueBasenames.size > 0) {
    // uploadsDir = {sdk.directory}/.octo/design/history,由 pattern/index.tsx 的 setUploadsDir 设置
    // 文件实际路径: {uploadsDir}/{sessionId}/uploads/{filename}(与 save-upload-image IPC 一致)
    const uploadsDir = api?.getUploadsDir ? await api.getUploadsDir() : null
    const copied = new Set<string>()

    if (uploadsDir && api?.readFileBuffer) {
      for (const basename of uniqueBasenames) {
        if (copied.has(basename)) continue
        try {
          const filePath = joinPath(uploadsDir, options.sessionId + "/uploads/" + basename)
          const buffer = await api.readFileBuffer(filePath)
          if (buffer) {
            zip.file(`preview/uploads/${basename}`, new Uint8Array(buffer))
            copied.add(basename)
          }
        } catch (err) {
          console.warn(`[Archive] Failed to read resource:`, basename, err)
        }
      }
    }

    // 改写 URL: /history/ses_xxx/uploads/yyy.png → ./uploads/yyy.png
    // [^)\]"'\s]*? 非贪婪匹配 sessionId 等中间路径,避免字符类限制问题
    jsonStr = jsonStr.replace(/\/history\/[^)\]"'\s]*?\/uploads\/([a-zA-Z0-9_\-.]+)/g, "./uploads/$1")
  }

  zip.file("preview/data.js", `window.__A2UI_DATA__ = ${jsonStr};`)

  return await zip.generateAsync({ type: "blob" })
}
