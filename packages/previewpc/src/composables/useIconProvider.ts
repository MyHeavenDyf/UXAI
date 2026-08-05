import { ref, provide, inject, type Ref } from 'vue'
import { resolveAllIcons, selectBestIcon } from '../utils/resolveIcons'
import { fetchIconConfig, svgCache, svgCacheVersion, resolveSvgCacheKey } from '../utils/fetchSvg'
import { IconRequestQueue } from '../utils/iconRequestQueue'
import type { IconInfoEntry } from '../utils/resolveIcons'
export { type IconInfoEntry } from '../utils/resolveIcons'
export { svgCache, svgCacheVersion, resolveSvgCacheKey, resolveApiShape } from '../utils/fetchSvg'

export const ICON_PROVIDER_KEY = Symbol('IconProvider')

export interface IconProviderContext {
  hasHuiIcons: Ref<boolean>
  iconInfoMap: Ref<Record<string, IconInfoEntry>>
  svgCache: Map<string, string>
  svgCacheVersion: Ref<number>
  requestSvg: (name: string, shape: string, color: string, isDark?: boolean) => void
}

// ========== 全局单例 ==========

export const hasHuiIcons = ref(false)
export const iconInfoMap = ref<Record<string, IconInfoEntry>>({})

/** 请求队列单例 */
const iconRequestQueue = new IconRequestQueue(50)

let configChecked = false
let processingPromise: Promise<void> | null = null
let _configResolve: () => void
export const configReady = new Promise<void>((resolve) => { _configResolve = resolve })

/** App.vue 中调用，初始化 + 检测 API 可用性 */
export async function provideIconProvider(): Promise<IconProviderContext> {
  const requestSvgFn = requestSvg
  const context: IconProviderContext = { hasHuiIcons, iconInfoMap, svgCache, svgCacheVersion, requestSvg: requestSvgFn }
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
  return context || { hasHuiIcons, iconInfoMap, svgCache, svgCacheVersion, requestSvg }
}

/** 渲染时按需请求 SVG：查缓存→无则入队 */
export function requestSvg(name: string, shape: string, color: string, isDark?: boolean): void {
  const entry = iconInfoMap.value[name]
  if (!entry?.url) return

  const cacheKey = resolveSvgCacheKey(name, shape, color, isDark)
  if (svgCache.has(cacheKey)) return  // 已缓存，无需请求

  iconRequestQueue.enqueue(name, shape, color, entry.url, isDark)
}

// ========== 兜底：单图标名 iconInfo 请求 ==========
const API_BASE = import.meta.env.VITE_ICON_API_BASE || ''
const ICON_API_URL = `${API_BASE}/assetRepository/iconPlus/getIconInfo`
/** 已尝试请求 iconInfo 的 name：正在请求中 或 已请求但未找到 */
const triedIconInfoNames = new Set<string>()

/** 遇到 iconInfoMap 中未映射的图标名时，主动请求 getIconInfo API 获取 URL */
export function requestIconInfo(name: string): void {
  if (!name || !hasHuiIcons.value) return
  if (iconInfoMap.value[name]) return         // 已有映射，无需请求
  if (triedIconInfoNames.has(name)) return     // 正在请求中 或 已请求未找到，跳过
  triedIconInfoNames.add(name)

  const keyword = encodeURIComponent(name)
  const apiUrl = `${ICON_API_URL}?keyword=${keyword}&topK=2&source_id=6`

  fetch(apiUrl)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.json()
    })
    .then(data => {
      if (!Array.isArray(data)) return   // 非数组 → name 保留在 triedIconInfoNames，不再重复
      for (const item of data) {
        const icons = (item.icons || []).map((icon: any) => ({
          name: icon.name || '',
          group: icon.group || [],
          url: icon.url || '',
        }))
        // 匹配策略：系统图标组 → name 匹配 → 首个
        let selected = selectBestIcon(icons, name)

        if (selected?.url) {
          iconInfoMap.value = { ...iconInfoMap.value, [name]: { name: selected.name, url: selected.url } }
          svgCacheVersion.value++           // 通知所有监听者重新解析
          triedIconInfoNames.delete(name)   // 找到了 → 清除标记，由 iconInfoMap 接管
        }
        // 未找到 → name 保留在 triedIconInfoNames，不再重复请求
      }
    })
    .catch(err => {
      console.warn(`[iconProvider] requestIconInfo 失败: ${err.message}`)
      triedIconInfoNames.delete(name)       // 网络错误 → 清除，允许下次重试
    })
}

/** 处理 JSON 数据，串行执行 resolveAllIcons，合并到全局 iconInfoMap */
export async function processJsonForIcons(jsonData: any): Promise<void> {
  if (!hasHuiIcons.value || !jsonData?.elements) return

  if (processingPromise) await processingPromise

  processingPromise = (async () => {
    try {
      const result = await resolveAllIcons([jsonData])
      if (Object.keys(result.iconInfoMap).length > 0) {
        iconInfoMap.value = { ...iconInfoMap.value, ...result.iconInfoMap }
        svgCacheVersion.value++   // 通知所有监听者：图标映射已更新
      }
    } catch (err) {
      console.warn('[iconProvider] 处理 JSON 图标失败:', err)
    } finally {
      processingPromise = null
    }
  })()

  await processingPromise
}
