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

// 页面资源库查询地址
export const PAGE_RESOURCE_URL = "https://octo-beta.hdesign.huawei.com/lib-resource-service"

export async function getResourceDetail(type = "file", dataId: string) {
  const url = `${PAGE_RESOURCE_URL}/api/vector/detail?type=${type}&data_id=${dataId}`
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
  const initData = {
    "results": [
      {
        "id": "966",
        "name": "管理页-表格模式",
        "score": 75,
        "file_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/b3414307-b975-40f8-b5fa-bfe90f73cd9e.md",
        "thumbnail_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/9d68970d-94b6-4cb3-8de5-37d2297113e3_thumb.png"
      },
      {
        "id": "1022",
        "name": "详情页-抽屉级详情",
        "score": 73,
        "file_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/5bff1fe7-7a51-41e6-8f6c-cd92781b2bbf.md",
        "thumbnail_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/bf85c790-5aa9-4d86-aec4-e5d326d0179e_thumb.png"
      },
      {
        "id": "1017",
        "name": "管理页-卡片模式",
        "score": 58,
        "file_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/86b58752-5a28-48ec-a49b-69f8fcb38d70.md",
        "thumbnail_path": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/19866e48-0775-4ca7-9bf8-4240b214daee_thumb.png"
      }
    ]
  }
  return initData;
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
