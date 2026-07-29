/**
 * icon-collection — 图标名收集、解析与构建模块
 *
 * 三块职责：
 *   1. IconCollector（收集）+ resolveAll（API 映射）
 *   2. resolveIcon（构建 Icon 组件节点，供 NodeMapper.transformContext 使用）
 *   3. 各种辅助函数
 *
 * 相关映射表在 icon-props.ts。
 */

import {
  ICON_PROPS_BY_COMPONENT,
  ICON_PROPS_NESTED_IN_ARRAYS,
} from './iconProps'
import type { BuildNode } from './nodeTypes'
import type { PropValue } from './valueTypes'

const PLACEHOLDER_ICON = 'IconPlusIcPublicTransverseRectangleTemplate'

const ICON_API_URL = 'https://octo.hdesign.huawei.com/assetRepository/iconPlus/getIconInfo'
const BATCH_SIZE = 6
const TOP_K = 2
const SOURCE_ID = 6

export interface IconCollectionResult {
  iconNameMap: Record<string, string>  // A2UI name → @nce/icon-plus 组件名
}

/**
 * 把下划线/小写 icon name 转为 PascalCase 组件名
 * 'ic_bpit_home' → 'IconPlusIcBpitHome'
 */
function toIconComponentName(raw: string): string {
  const segments = raw.trim().split('_').filter(Boolean)
  const pascal = segments.map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
  return `IconPlus${pascal}`
}

/**
 * 从 state 中按 accessPath 取实际值
 * accessPath: '/menuItems' → state.menuItems
 */
function resolvePath(state: Record<string, any>, path: string): any {
  if (!path) return undefined
  const segments = path.split('/').filter(Boolean)
  let current: any = state
  for (const seg of segments) {
    if (current == null) return undefined
    current = current[seg]
  }
  return current
}

export class IconCollector {
  private iconNameSet: Set<string> = new Set<string>()
  private state: Record<string, any> = {}

  setState(state: Record<string, any>): void {
    this.state = state || {}
  }

  /**
   * 从节点 props 收集字面量 icon（按组件图标映射表）
   * 在 BuildTrees 创建节点时调用
   */
  collectFromNodeProps(component: string, props: Record<string, PropValue>): void {
    const directIconProps = ICON_PROPS_BY_COMPONENT[component]
    if (directIconProps) {
      for (const propName of directIconProps) {
        const value = props[propName]
        if (typeof value === 'string') {
          this.iconNameSet.add(value)
        }
      }
    }

    const arrayProps = ICON_PROPS_NESTED_IN_ARRAYS[component]
    if (arrayProps) {
      for (const arrayProp of arrayProps) {
        const arr = props[arrayProp]
        if (Array.isArray(arr)) {
          this.#collectFromArrayItems(arr)
        }
      }
    }
  }

