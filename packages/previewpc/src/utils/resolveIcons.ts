/**
 * 收集 JSON 数据中所有 icon 引用，调用新 API 映射为 url 和 SVG
 *
 * 新API协议：
 *   1. /assetRepository/iconPlus/getIconInfo — 搜索图标（返回 url 字段）
 *   2. /assetRepository/iconPlus/getIcon — 用 url 获取 SVG（替代旧的 getSvg + icon_id）
 *
 * 数据流：
 *   ① 收集阶段：扫描 JSON → 以 key = "name&shape&color" 存入 variantDataMap，value 为空对象
 *   ② getIconInfo 阶段：按 name 调 API → 将返回的 name、url 写入对应 value
 *   ③ getIcon 阶段：拆解 key 得到 shape→style、color→colorId → 加上 value.url 调 getIcon → 将 svg 写入 value
 *   ④ 渲染阶段：组件 props 拼出 key → 从 variantDataMap 取 value.svg
 *
 * key 格式如：settings&circle&success、settings&outline&default
 * 无指定 color 时默认为 "default"
 *
 * 收集范围（区分 Icon 组件与其他组件）：
 *   A. elements 节点树：
 *      1. `component === 'Icon'` 节点的 `props.name` — 记录 name + shape + color
 *      2. 任意节点 `props.icon`（如 Button）— 默认 outline + default
 *      3. `props.items` 数组中元素的 `icon` 字段 — 默认 outline + default
 *      4. `children` 递归
 *   B. state 数据：
 *      5. 递归遍历，收集任意 `icon` 字段字符串值 — 默认 outline + default
 */

import { fetchIconBatch, getStyleValue, resolveApiColorId, svgCache } from './fetchSvg'

const ICON_API_URL = '/assetRepository/iconPlus/getIconInfo'
const MAX_STATE_DEPTH = 20

// ========== 类型定义 ==========

/** Variant 标识符：格式为 "name&shape&color"，如 settings&outline&default */
export type VariantId = string

/** 构造 VariantId */
export function toVariantId(name: string, shape: string, color: string): VariantId {
  return `${name}&${shape}&${color}`
}

/** 解析 VariantId 为各组成部分 */
export function fromVariantId(id: VariantId): { name: string; shape: string; color: string } {
  const parts = id.split('&')
  return { name: parts[0] || '', shape: parts[1] || 'outline', color: parts[2] || 'default' }
}

/** JSON 数据结构 */
interface JsonData {
  state?: Record<string, any>
  rootId?: string
  elements?: any[]
}

/**
 * 每个 variant 的数据对象，逐步填充：
 *   收集阶段 → 创建空对象（仅有 shape、color 用于后续拆解）
 *   getIconInfo → 填充 name、url
 *   getIcon → 填充 style、colorId、svg
 */
export interface IconVariantData {
  name?: string                 // 原始图标名称（getIconInfo 填充，如 'ic_public_settings'）
  style?: string                // API style 值（getIcon 填充，如 "线性"、"面性"）
  colorId?: string              // API 颜色 ID（getIcon 填充，如 "GTS_线性_Gray-10"）
  url?: string                  // getIconInfo 返回的 url
  svg?: string                  // getIcon 返回的 SVG 文本
}

/** resolveAllIcons 返回类型 */
export interface IconResolutionResult {
  variantDataMap: Record<VariantId, IconVariantData>
}

// ========== 工具函数 ==========

/** shape → API style value 映射 */
function shapeToStyleValue(shape: string): string {
  switch (shape) {
    case 'fill': return getStyleValue('filled')
    case 'circle': return getStyleValue('round_bottom2')
    case 'square': return getStyleValue('square_bottom2')
    default: return getStyleValue('border')
  }
}

// ========== 阶段①：收集 ==========

/** 从单个 JSON 数据中收集所有 icon variants，存入 variantDataMap */
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

  // 1. Icon 组件节点：收集 name + shape + color
  if (el.component === 'Icon' && el.props?.name && typeof el.props.name === 'string') {
    const name = el.props.name
    const shape = el.props.shape || 'outline'
    const color = el.props.color || 'default'
    const key = toVariantId(name, shape, color)
    names.add(name)
    if (!variantDataMap[key]) {
      variantDataMap[key] = {}  // 空对象，后续阶段逐步填充
    }
  }

  // 2. 任意节点 props.icon（如 Button）— 默认 outline + default
  if (el.props && typeof el.props.icon === 'string' && el.component !== 'Icon') {
    const name = el.props.icon
    const key = toVariantId(name, 'outline', 'default')
    names.add(name)
    if (!variantDataMap[key]) {
      variantDataMap[key] = {}
    }
  }

  // 3. props.items 数组中元素的 icon 字段
  if (el.props?.items && Array.isArray(el.props.items)) {
    collectIconVariantsFromArray(el.props.items, variantDataMap, names)
  }

  // 4. 递归 children
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
      const name = item.icon
      const key = toVariantId(name, 'outline', 'default')
      names.add(name)
      if (!variantDataMap[key]) {
        variantDataMap[key] = {}
      }
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
      const name = value.icon
      const key = toVariantId(name, 'outline', 'default')
      names.add(name)
      if (!variantDataMap[key]) {
        variantDataMap[key] = {}
      }
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object') {
        collectIconVariantsFromState(v, variantDataMap, names, depth + 1)
      }
    }
  }
}

