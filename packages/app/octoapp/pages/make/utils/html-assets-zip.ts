/**
 * HTML + 引用资源 ZIP 打包（保留目录结构）。
 *
 * 用于 ActionBar 下载按钮：HTML 类型时产出含所有被引用资源的 ZIP。
 *
 * ZIP 结构：
 *  - 若所有引用都在 htmlDir 内：HTML 放根目录，引用文件保留相对路径
 *    （如 `index.html` + `images/foo.png` + `css/main.css`）
 *  - 若引用跨到父级目录（如 `../sibling/x.png`）：以最近公共祖先为根，
 *    HTML 与各文件按相对该根的路径摆放，确保解压后相对引用仍能正常解析
 *
 * 引用识别：静态解析（collectReferencedFiles）∪ 网络信号（observedUrls）取并集。
 */

import JSZip from "jszip"
import { getDesktopApi } from "../lib/electron-api"
import {
  collectReferencedFiles,
  dirname,
  findCommonAncestor,
  relativeTo,
} from "./references"
import { observedUrlsToAbsPaths } from "./resource-tracker"

/**
 * 从磁盘读原始 HTML 文件内容（不含桥脚本注入）。
 * 失败时回退到调用方提供的 htmlContent。
 */
export async function readHtmlFromDisk(
  htmlFilePath: string,
  fallback: string,
  readFileBuffer: (p: string) => Promise<ArrayBuffer | null>
): Promise<string> {
  if (!htmlFilePath) return fallback
  try {
    const buf = await readFileBuffer(htmlFilePath)
    if (!buf) return fallback
    return new TextDecoder("utf-8", { fatal: false }).decode(buf)
  } catch {
    return fallback
  }
}

/**
 * @deprecated 使用 readHtmlFromDisk。
 * 旧的"tab.content 非空则用 tab.content"逻辑会让 ZIP 内 HTML 与磁盘文件不一致
 * （tab.content 可能是 LLM 生成版本、extractDownloadContent 剥围栏后的版本，
 * 或用户在 iframe 内编辑过但未保存的版本）。新代码应直接读盘。
 */
export async function resolveHtmlContent(
  htmlContent: string,
  htmlFilePath: string,
  readFileBuffer: (p: string) => Promise<ArrayBuffer | null>
): Promise<string> {
  if (htmlContent && htmlContent.trim()) return htmlContent
  return readHtmlFromDisk(htmlFilePath, htmlContent, readFileBuffer)
}

export interface CreateHtmlAssetsZipOptions {
  htmlContent: string
  htmlFilePath: string
  htmlFileNameInZip: string
  /** 来自 resource-tracker 的 local:// URL 列表（实际加载过的资源） */
  observedUrls?: string[]
}

export async function createHtmlAssetsZip(options: CreateHtmlAssetsZipOptions): Promise<Blob> {
  const zip = new JSZip()
  const api = getDesktopApi()

  // 无 filePath 或无文件读 API：只能放 HTML 进 ZIP
  if (!options.htmlFilePath || !api?.readFileBuffer) {
    zip.file(options.htmlFileNameInZip, options.htmlContent)
    return await zip.generateAsync({ type: "blob" })
  }

  // 始终从磁盘读原始 HTML：保证 ZIP 内 HTML 与磁盘文件字节级一致，
  // 不受 tab.content / extractDownloadContent / 未保存编辑影响。
  // 静态解析也用同一份磁盘内容，确保引用识别与实际打包一致。
  const htmlContent = await readHtmlFromDisk(
    options.htmlFilePath,
    options.htmlContent,
    (p) => api.readFileBuffer!(p)
  )

  // 静态解析：HTML → CSS/JS 递归，返回绝对路径集合
  const staticAbsPaths = await collectReferencedFiles({
    rootContent: htmlContent,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer: (p) => api.readFileBuffer!(p),
  })

  // 网络信号 → 绝对路径
  const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

  // 并集（剔除 HTML 自身）
  const htmlAbsNorm = options.htmlFilePath.replace(/\\/g, "/")
  const htmlDirAbs = dirname(htmlAbsNorm)
  const allAbs = new Set<string>([...staticAbsPaths, ...observedAbsPaths])
  allAbs.delete(htmlAbsNorm)

  // 计算最近公共祖先：至少包含 htmlDir（HTML 自身目录），确保 NCA 是目录而非文件路径。
  // 否则当 allAbs 为空时，NCA 会退化成 htmlAbsNorm（文件路径），relativeTo 全部返回空。
  const nca = findCommonAncestor([htmlDirAbs, ...allAbs])

  // HTML 在 ZIP 内的位置：相对 NCA。若 NCA == htmlDir，relativeTo 返回 basename，
  // 此时允许用调用方传入的友好文件名；否则保留原 basename（路径结构需要）。
  let htmlZipPath: string
  if (nca === htmlDirAbs || nca === "") {
    htmlZipPath = options.htmlFileNameInZip
  } else {
    htmlZipPath = relativeTo(nca, htmlAbsNorm) || options.htmlFileNameInZip
  }
  zip.file(htmlZipPath, htmlContent)

  // 引用文件：按相对 NCA 的路径摆放
  for (const abs of allAbs) {
    const entryPath = relativeTo(nca, abs)
    if (!entryPath) continue  // 不在 NCA 下（理论上不会发生，因为 NCA 是公共祖先）
    try {
      const buf = await api.readFileBuffer(abs)
      if (buf) zip.file(entryPath, new Uint8Array(buf))
    } catch (err) {
      console.warn(`[HtmlAssetsZip] Failed to read referenced file:`, abs, err)
    }
  }

  return await zip.generateAsync({ type: "blob" })
}