  /**
   * 从嵌套数组 prop（Menu `items` / Dropdown `menu` / Tree `options` 等）递归收集 icon。
   *
   * 数组项可多层嵌套：Menu items 的子项放在 `children` 里，其 `icon` 也要收集；
   * 仅查第一层 `item.icon` 会漏掉深层 `children[].icon`。
   */
  #collectFromArrayItems(items: any[]): void {
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (typeof (item as Record<string, any>).icon === 'string') {
        this.iconNameSet.add((item as Record<string, any>).icon)
      }
      if (Array.isArray((item as Record<string, any>).children)) {
        this.#collectFromArrayItems((item as Record<string, any>).children)
      }
    }
  }

  /**
   * 收集 DataBinding 绑定的图标值（从 state 中按 path 取实际值）
   * 解析值如果是 string → 直接收集；array → 遍历元素；object → 看 icon 字段 + 递归
   * 限 icon prop 调用（ICON_PROPS_BY_COMPONENT / ICON_PROPS_NESTED_IN_ARRAYS）
   */
  collectFromBinding(path: string, pathType: 'absolute' | 'relative'): void {
    if (!this.state) return
    const lookupPath = pathType === 'absolute' ? path.replace(/^\//, '') : path
    const value = resolvePath(this.state, lookupPath)
    this.#collectFromValue(value)
  }

  /**
   * 从任意【已解析】值中递归收集 icon 名。
   *
   * 供 BuildTrees 在 binding 的 stateValue 快照上调用：
   *   - 绝对路径 binding：stateValue 即 state 中按 path 取出的完整值（数组/对象/字符串）；
   *   - 相对路径 binding：由 BuildTrees 沿 loopStack 解析循环数组各项后逐项传入
   *     （icon 名可能各 item 不同，需全量收集，不能只取首项）。
   */
  collectFromValue(value: any): void {
    this.#collectFromValue(value)
  }

  /**
   * 从任意值中提取 icon
   */
  #collectFromValue(value: any): void {
    if (value === null || value === undefined) return

    if (typeof value === 'string') {
      this.iconNameSet.add(value)
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) this.#collectFromValue(item)
      return
    }

    if (typeof value === 'object') {
      if (typeof value.icon === 'string') {
        this.iconNameSet.add(value.icon)
      }
      for (const v of Object.values(value)) {
        if (v && typeof v === 'object') this.#collectFromValue(v)
      }
    }
  }

  /**
   * 防御性：state 全量递归收集所有 icon 字段
   * 在 BuildTrees 主遍历完成后调用
   */
  collectFromState(): void {
    if (!this.state || typeof this.state !== 'object') return
    this.#walkStateForIcons(this.state, 0)
  }

  #walkStateForIcons(value: any, depth: number): void {
    if (depth > 20) return
    if (value === null || value === undefined) return

    if (Array.isArray(value)) {
      for (const item of value) {
        this.#walkStateForIcons(item, depth + 1)
      }
      return
    }

    if (typeof value === 'object') {
      if (typeof value.icon === 'string') {
        this.iconNameSet.add(value.icon)
      }
      for (const v of Object.values(value)) {
        if (v && typeof v === 'object') {
          this.#walkStateForIcons(v, depth + 1)
        }
      }
    }
  }

  getIconNames(): string[] {
    const names = Array.from(this.iconNameSet).filter(Boolean)
    return names
  }

  /**
   * 调用 icon API 解析所有 name
   */
  async resolveAll(): Promise<IconCollectionResult> {
    const names = this.getIconNames()
    const iconNameMap: Record<string, string> = {}

    if (names.length === 0) {
      return { iconNameMap }
    }

    try {
      const englishNames = await this.#callIconApi(ICON_API_URL, names)
      for (let i = 0; i < names.length; i++) {
        const target = englishNames[i]
        iconNameMap[names[i]] = (typeof target === 'string' && target)
          ? toIconComponentName(target)
          : PLACEHOLDER_ICON
      }
    } catch (err: any) {
      console.warn(`  [warn] IconCollector: API 调用失败 (${err.message})，使用占位图标`)
      for (const name of names) {
        iconNameMap[name] = PLACEHOLDER_ICON
      }
    }

    return { iconNameMap }
  }

  /**
   * 分批并发调用 API
   */
  async #callIconApi(apiUrl: string, names: string[]): Promise<(string | null)[]> {
    const batches: string[][] = []
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      batches.push(names.slice(i, i + BATCH_SIZE))
    }

    const batchPromises = batches.map(async (batch) => {
      const keyword = encodeURIComponent(batch.join(','))
      const url = `${apiUrl}?keyword=${keyword}&topK=${TOP_K}&source_id=${SOURCE_ID}`

      try {
        const resp = await fetch(url)
        if (!resp.ok) return batch.map(() => null)

        const data: any = await resp.json()
        if (Array.isArray(data)) {
          return data.map((item: any) => {
            const systemIcon = item.icons?.find((icon: any) =>
              Array.isArray(icon.group) && icon.group.some((g: string) => g.includes('系统图标'))
            )
            return systemIcon?.name || item.icons?.[0]?.name || null
          })
        }
        return batch.map(() => null)
      } catch {
        return batch.map(() => null)
      }
    })

    const results = await Promise.all(batchPromises)
    return results.flat()
  }
}

// ─── resolveIcon — 构建 Icon 组件节点 ───
//
// 参考：api/config/mappings/eview-react/Icon.ts
// 输入 A2UI icon name + iconNameMap → 输出已解析的 ComponentNode

/**
 * 当前目标库的配套图标库包名。
 * 默认 @nce/icon-plus（eview-react）；registerComponents 选库后通过 setIconPackage
 * 注入对应库的值（如 eview-ui 的 @hui/icon-plus）。resolveIcon emit 图标 import 用。
 * 管线单 lib 单次跑，模块级状态安全。
 */
let iconPkg = '@nce/icon-plus'

/** 注入当前目标库的图标库包名（registerComponents 选库后调用） */
export function setIconPackage(p: string): void {
  iconPkg = p
}

/** 读取当前目标库的图标库包名（importCollector 排序识别图标 import 用） */
export function getIconPackage(): string {
  return iconPkg
}

export function resolveIcon(
  iconName: string,
  iconNameMap: Record<string, string>,
  iconProps?: Record<string, any>
): any {
  const targetIconName = iconNameMap[iconName] || PLACEHOLDER_ICON

  const props: Record<string, any> = {}
  if (iconProps) {
    // @nce/icon-plus 的 iconColor prop 接受数组：["primary"]
    // （单个颜色以数组形式传入，支持后续扩展多色）
    if (iconProps.color) props.iconColor = [iconProps.color]
    if (iconProps.className) props.className = iconProps.className
    if (iconProps.shape) {
      const shapeMap: Record<string, string> = {
        outline: 'lined',
        fill: 'filled',
        square: 'square-bg',
        circle: 'round-bg',
      }
      if (shapeMap[iconProps.shape]) props.type = shapeMap[iconProps.shape]
    }
    for (const [k, v] of Object.entries(iconProps)) {
      if (!['name', 'shape', 'color', 'className'].includes(k) && !k.startsWith('__')) {
        props[k] = v
      }
    }
  }

  return {
    kind: 'component',
    component: 'Icon',
    tag: targetIconName,
    import: { source: iconPkg, named: true },
    props,
    selfClosing: true,
  }
}