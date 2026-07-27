import JSZip from "jszip"
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
  content?: any | null
  previewUrl?: string | null
}

export type BlockModuleItem = {
  id: string
  description: string
  name: string
  category: string
  file: string
  preview: string
  structure?: string
  content?: any
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
export const PAGE_RESOURCE_URL = "https://octo.hdesign.huawei.com/lib-resource-service"

export async function getResourceDetail(type = "file", dataId: string) {
  const url = `${PAGE_RESOURCE_URL}/api/vector/detail?type=${type}&data_id=${dataId}`
  const response = await fetch(url)
  if (!response.ok) {
    return { success: false, error: `HTTP error! status: ${response.status}` }
  }
  const data = await response.json()
  return { success: true, data }
}

// 获取页面pattern Md数据
export async function readPagePatternMd(mdUrl: string) {
  try {
    const response = await fetch(mdUrl)
    if (!response.ok) {
      return { success: false, error: `HTTP error! status: ${response.status}` }
    }
    const content = await response.text()
    return { success: true, content }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type ResourceDetailResult = {
  success: boolean
  data?: { file_path?: string; thumbnail_path?: string }
  error?: string
}

// 页面级默认数据
//  const pageResourceData = {
//   "results": [
//     {
//       "id": "966",
//       "name": "管理页-表格模式",
//       "score": 75,
//       "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/b3414307-b975-40f8-b5fa-bfe90f73cd9e.md",
//       "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/9d68970d-94b6-4cb3-8de5-37d2297113e3_thumb.png"
//     },
//     {
//       "id": "1022",
//       "name": "详情页-抽屉级详情",
//       "score": 73,
//       "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/5bff1fe7-7a51-41e6-8f6c-cd92781b2bbf.md",
//       "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/bf85c790-5aa9-4d86-aec4-e5d326d0179e_thumb.png"
//     },
//     {
//       "id": "1017",
//       "name": "管理页-卡片模式",
//       "score": 58,
//       "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/86b58752-5a28-48ec-a49b-69f8fcb38d70.md",
//       "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/19866e48-0775-4ca7-9bf8-4240b214daee_thumb.png"
//     }
//   ]
// }


// 获取页面级数据的资源路径
export async function getPagePatternResource(inputData: { results?: Array<Record<string, any>> }) {
  try {
    const results = inputData.results || []
    const enrichedResults = await Promise.all(
      results.map(async (item) => {
        const detailResult: ResourceDetailResult = await getResourceDetail("file", item.id)
        const enrichedItem = { ...item }
        if (detailResult.success && detailResult.data) {
          enrichedItem.file = detailResult.data.file_path || ""
          enrichedItem.preview = detailResult.data.thumbnail_path || ""
        } else {
          enrichedItem.file = ""
          enrichedItem.preview = ""
        }
        return enrichedItem
      }),
    )
    return { results: enrichedResults }
  } catch {
    return { results: [] }
  }
}

// 向量库搜索：根据 query 返回匹配的 block 资源
async function searchResources(
  queries: string | string[],
  topK: number,
  filters: Record<string, number> = { source_id: 10, group_id: 390 },
) {
  const url = `${PAGE_RESOURCE_URL}/api/vector/search`
  const payload = {
    type: "file",
    queries: Array.isArray(queries) ? queries : [queries],
    top_k: topK,
    filters,
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    return { success: false, error: `HTTP error! status: ${response.status}` }
  }
  const data = await response.json()
  return { success: true, data }
}

// 根据 modules[].description 逐个搜索向量库，解析去重后返回真实 block 信息
export async function getBlockPatternResource(modulesData: { modules?: Array<{ description?: string }> }) {
  try {
    const modules = modulesData.modules || []
    const queries = modules.map(m => m.description).filter(Boolean) as string[]
    const allResults: any[] = []
    for (const query of queries) {
      const result = await searchResources(query, 2)
      if (result.success && result.data?.results?.[0]) {
        allResults.push(...result.data.results[0])
      }
    }
    const seenIds = new Set<string>()
    const uniqueResults = allResults.filter((item) => {
      if (seenIds.has(item.id)) return false
      seenIds.add(item.id)
      return true
    }).map((item) => ({
      id: item.id,
      description: item.description || "",
      name: item.name || "",
      file: item.file_path || "",
      preview: item.thumbnail_path || "",
      category: item.tags?.length ? item.tags[0] : "",
      structure: item.search_text || "",
    }))
    return { results: uniqueResults }
  } catch {
    return { results: [] }
  }
}

// 下载 zip 并解析出 data.json 内容与 assets 文件（含 buffer）
async function fetchZipContents(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir)
  const normalized = entries.map(([name, file]) => [name.replace(/\\/g, "/"), file] as const)
  const dataJsonEntry = normalized.find(([name]) => name === "data.json" || name.endsWith("/data.json"))
  const dataJson = dataJsonEntry ? JSON.parse(await dataJsonEntry[1].async("text")) : null
  const assets = await Promise.all(
    normalized.filter(([name]) => name.includes("assets/")).map(async ([name, file]) => ({
      filename: name.split("/").pop() || name,
      buffer: await file.async("arraybuffer"),
    })),
  )
  return { dataJson, assets }
}

// 根据 results[].file 下载并解析 zip，将 content 与 assets 合并到每一项
// assets 资源会保存到 history 下，并替换 content 中的相对路径
export async function getBlockContent(inputData: { results?: BlockModuleItem[] }, sessionId: string): Promise<{ results: BlockModuleItem[] }> {
  const results = inputData.results || []
  const enrichedResults = await Promise.all(
    results.map(async (item) => {
      if (!item.file) return { ...item, content: null }
      try {
        const parsed = await fetchZipContents(item.file)
        const replacements: Record<string, string> = {}
        for (const a of parsed.assets) {
          const url = await saveUploadImage(a.buffer, sessionId)
          if (url) replacements[a.filename] = url
        }
        const content = replacePatternAssetPaths(parsed.dataJson, replacements)
        return { ...item, content }
      } catch {
        return { ...item, content: null }
      }
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
