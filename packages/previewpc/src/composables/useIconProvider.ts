import { ref, provide, inject, type Ref } from 'vue'
import { resolveAllIcons } from '../utils/resolveIcons'
import { fetchIconConfig, svgCache } from '../utils/fetchSvg'
import type { VariantId, IconVariantData } from '../utils/resolveIcons'
export { type VariantId, type IconVariantData, toVariantId, fromVariantId } from '../utils/resolveIcons'
export { svgCache } from '../utils/fetchSvg'

export const ICON_PROVIDER_KEY = Symbol('IconProvider')

export interface IconProviderContext {
  hasHuiIcons: Ref<boolean>
  variantDataMap: Ref<Record<VariantId, IconVariantData>>
  resolving: Ref<boolean>
  svgCache: Map<string, string>
}

// ========== 全局单例 ==========

export const hasHuiIcons = ref(false)
export const variantDataMap = ref<Record<VariantId, IconVariantData>>({})
export const resolving = ref(false)

let configChecked = false
let processingPromise: Promise<void> | null = null
let _configResolve: () => void
export const configReady = new Promise<void>((resolve) => { _configResolve = resolve })

/** App.vue 中调用，初始化 + 检测 API 可用性 */
export async function provideIconProvider(): Promise<IconProviderContext> {
  const context: IconProviderContext = { hasHuiIcons, variantDataMap, resolving, svgCache }
  provide(ICON_PROVIDER_KEY, context)

  if (!configChecked) {
    configChecked = true
    try {
      hasHuiIcons.value = await fetchIconConfig()
      console.log(hasHuiIcons.value
        ? '[iconProvider] hui-icon-plus API 可用'
        : '[iconProvider] hui-icon-plus API 不可用，使用 lucide')
    } finally {
      _configResolve()
    }
  }
  return context
}

/** 子组件 inject 获取 */
export function useIconProvider(): IconProviderContext {
  const context = inject<IconProviderContext>(ICON_PROVIDER_KEY)
  return context || { hasHuiIcons, variantDataMap, resolving, svgCache }
}

/** 处理 JSON 数据，串行执行 resolveAllIcons，合并到全局 variantDataMap */
export async function processJsonForIcons(jsonData: any): Promise<void> {
  if (!hasHuiIcons.value || !jsonData?.elements) return

  if (processingPromise) await processingPromise

  resolving.value = true
  processingPromise = (async () => {
    try {
      const result = await resolveAllIcons([jsonData])
      if (Object.keys(result.variantDataMap).length > 0) {
        variantDataMap.value = { ...variantDataMap.value, ...result.variantDataMap }
      }
    } catch (err) {
      console.warn('[iconProvider] 处理 JSON 图标失败:', err)
    } finally {
      resolving.value = false
      processingPromise = null
    }
  })()

  await processingPromise
}
