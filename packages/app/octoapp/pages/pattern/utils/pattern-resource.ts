import { getDesktopApi } from "./desktop-api"

export type PatternEntry = {
  name: string
  elements?: string
  business_scenario?: string
  layout_mode?: string
  path: string
  preview?: string
}

export type PatternMatchItem = {
  pattern: PatternEntry
  score: number
  content?: string | null
  previewUrl?: string | null
}

// 读取指定主题、类别（"page" | "block"）的 pattern 目录索引
export async function readPatternIndex(category: string, theme = "ICT3.1"): Promise<PatternEntry[] | null> {
  const api = getDesktopApi()
  if (!api?.getPatternIndex) return null
  const data = await api.getPatternIndex(category, theme)
  if (!data) return null
  const entries = (category === "page" ? data.pages : data.blocks) as PatternEntry[] | undefined
  return entries ?? null
}

// 读取指定主题、类别下的具体 pattern 文件内容
export async function readPatternFile(category: string, filename: string, theme = "ICT3.1"): Promise<string | null> {
  const api = getDesktopApi()
  if (!api?.getPatternFile) return null
  return api.getPatternFile(category, filename, theme)
}

// 读取指定主题、类别下的 pattern 预览图片，返回 base64 data URL
export async function readPatternPreview(category: string, filename: string, theme = "ICT3.1"): Promise<string | null> {
  const api = getDesktopApi()
  if (!api?.getPatternPreview) return null
  return api.getPatternPreview(category, filename, theme)
}

// 读取 pattern 文件夹下 assets 目录的所有静态资源文件
export async function readPatternAssets(
  category: string,
  folderName: string,
  theme = "ICT3.1",
): Promise<{ filename: string; buffer: ArrayBuffer }[]> {
  const api = getDesktopApi()
  if (!api?.getPatternAssets) return []
  return api.getPatternAssets(category, folderName, theme)
}

// 将图片 buffer 保存到 uploads 目录，返回 /history/{sessionId}/uploads/{hash}.{ext} URL
export async function saveUploadImage(buffer: ArrayBuffer, sessionId: string): Promise<string | null> {
  const api = getDesktopApi()
  if (!api?.saveUploadImage) return null
  return api.saveUploadImage(buffer, sessionId)
}

// 将 JSON 中所有 ./xxx/filename 相对路径替换为上传后的 URL
export function replacePatternAssetPaths(data: unknown, replacements: Record<string, string>): any {
  if (Object.keys(replacements).length === 0) return data
  let str = JSON.stringify(data)
  for (const [filename, url] of Object.entries(replacements)) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`"\\.\\\/[^"]*\\\/${escaped}"`, "g")
    str = str.replace(regex, `"${url}"`)
  }
  return JSON.parse(str)
}
