import { getDesktopApi } from "./desktop-api"

export type PatternEntry = {
  name: string
  description?: string
  structure?: string
  category?: string
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
  // 分类格式 { "顶部导航": [...], "侧边导航": [...] }，展平为带 category 的数组
  const entries: PatternEntry[] = []
  for (const [cat, items] of Object.entries(data)) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      entries.push({ ...item, category: cat })
    }
  }
  return entries.length > 0 ? entries : null
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

// 资源库服务地址
export const BASE_URL = "https://octo-beta.hdesign.huawei.com/lib-resource-service"

export async function getResourceDetail(type = "file", dataId: string) {
  const url = `${BASE_URL}/api/vector/detail?type=${type}&data_id=${dataId}`
  const response = await fetch(url)
  if (!response.ok) {
    return { success: false, error: `HTTP error! status: ${response.status}` }
  }
  const data = await response.json()
  return { success: true, data }
}

export type ResourceDetailResult = {
  success: boolean
  data?: { file_path?: string; thumbnail_path?: string }
  error?: string
}

// 获取页面级数据的资源路径
export async function enrichResultsWithPaths(inputData: { results?: Array<Record<string, any>> }) {
  const results = inputData.results || []
  const enrichedResults = await Promise.all(
    results.map(async (item) => {
      const detailResult: ResourceDetailResult = await getResourceDetail("file", item.id)
      const enrichedItem = { ...item }
      if (detailResult.success && detailResult.data) {
        enrichedItem.file_path = detailResult.data.file_path || ""
        enrichedItem.thumbnail_path = detailResult.data.thumbnail_path || ""
      } else {
        enrichedItem.file_path = ""
        enrichedItem.thumbnail_path = ""
      }
      return enrichedItem
    }),
  )
  return { results: enrichedResults }
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
