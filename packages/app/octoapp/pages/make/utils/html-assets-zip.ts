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
 * 解析 HTML 内容：优先用传入的 htmlContent（LLM 生成 / 已加载），
 * 若为空则从磁盘读原始文件（本地文件场景 tab.content 为空）。
 * 读盘得到的是不含桥脚本的原始 HTML，适合写入 ZIP 与做静态解析。
 */
export async function resolveHtmlContent(
  htmlContent: string,
  htmlFilePath: string,
  readFileBuffer: (p: string) => Promise<ArrayBuffer | null>
): Promise<string> {
  if (htmlContent && htmlContent.trim()) return htmlContent
  if (!htmlFilePath) return htmlContent
  try {
    const buf = await readFileBuffer(htmlFilePath)
    if (!buf) return htmlContent
    return new TextDecoder("utf-8", { fatal: false }).decode(buf)
  } catch {
    return htmlContent
  }
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

  // 本地文件场景 tab.content 可能为空 → 从磁盘读原始 HTML（不含桥脚本）
  const htmlContent = await resolveHtmlContent(
    options.htmlContent,
    options.htmlFilePath,
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
  const allAbs = new Set<string>([...staticAbsPaths, ...observedAbsPaths])
  allAbs.delete(htmlAbsNorm)

  // 计算最近公共祖先（包含 HTML 自身，确保 HTML 总在 ZIP 内）
  const nca = findCommonAncestor([htmlAbsNorm, ...allAbs])

  // HTML 在 ZIP 内的位置：相对 NCA。若 NCA == htmlDir，relativeTo 返回 basename，
  // 此时允许用调用方传入的友好文件名；否则保留原 basename（路径结构需要）。
  const htmlDirAbs = dirname(htmlAbsNorm)
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
