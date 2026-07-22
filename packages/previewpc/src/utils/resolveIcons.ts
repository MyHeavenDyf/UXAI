/**
 * 收集 JSON 数据中所有 icon 引用，调用 API 映射为 icon_id 和 SVG
 *
 * 收集范围（区分 Icon 组件与其他组件）：
 *   A. elements 节点树：
 *      1. `component === 'Icon'` 节点的 `props.name` — 记录 IconContext（含 shapes Set）
 *      2. 任意节点 `props.icon`（字符串字面量，如 Button 的 icon prop）— 标记为 OtherComponent
 *      3. 任意节点 `props.items` 数组中元素的 `icon` 字段 — 标记为 OtherComponent
 *      4. `children` 递归
 *   B. state 数据：
 *      5. 递归遍历 state 中所有对象/数组，收集任意 `icon` 字段的字符串值 — 标记为 OtherComponent
 *
 * 重要：同一图标名在Icon组件中可能以不同shape出现（如outline+fill），需要分别获取对应风格的SVG。
 * 仅Icon组件有shape区分，其他组件一律视为线性(border)风格。
 */

import { fetchSvgBatch, getStyleValue } from './fetchSvg'

const ICON_API_URL = '/iconPlus/getIconInfo'
const MAX_STATE_DEPTH = 20

/** 将下划线格式名称转换为 IconPlus 前缀的 PascalCase 组件名 */
function toIconComponentName(raw: string): string {
  const segments = raw.trim().split('_').filter(Boolean)
  const pascal = segments.map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
  return `IconPlus${pascal}`
}

/** 图标来源上下文：区分 Icon 独立组件与其他组件的 icon 属性 */
export interface IconContext {
  sourceType: 'IconComponent' | 'OtherComponent'
  /** Icon组件出现的所有shape值（同名不同shape合并到Set中） */
  shapes: Set<string>  // 仅 IconComponent 有，如 Set(['outline', 'fill'])
}

interface JsonData {
  state?: Record<string, any>
  rootId?: string
  elements?: any[]
}

/** resolveAllIcons 的返回类型 */
export interface IconResolutionResult {
  /** a2ui 图标名 → IconPlusXxx 组件名 */
  componentNameMap: Record<string, string>
  /** a2ui 图标名 → icon_id */
  iconIdMap: Record<string, string>
  /** a2ui 图标名 → 图标来源上下文 */
  iconContextMap: Record<string, IconContext>
}

// ========== 收集阶段 ==========

/** 从单个 JSON 数据中收集所有 icon 名称及其上下文 */
function collectIconNamesFromJson(
  data: JsonData,
  names: Set<string>,
  contextMap: Map<string, IconContext>,
): void {
  if (data.elements && Array.isArray(data.elements)) {
    for (const el of data.elements) {
      collectIconNamesFromElement(el, names, contextMap)
    }
  }
  if (data.state && typeof data.state === 'object') {
    collectIconNamesFromState(data.state, names, contextMap, 0)
  }
}

function collectIconNamesFromElement(
  el: any,
  names: Set<string>,
  contextMap: Map<string, IconContext>,
): void {
  if (!el || typeof el !== 'object') return

  // 1. Icon 组件节点的 props.name — 记录完整上下文，合并所有shape
  if (el.component === 'Icon' && el.props?.name && typeof el.props.name === 'string') {
    names.add(el.props.name)
    const shape = el.props.shape || 'outline'
    const existing = contextMap.get(el.props.name)
    if (existing && existing.sourceType === 'IconComponent') {
      existing.shapes.add(shape)  // 同名不同shape → 合入Set
    } else {
      contextMap.set(el.props.name, {
        sourceType: 'IconComponent',
        shapes: new Set([shape]),
      })
    }
  }

  // 2. 任意节点 props.icon（字符串字面量，如 Button）— 标记为 OtherComponent
  if (el.props && typeof el.props.icon === 'string' && el.component !== 'Icon') {
    names.add(el.props.icon)
    if (!contextMap.has(el.props.icon)) {
      contextMap.set(el.props.icon, { sourceType: 'OtherComponent', shapes: new Set() })
    }
  }

  // 3. props.items 数组中元素的 icon 字段
  if (el.props?.items && Array.isArray(el.props.items)) {
    collectIconNamesFromArray(el.props.items, names, contextMap)
  }

  // 4. 递归 children
  if (el.children && Array.isArray(el.children)) {
    for (const child of el.children) {
      if (typeof child === 'string') continue
      collectIconNamesFromElement(child, names, contextMap)
    }
  }
}

function collectIconNamesFromArray(
  arr: any[],
  names: Set<string>,
  contextMap: Map<string, IconContext>,
): void {
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.icon === 'string') {
      names.add(item.icon)
      if (!contextMap.has(item.icon)) {
        contextMap.set(item.icon, { sourceType: 'OtherComponent', shapes: new Set() })
      }
    }
    if (Array.isArray(item.children)) {
      collectIconNamesFromArray(item.children, names, contextMap)
    }
  }
}

function collectIconNamesFromState(
  value: any,
  names: Set<string>,
  contextMap: Map<string, IconContext>,
  depth: number,
): void {
  if (depth > MAX_STATE_DEPTH) return
  if (value === null || value === undefined) return

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIconNamesFromState(item, names, contextMap, depth + 1)
    }
    return
  }

  if (typeof value === 'object') {
    if (typeof value.icon === 'string') {
      names.add(value.icon)
      if (!contextMap.has(value.icon)) {
        contextMap.set(value.icon, { sourceType: 'OtherComponent', shapes: new Set() })
      }
    }
    for (const v of Object.values(value)) {
      if (v && typeof v === 'object') {
        collectIconNamesFromState(v, names, contextMap, depth + 1)
      }
    }
  }
}

