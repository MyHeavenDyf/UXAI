/**
 * icon variant 数据收集与 API 解析
 *
 * 数据流（同一个 variantDataMap，value 逐步填充）：
 *   ① 收集 JSON → key = "name&shape&color"，value = 空对象
 *   ② getIconInfo → value 写入 name、url
 *   ③ getIcon → 拆解 key 得 style/colorId + value.url → value 写入 style、colorId、svg
 *   ④ 渲染 → 拼 key 取 variantDataMap[key].svg
 *
 * key 示例：settings&outline&default  settings&circle&success
 * 默认 color = "default"
 */

import { fetchIconBatch, getStyleValue, resolveApiColorId, svgCache } from './fetchSvg'

const ICON_API_URL = '/assetRepository/iconPlus/getIconInfo'
const MAX_STATE_DEPTH = 20

// ========== 类型 ==========

/** key 格式 "name&shape&color"，如 settings&outline&default */
export type VariantId = string

export function toVariantId(name: string, shape: string, color: string): VariantId {
  return `${name}&${shape}&${color}`
}

export function fromVariantId(id: VariantId): { name: string; shape: string; color: string } {
  const parts = id.split('&')
  return { name: parts[0] || '', shape: parts[1] || 'outline', color: parts[2] || 'default' }
}

interface JsonData {
  state?: Record<string, any>
  rootId?: string
  elements?: any[]
}

/** variant 数据，逐步填充：收集→空对象，getIconInfo→name/url，getIcon→style/colorId/svg */
export interface IconVariantData {
  name?: string
  style?: string
  colorId?: string
  url?: string
  svg?: string
}

export interface IconResolutionResult {
  variantDataMap: Record<VariantId, IconVariantData>
}

// ========== 工具 ==========

function shapeToStyleValue(shape: string): string {
  switch (shape) {
    case 'fill': return getStyleValue('filled')
    case 'circle': return getStyleValue('round_bottom2')
    case 'square': return getStyleValue('square_bottom2')
    default: return getStyleValue('border')
  }
}

// ========== ① 收集 ==========

function collectIconVariantsFromJson(
  data: JsonData,
  variantDataMap: Record<VariantId, IconVariantData>,
  names: Set<string>,
): void {
  if (data.elements && Array.isArray(data.elements)) {
    for (const el of data.elements) {
      collectIconVariantsFromElement(el, variantDataMap, names)
    }
  }
  if (data.state && typeof data.state === 'object') {
    collectIconVariantsFromState(data.state, variantDataMap, names, 0)
  }
}

function collectIconVariantsFromElement(
  el: any,
  variantDataMap: Record<VariantId, IconVariantData>,
  names: Set<string>,
): void {
  if (!el || typeof el !== 'object') return

  // Icon 组件：key = name&shape&color
  if (el.component === 'Icon' && el.props?.name && typeof el.props.name === 'string') {
    const key = toVariantId(el.props.name, el.props.shape || 'outline', el.props.color || 'default')
    names.add(el.props.name)
    if (!variantDataMap[key]) variantDataMap[key] = {}
  }

  // 其他组件 props.icon：key = name&outline&default
  if (el.props && typeof el.props.icon === 'string' && el.component !== 'Icon') {
    const key = toVariantId(el.props.icon, 'outline', 'default')
    names.add(el.props.icon)
    if (!variantDataMap[key]) variantDataMap[key] = {}
  }

  // props.items 中的 icon 字段
  if (el.props?.items && Array.isArray(el.props.items)) {
    collectIconVariantsFromArray(el.props.items, variantDataMap, names)
  }

  // children 递归
  if (el.children && Array.isArray(el.children)) {
    for (const child of el.children) {
      if (typeof child === 'string') continue
      collectIconVariantsFromElement(child, variantDataMap, names)
    }
  }
}

function collectIconVariantsFromArray(
  arr: any[],
  variantDataMap: Record<VariantId, IconVariantData>,
  names: Set<string>,
): void {
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.icon === 'string') {
      const key = toVariantId(item.icon, 'outline', 'default')
      names.add(item.icon)
      if (!variantDataMap[key]) variantDataMap[key] = {}
    }
    if (Array.isArray(item.children)) {
      collectIconVariantsFromArray(item.children, variantDataMap, names)
    }
  }
}

