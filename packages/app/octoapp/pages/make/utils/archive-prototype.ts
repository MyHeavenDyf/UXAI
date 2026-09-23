/**
 * prototype 归档 ZIP 构建（独立入口，全链路 prototype 专属）。
 *
 * html-renderer 按 props.subtype === "prototype" 分发到本文件的 createPrototypeArchiveZip；
 * 非 prototype 走 archive-utils.ts 的 createArchiveZip（NCA 引用镜像）。
 * 共享骨架（目录 / 评论 / 截图 / preview index.html / previewExtraDirs / 附件）由
 * archive-utils.ts 的 buildArchiveZipBase 单一来源提供，防跨子类型格式漂移。
 *
 */

import JSZip from "jszip"
import {
  collectReferencedFiles,
  dirname,
  basename,
  joinPath,
} from "./references"
import { observedUrlsToAbsPaths } from "./resource-tracker"
import { buildArchiveZipBase, type CreateArchiveZipOptions } from "./archive-utils"

/** prototype 归档选项：共享字段 + iframe 实时 DOM 快照。 */
export interface PrototypeArchiveZipOptions extends CreateArchiveZipOptions {
  /** iframe 实时 DOM 快照 HTML，用于抽取 [dom-picker-component] 元素写入 data/components.json。
   *  该属性由 Vue 运行时注入，磁盘 HTML 没有；undefined 时不生成 components.json。 */
  prototypeSnapshotHtml?: string
}

export interface PrototypePickerEntry {
  selector: string
  /** A2UI 节点 id（elementId），取自 DOM id 属性（ComponentNode.vue 写入 t.node.id） */
  name: string
  component: string
}

/** 从 iframe 实时 DOM 快照 HTML 中抽取 [dom-picker-component] 元素，
 *  排除 div/h1 等原生 HTML5 标签（component 值小写开头），仅保留注册组件。
 *  为每个生成在重新渲染后仍能精准命中的 CSS 选择器。html 为空时返回 []。 */
export function collectPrototypePickerDataFromHtml(html: string): PrototypePickerEntry[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, "text/html")
  return Array.from(doc.querySelectorAll<HTMLElement>("[dom-picker-component]"))
    .filter(el => !/^[a-z]/.test(el.getAttribute("dom-picker-component") ?? ""))
    .map(el => ({
      selector: buildUniqueSelector(el, doc),
      name: el.id,
      component: el.getAttribute("dom-picker-component") ?? "",
    }))
}

function buildUniqueSelector(el: Element, root: Document): string {
  const id = el.id
  if (id && root.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
    return `#${CSS.escape(id)}`
  }
  const path: string[] = []
  let cur: Element | null = el
  while (cur && cur !== root.documentElement) {
    const node: Element = cur
    const parent: Element | null = node.parentElement
    if (!parent) break
    const tag: string = node.tagName.toLowerCase()
    const siblings: Element[] = Array.from(parent.children).filter((c: Element) => c.tagName === tag)
    const index: number = siblings.indexOf(node) + 1
    path.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag)
    cur = parent
    const selector: string = path.join(" > ")
    if (root.querySelectorAll(selector).length === 1) return selector
  }
  return path.join(" > ")
}

/** prototype 引用资源打包*/
async function packPrototypeReferences(
  zip: JSZip,
  options: PrototypeArchiveZipOptions,
  htmlContent: string,
  readFileBuffer: (path: string) => Promise<ArrayBuffer | null>,
): Promise<void> {
  const htmlDir = dirname(options.htmlFilePath).replace(/\\/g, "/")
  const htmlFileName = basename(options.htmlFilePath)

  // 静态解析（返回绝对路径集合）
  const staticAbsPaths = await collectReferencedFiles({
    rootContent: htmlContent,
    rootType: "html",
    rootAbsPath: options.htmlFilePath,
    readFileBuffer,
  })
  const observedAbsPaths = observedUrlsToAbsPaths(options.observedUrls || [])

  const referencedRel = new Set<string>()
  for (const abs of [...staticAbsPaths, ...observedAbsPaths]) {
    const norm = abs.replace(/\\/g, "/")
    const lower = norm.toLowerCase()
    if (lower === htmlDir.toLowerCase()) continue
    if (!lower.startsWith(htmlDir.toLowerCase() + "/")) continue
    const rel = norm.slice(htmlDir.length + 1)
    if (rel && rel !== htmlFileName && rel !== options.htmlFileName) {
      referencedRel.add(rel)
    }
  }

  // 显式补充文件（混合 prototype 的 a2ui-data）：static 正则抓不到 dataPath 字面量，
  // observedUrls 时序不稳定，按调用方给出的相对路径确定性地补进 preview/。
  if (options.previewExtraRels?.length) {
    for (const rel of options.previewExtraRels) {
      const norm = rel.replace(/\\/g, "/").replace(/^\.?\//, "")
      if (norm && norm !== htmlFileName && norm !== options.htmlFileName) {
        referencedRel.add(norm)
      }
    }
  }

  for (const relPath of referencedRel) {
    try {
      const absolutePath = joinPath(htmlDir, relPath)
      const buffer = await readFileBuffer(absolutePath)
      if (buffer) {
        zip.file(`preview/${relPath}`, new Uint8Array(buffer))
      }
    } catch (err) {
      console.warn(`[Archive] Failed to read referenced file:`, relPath, err)
    }
  }
}

/** prototype 归档 ZIP 构建入口。*/
export async function createPrototypeArchiveZip(options: PrototypeArchiveZipOptions): Promise<Blob> {
  const zip = new JSZip()

  // [dom-picker-component] 元素运行时由 Vue 注入，磁盘 HTML 没有，
  // 从 iframe 实时快照抽取精准选择器写入 data/components.json
  if (options.prototypeSnapshotHtml !== undefined) {
    zip.file(
      "data/components.json",
      JSON.stringify(collectPrototypePickerDataFromHtml(options.prototypeSnapshotHtml), null, 2),
    )
  }

  const scaffold = await buildArchiveZipBase(options, zip)

  if (scaffold.readFileBuffer && options.htmlFilePath) {
    await packPrototypeReferences(zip, options, scaffold.htmlContent, scaffold.readFileBuffer)
  }

  return await zip.generateAsync({ type: "blob" })
}
