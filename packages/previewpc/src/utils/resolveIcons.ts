/**
 * 收集 JSON 数据中所有 icon 引用，调用 API 映射为 @hui/icon-plus-vue 组件名
 *
 * 收集范围：
 *   A. elements 节点树：
 *      1. `component === 'Icon'` 节点的 `props.name`
 *      2. 任意节点 `props.icon`（字符串字面量，如 Button 的 icon prop）
 *      3. 任意节点 `props.items` 数组中元素的 `icon` 字段
 *      4. `children` 递归
 *   B. state 数据：
 *      5. 递归遍历 state 中所有对象/数组，收集任意 `icon` 字段的字符串值
 */

const ICON_API_URL = 'https://octo-beta.hdesign.huawei.com/iconPlus/getIconInfo'
const PLACEHOLDER_ICON = 'IconPlusIcPublicTransverseRectangleTemplate'
const MAX_STATE_DEPTH = 20

/** 将下划线格式名称转换为 IconPlus 前缀的 PascalCase 组件名 */
function toIconComponentName(raw: string): string {
  const segments = raw.trim().split('_').filter(Boolean)
  const pascal = segments.map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
  return `IconPlus${pascal}`
}

interface JsonData {
  state?: Record<string, any>
  rootId?: string
  elements?: any[]
}

/** 从单个 JSON 数据中收集所有 icon 名称 */
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

  // 1. Icon 组件节点的 props.name
  if (el.component === 'Icon' && el.props?.name && typeof el.props.name === 'string') {
    names.add(el.props.name)
  }

  // 2. 任意节点 props.icon（字符串字面量，如 Button）
  if (el.props && typeof el.props.icon === 'string') {
    names.add(el.props.icon)
  }

  // 3. props.items 数组中元素的 icon 字段
  if (el.props?.items && Array.isArray(el.props.items)) {
    collectIconNamesFromArray(el.props.items, names)
  }

  // 4. 递归 children
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

/**
 * 调用 icon 映射 API（分批并发请求）
 * 接口协议：GET {ICON_API_URL}?keyword={names}&topK=2
 * 返回 Array<{ icons: Array<{ name, group? }> }>
 */
async function callIconApi(names: string[]): Promise<(string | null)[]> {
  const BATCH_SIZE = 6
  const TOP_K = 2

  const batches: string[][] = []
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE))
  }

  const batchPromises = batches.map(async (batch) => {
    const keyword = encodeURIComponent(batch.join(','))
    const url = `${ICON_API_URL}?keyword=${keyword}&topK=${TOP_K}`

    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(`[resolveIcons] 批次请求失败 HTTP ${resp.status}`)
        return batch.map(() => null)
      }
      const data = await resp.json()
      if (Array.isArray(data)) {
        return data.map((item: any) => {
          const systemIcon = item.icons?.find((icon: any) =>
            Array.isArray(icon.group) && icon.group.some((g: string) => g.includes('系统图标'))
          )
          return systemIcon?.name || item.icons?.[0]?.name || null
        })
      }
      return batch.map(() => null)
    } catch (err: any) {
      console.warn(`[resolveIcons] 批次请求失败: ${err.message}`)
      return batch.map(() => null)
    }
  })

  const results = await Promise.all(batchPromises)
  return results.flat()
}

/**
 * 从多个 JSON 数据源中收集所有 icon 名称，调用 API 映射，
 * 返回 { [a2ui图标名]: IconPlusXxx 组件名 } 的映射表
 */
export async function resolveAllIcons(dataSources: JsonData[]): Promise<Record<string, string>> {
  const iconNames = new Set<string>()

  for (const data of dataSources) {
    collectIconNamesFromJson(data, iconNames)
  }

  const names = Array.from(iconNames).filter(Boolean)
  if (names.length === 0) return {}

  const iconNameMap: Record<string, string> = {}

  try {
    const englishNames = await callIconApi(names)
    for (let i = 0; i < names.length; i++) {
      const target = englishNames[i]
      iconNameMap[names[i]] = (typeof target === 'string' && target)
        ? toIconComponentName(target)
        : PLACEHOLDER_ICON
    }
  } catch (err: any) {
    console.warn(`[resolveIcons] API 调用失败 (${err.message})，使用占位图标`)
    for (const name of names) {
      iconNameMap[name] = PLACEHOLDER_ICON
    }
  }

  return iconNameMap
}
