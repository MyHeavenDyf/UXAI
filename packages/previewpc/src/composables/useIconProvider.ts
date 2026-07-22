import { ref, provide, inject, type Ref } from 'vue'
import { resolveAllIcons } from '../utils/resolveIcons'
import { fetchIconConfig, svgCache } from '../utils/fetchSvg'
import type { IconContext } from '../utils/resolveIcons'

// 重新导出 svgCache 供非组件环境（如 IconBase.ts）直接使用
export { svgCache } from '../utils/fetchSvg'

// ========== 注入键 ==========
export const ICON_PROVIDER_KEY = Symbol('IconProvider')

// ========== 注入类型 ==========
export interface IconProviderContext {
  /** API 是否可用（运行时检测，替代 __HAS_ICONPLUS__） */
  hasHuiIcons: Ref<boolean>
  /** 图标名称映射表 { [a2ui图标名]: IconPlusXxx 组件名 } */
  iconNameMap: Ref<Record<string, string>>
  /** 图标ID映射表 { [a2ui图标名]: icon_id } */
  iconIdMap: Ref<Record<string, string>>
  /** 图标来源上下文 { [a2ui图标名]: IconContext } */
  iconContextMap: Ref<Record<string, IconContext>>
  /** 是否正在解析图标映射中 */
  resolving: Ref<boolean>
  /** SVG 文本缓存（icon_id:style → SVG 文本） */
  svgCache: Map<string, string>
}

// ========== 模块级响应式状态（全局单例） ==========
// 注意：导出供非组件环境（如 IconBase.ts）直接使用
// Vue 组件内应通过 useIconProvider() inject 获取，但拿到的是同一组对象

/** API 可用性：启动时通过 getConfig 检测 */
export const hasHuiIcons = ref(false)

/** 图标名称 → 组件名映射 */
export const iconNameMap = ref<Record<string, string>>({})

/** 图标名称 → icon_id 映射 */
export const iconIdMap = ref<Record<string, string>>({})

/** 图标名称 → 来源上下文映射 */
export const iconContextMap = ref<Record<string, IconContext>>({})

/** 是否正在解析 */
export const resolving = ref(false)

/** 是否已执行 API 检测 */
let configChecked = false
/** 是否正在处理 JSON（防并发） */
let processingJson = false
/** 配置检测完成的Promise，供Provider.ts 等待 **/
let _configResolve: () => void
export const configReady = new Promise<void>((resolve) => { _configResolve = resolve})
/**
 * 在 App.vue 中调用，提供图标系统响应式状态给所有子孙组件。
 * 同时执行 API 可用性检测（串行调用 getConfig）。
 */
export async function provideIconProvider(): Promise<IconProviderContext> {
  const context: IconProviderContext = { hasHuiIcons, iconNameMap, iconIdMap, iconContextMap, resolving, svgCache }
  provide(ICON_PROVIDER_KEY, context)

  if (!configChecked) {
    configChecked = true
    try{
      const apiAvailable = await fetchIconConfig()
      hasHuiIcons.value = apiAvailable
      if (apiAvailable) {
        console.log('[iconProvider] hui-icon-plus API 可用，使用 SVG 接口获取图标')
      } else {
        console.log('[iconProvider] hui-icon-plus API 不可用，使用 lucide 图标')
      }
    } finally {
      _configResolve()
    }
  }

  return context
}

/**
 * 在任何子组件中调用，注入图标系统响应式状态
 */
export function useIconProvider(): IconProviderContext {
  const context = inject<IconProviderContext>(ICON_PROVIDER_KEY)
  if (!context) {
    // 如果没有 provider，回退到模块级状态
    return { hasHuiIcons, iconNameMap, iconIdMap, iconContextMap, resolving, svgCache }
  }
  return context
}

/**
 * 处理从 createSurface / updateSurface 传进来的 JSON 数据，
 * 收集其中的 icon 引用字段并调用 API 映射为 icon_id + 组件名，
 * 串行获取 SVG 文本缓存到 svgCache
 *
 * 可被多次调用，每次新映射会合并到全局 iconNameMap/iconIdMap 中
 */
export async function processJsonForIcons(jsonData: any): Promise<void> {
  if (!hasHuiIcons.value) return
  if (!jsonData?.elements) return

  if (processingJson) return
  processingJson = true

  resolving.value = true
  try {
    const result = await resolveAllIcons([jsonData])
    if (Object.keys(result.componentNameMap).length > 0) {
      iconNameMap.value = { ...iconNameMap.value, ...result.componentNameMap }
    }
    if (Object.keys(result.iconIdMap).length > 0) {
      iconIdMap.value = { ...iconIdMap.value, ...result.iconIdMap }
    }
    if (Object.keys(result.iconContextMap).length > 0) {
      iconContextMap.value = { ...iconContextMap.value, ...result.iconContextMap }
    }
  } catch (err) {
    console.warn('[iconProvider] 处理 JSON 图标失败:', err)
  } finally {
    resolving.value = false
    processingJson = false
  }
}