function collectIconVariantsFromState(
  value: any,
  variantDataMap: Record<VariantId, IconVariantData>,
  names: Set<string>,
  depth: number,
): void {
  if (depth > MAX_STATE_DEPTH) return
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIconVariantsFromState(item, variantDataMap, names, depth + 1)
    }
    return
  }

  if (typeof value === 'object') {
    if (typeof value.icon === 'string') {
      const key = toVariantId(value.icon, 'outline', 'default')
      names.add(value.icon)
      if (!variantDataMap[key]) variantDataMap[key] = {}
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object') {
        collectIconVariantsFromState(v, variantDataMap, names, depth + 1)
      }
    }
  }
}

// ========== ② getIconInfo → 填充 name、url ==========

async function fillIconInfoFromApi(
  names: string[],
  variantDataMap: Record<VariantId, IconVariantData>,
): Promise<void> {
  const BATCH_SIZE = 6

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

  // 为每个 key 匹配 API 结果，写入 value.name 和 value.url
  for (const [key, value] of Object.entries(variantDataMap)) {
    const { name: iconName, shape } = fromVariantId(key)

    const icons = apiResults.get(iconName)
    if (!icons?.length) continue

    // 匹配策略：系统图标组 → name 匹配 → 首个
    let selected = icons.find(icon =>
      Array.isArray(icon.group) && icon.group.some(g => g.includes('系统图标'))
    ) || icons.find(icon =>
      icon.name?.toLowerCase().includes(iconName.toLowerCase())
    ) || icons[0]

    // 非 outline 优先匹配含 shape 关键词的图标名
    if (shape !== 'outline') {
      const shapeMatch = icons.find(icon => {
        switch (shape) {
          case 'fill': return /filled|fill|面性/i.test(icon.name)
          case 'circle': return /round|circle|圆/i.test(icon.name)
          case 'square': return /square|方/i.test(icon.name)
          default: return false
        }
      })
      if (shapeMatch) selected = shapeMatch
    }

    value.name = selected.name
    value.url = selected.url
  }
}

// ========== ③ getIcon → 拆解 key 得 style/colorId + value.url → 写入 svg ==========

async function fillSvgFromApi(
  variantDataMap: Record<VariantId, IconVariantData>,
): Promise<void> {
  // 按 (style, colorId) 分组去重 url
  const fetchGroups: Map<string, {
    urls: Set<string>
    style: string
    colorId: string
    keys: VariantId[]
  }> = new Map()

  for (const [key, value] of Object.entries(variantDataMap)) {
    if (!value.url) continue

    const { shape, color } = fromVariantId(key)
    const style = shapeToStyleValue(shape)
    const colorId = resolveApiColorId(shape, color)

    value.style = style
    value.colorId = colorId

    const groupKey = `${style}&${colorId}`
    if (!fetchGroups.has(groupKey)) {
      fetchGroups.set(groupKey, { urls: new Set(), style, colorId, keys: [] })
    }
    fetchGroups.get(groupKey)!.urls.add(value.url)
    fetchGroups.get(groupKey)!.keys.push(key)
  }

  for (const group of fetchGroups.values()) {
    const results = await fetchIconBatch(Array.from(group.urls), group.style, '16', group.colorId)

    for (const key of group.keys) {
      const data = variantDataMap[key]
      if (!data?.url) continue
      const cacheKey = `${data.url}:${group.style}:${group.colorId}`
      const svg = results.get(cacheKey) || svgCache.get(cacheKey) || ''
      if (svg) data.svg = svg
    }
  }
}

// ========== 主流程 ==========

/**
 * ① 收集 → ② getIconInfo → ③ getIcon
 * @returns variantDataMap — 渲染时按 key 取 value.svg
 */
export async function resolveAllIcons(dataSources: JsonData[]): Promise<IconResolutionResult> {
  const variantDataMap: Record<VariantId, IconVariantData> = {}
  const names = new Set<string>()

  for (const data of dataSources) {
    collectIconVariantsFromJson(data, variantDataMap, names)
  }

  const nameList = Array.from(names).filter(Boolean)
  if (nameList.length === 0) return { variantDataMap: {} }

  await fillIconInfoFromApi(nameList, variantDataMap)
  await fillSvgFromApi(variantDataMap)

  return { variantDataMap }
}
