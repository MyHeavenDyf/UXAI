import type { FileReference } from "../components/mention-popover"

export function safeAssetPath(value: string) {
  const parts = value.replace(/\\/g, "/").split("/")
  if (!value || parts.some(part => !part || part === "." || part === ".." || /[:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`资产包含无效文件路径：${value}`)
  }
  return parts.join("/")
}

const assetFolderPattern = /^insight-asset-([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?: \(\d+\))?$/i

export function assetReferenceFilename(filename: string, token?: string) {
  if (!token || filename.includes(` (${token.slice(0, 8)})`)) return filename
  const dot = filename.lastIndexOf(".")
  const split = dot > filename.lastIndexOf("/") ? dot : filename.length
  return `${filename.slice(0, split)} (${token.slice(0, 8)})${filename.slice(split)}`
}

export function isProductAssetReference(file: FileReference) {
  return file.isFolder === true || file.path.split(/[\\/]/).some(part => assetFolderPattern.test(part))
}

function pathKey(value: string) {
  const normalized = value.replace(/\\/g, "/").split("/").reduce((parts, part) => {
    if (!part || part === ".") return parts
    if (part === "..") return parts.slice(0, -1)
    return [...parts, part]
  }, [] as string[]).join("/")
  return /^[a-z]:[\\/]/i.test(value) || /^[\\/]{2}/.test(value) ? normalized.toLowerCase() : normalized
}

export function containsProductAssetPath(path: string, assets: FileReference[]) {
  const target = pathKey(path)
  return assets.some(asset => target === pathKey(asset.path) || (asset.isFolder && target.startsWith(`${pathKey(asset.path)}/`)))
}

/** 与 Design 相同：只把胶囊转换为读取路径指令，文件正文和目录内容由模型按需读取。 */
export function prepareAssetReferences(text: string, references: FileReference[]) {
  const assets = references.filter(isProductAssetReference)
  const files = references.filter(file => !isProductAssetReference(file))
  const processed = assets.reduce((value, asset) => value.replace(`@${asset.filename}`, () => ` 读取${asset.path} ${asset.isFolder ? "这个文件夹" : "这个文件"} `), text)
  return {
    text: assets.length ? processed.replace(/\u200b/g, "").replace(/  +/g, " ").trim() : text,
    metadata: assets.length ? { displayText: text, insightProductAssets: assets } : undefined,
    assets,
    files,
  }
}

/** 仅供 Insight 的消息展示使用，原始 store 和实际发送给模型的文本不变。 */
export function displayAssetParts<T extends { type: string; metadata?: Record<string, unknown> }>(parts: T[]): T[] {
  return parts.map(part => part.type === "text" && Array.isArray(part.metadata?.insightProductAssets) && typeof part.metadata?.displayText === "string"
    ? { ...part, text: part.metadata.displayText }
    : part)
}