// ========== API 调用阶段 ==========

interface IconApiResult {
  iconId: string | null
  name: string | null
}

/**
 * 调用 icon 映射 API（分批串行请求）
 * 接口协议：GET {ICON_API_URL}?keyword={names}&topK=2
 * 返回 Array<{ keyword, icons: Array<{ icon_id, name, englishName, group? }> }>
 *
 * 匹配策略：优先系统图标组 → name字段匹配 → 第一个结果
 */
async function callIconApi(names: string[]): Promise<IconApiResult[]> {
  const BATCH_SIZE = 6
  const TOP_K = 2

  const batches: string[][] = []
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE))
  }

  // 串行执行批次请求，避免并发
  const results: IconApiResult[] = []
  for (const batch of batches) {
    const keyword = encodeURIComponent(batch.join(','))
    const url = `${ICON_API_URL}?keyword=${keyword}&topK=${TOP_K}`

    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(`[resolveIcons] 批次请求失败 HTTP ${resp.status}`)
        results.push(...batch.map(() => ({ iconId: null, name: null })))
        continue
      }
      const data = await resp.json()
      if (Array.isArray(data)) {
        for (const item of data) {
          // 优先匹配系统图标组
          const systemIcon = item.icons?.find((icon: any) =>
            Array.isArray(icon.group) && icon.group.some((g: string) => g.includes('系统图标'))
          )
          // 其次匹配name字段（icon.name 包含 keyword 子串）
          const keywordStr = item.keyword?.toLowerCase() || ''
          const nameMatch = item.icons?.find((icon: any) =>
            icon.name?.toLowerCase().includes(keywordStr)
          )
          const selected = systemIcon || nameMatch || item.icons?.[0]
          results.push({
            iconId: selected?.icon_id || null,
            name: selected?.name || null,
          })
        }
      } else {
        results.push(...batch.map(() => ({ iconId: null, name: null })))
      }
    } catch (err: any) {
      console.warn(`[resolveIcons] 批次请求失败: ${err.message}`)
      results.push(...batch.map(() => ({ iconId: null, name: null })))
    }
  }

  return results
}

// ========== 主流程 ==========

/** shape → API style value 映射 */
function shapeToStyleValue(shape: string): string {
  switch (shape) {
    case 'fill': return getStyleValue('filled')
    case 'circle': return getStyleValue('round_bottom2')
    case 'square': return getStyleValue('square_bottom2')
    default: return getStyleValue('border')
  }
}

/**
 * 从多个 JSON 数据源中收集所有 icon 名称，调用 API 映射，
 * 并按 (icon_id, style) 组合去重批量获取 SVG 文本缓存到 svgCache
 *
 * @returns { componentNameMap, iconIdMap, iconContextMap }
 */
export async function resolveAllIcons(dataSources: JsonData[]): Promise<IconResolutionResult> {
  const iconNames = new Set<string>()
  const contextMap = new Map<string, IconContext>()

  for (const data of dataSources) {
    collectIconNamesFromJson(data, iconNames, contextMap)
  }

  const names = Array.from(iconNames).filter(Boolean)
  if (names.length === 0) {
    return { componentNameMap: {}, iconIdMap: {}, iconContextMap: {} }
  }

  const componentNameMap: Record<string, string> = {}
  const iconIdMap: Record<string, string> = {}

  try {
    const apiResults = await callIconApi(names)

    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const result = apiResults[i]

      // icon_id 映射
      if (result?.iconId) {
        iconIdMap[name] = result.iconId
      }

      // 组件名映射：有 name → 生成组件名；无 name → 不映射，将回退到 lucide
      if (result?.name) {
        componentNameMap[name] = toIconComponentName(result.name)
      }
    }
  } catch (err: any) {
    console.warn(`[resolveIcons] API 调用失败 (${err.message})，图标将使用 lucide`)
  }

  // 构建 iconContextMap（将 Map 转为 Record）
  const iconContextMap: Record<string, IconContext> = {}
  for (const [key, ctx] of contextMap) {
    iconContextMap[key] = ctx
  }

  // ===== 按 (icon_id, styleValue) 组合去重，批量获取 SVG =====
  // 收集所有需要获取的 style 变体
  const fetchTasks: Map<string, Set<string>> = new Map()  // iconId → Set<styleValue>

  for (const name of names) {
    const iconId = iconIdMap[name]
    if (!iconId) continue
    const context = iconContextMap[name]

    if (!fetchTasks.has(iconId)) fetchTasks.set(iconId, new Set())
    const styles = fetchTasks.get(iconId)!

    if (context?.sourceType === 'IconComponent') {
      // Icon组件：遍历所有出现的shape，每个映射到对应的API style
      for (const shape of context.shapes) {
        styles.add(shapeToStyleValue(shape))
      }
    } else {
      // 其他组件：只需要线性(border)
      styles.add(getStyleValue('border'))
    }
  }

  // 按 styleValue 分组批量获取（去重iconId）
  const styleToIds: Record<string, Set<string>> = {}
  for (const [iconId, styleValues] of fetchTasks) {
    for (const styleValue of styleValues) {
      if (!styleToIds[styleValue]) styleToIds[styleValue] = new Set()
      styleToIds[styleValue].add(iconId)
    }
  }

  // 串行获取各风格变体
  for (const [styleValue, idSet] of Object.entries(styleToIds)) {
    await fetchSvgBatch(Array.from(idSet), styleValue, '24')
  }

  return { componentNameMap, iconIdMap, iconContextMap }
}
