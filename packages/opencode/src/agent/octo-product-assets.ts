import path from "node:path"
import { realpath, stat } from "node:fs/promises"

export type Reference = { filename: string; path: string; isFolder?: boolean }

/** 只认 Insight 发送端附带的结构化选择；不从模型正文猜测授权目录。 */
export function fromPart(part: { type?: string; metadata?: Record<string, unknown> }): Reference[] {
  if (part.type !== "text" || !Array.isArray(part.metadata?.insightProductAssets)) return []
  const references: unknown[] = part.metadata.insightProductAssets
  return references.filter((value): value is Reference => {
    if (!value || typeof value !== "object") return false
    const reference = value as Record<string, unknown>
    return typeof reference.filename === "string" && typeof reference.path === "string"
      && (path.isAbsolute(reference.path) || path.win32.isAbsolute(reference.path))
      && (reference.isFolder === undefined || typeof reference.isFolder === "boolean")
  })
}

function key(value: string) {
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return path.win32.normalize(value).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase()
  return path.resolve(value).replace(/\\/g, "/").replace(/\/$/, "")
}

export function contains(file: string, assets: Reference[]) {
  const target = key(file)
  return assets.some(asset => target === key(asset.path) || (asset.isFolder && target.startsWith(`${key(asset.path)}/`)))
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

/** MCP 实际引用到目录内文件时才查路径，不预扫描或预上传整个资产。 */
export async function resolve(args: unknown, assets: Reference[]) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return []
  const fields = args as Record<string, unknown>
  return Promise.all([...new Set(strings([fields.download_links, fields.outline_file_path]))].filter(ref => (path.isAbsolute(ref) || path.win32.isAbsolute(ref)) && contains(ref, assets)).map(async ref => {
    const actual = await realpath(ref)
    const allowed = await Promise.all(assets.filter(asset => contains(ref, [asset])).map(async asset => ({ ...asset, path: await realpath(asset.path) })))
    if (!contains(actual, allowed) || !(await stat(actual)).isFile()) {
      throw new Error(`产品资产引用必须是已选目录内的实际文件，不能传目录或目录外文件：${ref}`)
    }
    return [ref, actual] as const
  }))
}

export * as OctoProductAssets from "./octo-product-assets"