// ========== 阶段②：调用 getIconInfo，填充 name 和 url ==========

/**
 * 调用 getIconInfo（分批串行），将 name 和 url 写入 variantDataMap
 *
 * API：GET /assetRepository/iconPlus/getIconInfo?keyword={names}&topK=2
 * 返回 Array<{ keyword, icons: Array<{ icon_id, name, category, group, url }> }>
 */
async function fillIconInfoFromApi(
  names: string[],
  variantDataMap: Record<VariantId, IconVariantData>,
): Promise<void> {
  const BATCH_SIZE = 6
  const TOP_K = 2

  const batches: string[][] = []
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE))
  }

  // 为每个 name 记录 API 返回的全部图标信息（供 shape 匹配使用）
  const apiResults = new Map<string, Array<{ icon_id: string; name: string; category: string; group: string[]; url: string }>>()

  for (const batch of batches) {
    const keyword = encodeURIComponent(batch.join(','))
    const url = `${ICON_API_URL}?keyword=${keyword}&topK=${TOP_K}`

    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(`[resolveIcons] getIconInfo 批次请求失败 HTTP ${resp.status}`)
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
      console.warn(`[resolveIcons] getIconInfo 批次请求失败: ${err.message}`)
    }
  }

  // 遍历 variantDataMap，为每个 key 匹配 API 结果并填充 name、url
  for (const [key, value] of Object.entries(variantDataMap)) {
    const { name: iconName, shape, color } = fromVariantId(key)

    const icons = apiResults.get(iconName)
    if (!icons?.length) continue  // API 无结果，保持 value 为空对象 → 渲染时回退 lucide

    // 选择最佳匹配图标
    let selected = icons.find(icon =>
      Array.isArray(icon.group) && icon.group.some(g => g.includes('系统图标'))
    ) || icons.find(icon =>
      icon.name?.toLowerCase().includes(iconName.toLowerCase())
    ) || icons[0]

    // 非 outline shape 时，优先匹配名称含对应 shape 关键词的图标
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

    // 填充 value：name 和 url
    value.name = selected.name
    value.url = selected.url
  }
}

// ========== 阶段③：调用 getIcon，填充 style、colorId 和 svg ==========

/**
 * 拆解 key 得到 shape→style、color→colorId，
 * 根据 value.url 调用 getIcon 批量获取 SVG，
 * 将 style、colorId、svg 写入 value
 */
async function fillSvgFromApi(
  variantDataMap: Record<VariantId, IconVariantData>,
): Promise<void> {
  // 将有 url 的 variants 按 (style, colorId) 分组，去重 url
  const fetchGroups: Map<string, {
    urls: Set<string>,
    style: string,
    colorId: string,
    keys: VariantId[],
  }> = new Map()

  for (const [key, value] of Object.entries(variantDataMap)) {
    if (!value.url) continue  // 无 url → 不调 getIcon，渲染时回退 lucide

    const { shape, color } = fromVariantId(key)
    const style = shapeToStyleValue(shape)
    const colorId = resolveApiColorId(shape, color)

    // 先在 value 中记录 style 和 colorId
    value.style = style
    value.colorId = colorId

    const groupKey = `${style}&${colorId}`
    if (!fetchGroups.has(groupKey)) {
      fetchGroups.set(groupKey, {
        urls: new Set(),
        style,
        colorId,
        keys: [],
      })
    }
    const group = fetchGroups.get(groupKey)!
    group.urls.add(value.url)
    group.keys.push(key)
  }

  // 串行获取各组的 SVG
  for (const group of fetchGroups.values()) {
    const urlArray = Array.from(group.urls)
    const results = await fetchIconBatch(urlArray, group.style, '24', group.colorId)

    // 将 SVG 写入每个 variant 的 value
    for (const key of group.keys) {
      const data = variantDataMap[key]
      if (!data?.url) continue
      const cacheKey = `${data.url}:${group.style}:${group.colorId}`
      const svg = results.get(cacheKey) || svgCache.get(cacheKey) || ''
      if (svg) {
        data.svg = svg
      }
    }
  }
}

// ========== 主流程 ==========

/**
 * 从 JSON 数据源中收集 icon variants，分阶段填充数据：
 *   ① 收集 → 创建 variantDataMap（key = name&shape&color，value = 空对象）
 *   ② getIconInfo → 填充 name、url
 *   ③ getIcon → 填充 style、colorId、svg
 *
 * @returns variantDataMap — 渲染时按 key 取 value.svg
 */
export async function resolveAllIcons(dataSources: JsonData[]): Promise<IconResolutionResult> {
  const variantDataMap: Record<VariantId, IconVariantData> = {}
  const names = new Set<string>()

  // 阶段①：收集 JSON 中的 icon 引用，存入 variantDataMap
  for (const data of dataSources) {
    collectIconVariantsFromJson(data, variantDataMap, names)
  }

  const nameList = Array.from(names).filter(Boolean)
  if (nameList.length === 0) {
    return { variantDataMap: {} }
  }

  // 阶段②：调 getIconInfo，将 name 和 url 写入 value
  await fillIconInfoFromApi(nameList, variantDataMap)

  // 阶段③：拆解 key 得到 style/colorId，根据 value.url 调 getIcon，将 svg 写入 value
  await fillSvgFromApi(variantDataMap)

  return { variantDataMap }
}
