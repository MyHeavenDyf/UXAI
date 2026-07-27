/**
 * icon name 收集与 API 解析（getIconInfo）
 *
 * 数据流（简化版，不再预取 SVG）：
 *   ① 收集 JSON → 提取所有图标 name 到 Set<string>
 *   ② getIconInfo → 为每个 name 匹配 url，写入 iconInfoMap
 *   ③ getIcon → 在渲染时按需获取（由 iconRequestQueue 处理，不在本文件）
 *
 * iconInfoMap key = 图标 name（如 "settings"），value = { name, url }
 */

const ICON_API_URL = '/assetRepository/iconPlus/getIconInfo'
const MAX_STATE_DEPTH = 20

// ========== 类型 ==========

/** iconInfoMap 中的条目：name → url 映射 */
export interface IconInfoEntry {
  name: string   // API 匹配到的图标名
  url: string    // getIconInfo 返回的资源 URL
}

export interface IconResolutionResult {
  iconInfoMap: Record<string, IconInfoEntry>
}

interface JsonData {
  state?: Record<string, any>
  rootId?: string
  elements?: any[]
}

// ========== ① 收集图标名 ==========

function collectIconNamesFromJson(data: JsonData, names: Set<string>): void {
  if (data.elements && Array.isArray(data.elements)) {
    for (const el of data.elements) {
      collectIconNamesFromElement(el, names)
    }
  }
  if (data.state && typeof data.state === 'object') {
    collectIconNamesFromState(data.state, names, 0)
  }
}

function collectIconNamesFromElement(el: any, names: Set<string>): void {
  if (!el || typeof el !== 'object') return

  // Icon 组件：收集 props.name
  if (el.component === 'Icon' && el.props?.name && typeof el.props.name === 'string') {
    names.add(el.props.name)
  }

  // 其他组件 props.icon：收集 icon 名
  if (el.props && typeof el.props.icon === 'string' && el.component !== 'Icon') {
    names.add(el.props.icon)
  }

  // props.items 中的 icon 字段
  if (el.props?.items && Array.isArray(el.props.items)) {
    collectIconNamesFromArray(el.props.items, names)
  }

  // children 递归
  if (el.children && Array.isArray(el.children)) {
    for (const child of el.children) {
      if (typeof child === 'string') continue
      collectIconNamesFromElement(child, names)
    }
  }
}

function collectIconNamesFromArray(arr: any[], names: Set<string>): void {
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.icon === 'string') {
      names.add(item.icon)
    }
    if (Array.isArray(item.children)) {
      collectIconNamesFromArray(item.children, names)
    }
  }
}

function collectIconNamesFromState(value: any, names: Set<string>, depth: number): void {
  if (depth > MAX_STATE_DEPTH) return
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIconNamesFromState(item, names, depth + 1)
    }
    return
  }

  if (typeof value === 'object') {
    if (typeof value.icon === 'string') {
      names.add(value.icon)
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object') {
        collectIconNamesFromState(v, names, depth + 1)
      }
    }
  }
}

// ========== ② getIconInfo → 填充 name、url ==========

async function fillIconInfoFromApi(
  names: string[],
): Promise<Record<string, IconInfoEntry>> {
  const BATCH_SIZE = 6
  const iconInfoMap: Record<string, IconInfoEntry> = {}

  const batches: string[][] = []
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE))
  }

  const apiResults = new Map<string, Array<{ icon_id: string; name: string; category: string; group: string[]; url: string }>>()

  for (const batch of batches) {
    const keyword = encodeURIComponent(batch.join(','))
    const apiUrl = `${ICON_API_URL}?keyword=${keyword}&topK=2&source_id=6`

    try {
      const resp = await fetch(apiUrl)
      if (!resp.ok) {
        console.warn(`[resolveIcons] getIconInfo 失败 HTTP ${resp.status}`)
        continue
      }
      const data = await resp.json()
      if (Array.isArray(data)) {
        for (const item of data) {
          const icons = (item.icons || []).map((icon: any) => ({
            icon_id: icon.icon_id || '',
            name: icon.name || '',
            category: icon.category || '',
            group: icon.group || [],
            url: icon.url || '',
          }))
          apiResults.set(item.keyword, icons)
        }
      }
    } catch (err: any) {
      console.warn(`[resolveIcons] getIconInfo 失败: ${err.message}`)
    }
  }

  // 为每个 name 匹配 API 结果，写入 iconInfoMap
  for (const name of names) {
    const icons = apiResults.get(name)
    if (!icons?.length) continue

    // 匹配策略：系统图标组 → name 匹配 → 首个
    let selected = icons.find(icon =>
      Array.isArray(icon.group) && icon.group.some(g => g.includes('系统图标'))
    ) || icons.find(icon =>
      icon.name?.toLowerCase().includes(name.toLowerCase())
    ) || icons[0]

    iconInfoMap[name] = {
      name: selected.name,
      url: selected.url,
    }
  }

  return iconInfoMap
}

// ========== 主流程 ==========

/**
 * ① 收集 → ② getIconInfo
 * @returns iconInfoMap — name → {name, url}
 */
export async function resolveAllIcons(dataSources: JsonData[]): Promise<IconResolutionResult> {
  const names = new Set<string>()

  for (const data of dataSources) {
    collectIconNamesFromJson(data, names)
  }

  const nameList = Array.from(names).filter(Boolean)
  if (nameList.length === 0) return { iconInfoMap: {} }

  const iconInfoMap = await fillIconInfoFromApi(nameList)
  return { iconInfoMap }
}
