import JSZip from "jszip"
import { encodeAssetUrl, joinUrl, type AssetFile } from "@/pages/make/components/addon-menu/asset-library"
import type { DesktopApi } from "../lib/electron-api"
import { OCTO_ROOT, PENDING_UPLOAD_SEGMENT } from "./worktree-layout"

export type ImportedAsset = { root: string; files: { filename: string; path: string }[] }

export function assetDownloadSource(file: AssetFile, baseUrl: string) {
  if (file.type === 40) {
    if (!file.docPath) throw new Error("资产缺少下载地址")
    return { url: encodeAssetUrl(joinUrl(file.s3BaseUrl, file.docPath)), filename: file.fileName }
  }
  const version = file.versionInfo?.[0]
  if (!version) throw new Error("资产缺少版本信息")
  const extension = version.fileName.match(/\.[^.]+$/)?.[0] ?? ""
  return {
    url: encodeAssetUrl(joinUrl(baseUrl, `/main${version.filePath}/${version.fileName}`)),
    filename: `${file.fileName}${extension}`,
  }
}

export function safeAssetPath(value: string) {
  const parts = value.replace(/\\/g, "/").split("/")
  if (!value || parts.some(part => !part || part === "." || part === ".." || /[:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`资产包含无效文件路径：${value}`)
  }
  return parts.join("/")
}

/** 每次导入使用独立目录，ZIP 保留相对结构；公开给编辑器的是普通文件清单。 */
export async function importProductAsset(
  file: AssetFile,
  options: {
    directory: string
    sessionId?: string
    baseUrl: string
    api: Pick<DesktopApi, "writeFileBuffer" | "movePendingUploadToSession">
    signal: AbortSignal
    fetch?: (url: string, options: RequestInit) => Promise<Response>
  },
): Promise<ImportedAsset> {
  if (!options.api.writeFileBuffer || !options.api.movePendingUploadToSession) throw new Error("当前环境不支持资产导入，请使用桌面端")
  const source = assetDownloadSource(file, options.baseUrl)
  options.signal.throwIfAborted()
  const response = await (options.fetch ?? fetch)(source.url, { signal: options.signal })
  if (!response.ok) throw new Error(`资产下载失败（${response.status}）`)
  const buffer = await response.arrayBuffer()
  options.signal.throwIfAborted()
  const entries = source.filename.toLowerCase().endsWith(".zip")
    ? Object.values((await JSZip.loadAsync(buffer)).files).filter(entry => !entry.dir).map(entry => ({
      // JSZip 会清洗 ../；必须校验原始路径，不能默默接受被改写的文件名。
      name: safeAssetPath((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name),
      read: () => entry.async("arraybuffer"),
    }))
    : [{ name: safeAssetPath(source.filename), read: () => Promise.resolve(buffer) }]
  if (!entries.length) throw new Error("资产包中没有可引用的文件")
  if (entries.length > 200) throw new Error("资产包包含超过 200 个文件，请拆分后导入")
  const names = entries.map(entry => entry.name.toLowerCase())
  if (new Set(names).size !== names.length) throw new Error("资产包包含大小写冲突的文件路径")
  const token = crypto.randomUUID()
  const root = `${options.directory.replace(/[\\/]$/, "")}/${OCTO_ROOT}/${PENDING_UPLOAD_SEGMENT}/insight-asset-${token}`
  for (const entry of entries) {
    options.signal.throwIfAborted()
    const data = await entry.read()
    options.signal.throwIfAborted()
    await options.api.writeFileBuffer(`${root}/${entry.name}`, data)
  }
  options.signal.throwIfAborted()
  const destination = options.sessionId
    ? await options.api.movePendingUploadToSession(root, options.directory, options.sessionId)
    : root
  options.signal.throwIfAborted()
  return {
    root: destination,
    // MCP 按清单名称查找上传地址，跨资产包同名也要消歧；磁盘相对结构不改。
    files: entries.map(entry => {
      const dot = entry.name.lastIndexOf(".")
      const split = dot > entry.name.lastIndexOf("/") ? dot : entry.name.length
      return { filename: `${entry.name.slice(0, split)} (${token.slice(0, 8)})${entry.name.slice(split)}`, path: `${destination}/${entry.name}` }
    }),
  }
}

/** 初始页导入的资产整目录迁移，保持 HTML/图片等相对链接。可重试且不会重复搬同一根。 */
export async function migrateAssetMentions(
  files: { filename: string; path: string }[],
  directory: string,
  sessionId: string,
  move: NonNullable<DesktopApi["movePendingUploadToSession"]>,
  moved: Map<string, string>,
) {
  const prefix = `${directory.replace(/\\/g, "/").replace(/\/$/, "")}/${OCTO_ROOT}/${PENDING_UPLOAD_SEGMENT}/`
  const result: typeof files = []
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, "/")
    if (!normalized.startsWith(`${prefix}insight-asset-`)) {
      result.push(file)
      continue
    }
    const folder = normalized.slice(prefix.length).split("/")[0]
    const root = `${prefix}${folder}`
    const key = `${sessionId}:${root}`
    if (!moved.has(key)) moved.set(key, await move(root, directory, sessionId))
    result.push({ ...file, path: `${moved.get(key)}${normalized.slice(root.length)}` })
  }
  return result
}
