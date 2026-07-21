import { ref, provide, inject, type Ref } from 'vue'
import type { Component } from 'vue'
import { resolveAllIcons } from '../utils/resolveIcons'

// 编译期常量 __HAS_ICONPLUS__，由 Vite define 注入
// 包已安装 → true；未安装 → false

// ========== 注入键 ==========
export const ICON_PROVIDER_KEY = Symbol('IconProvider')

// ========== 注入类型 ==========
export interface IconProviderContext {
  /** 项目是否安装了 @hui/icon-plus-vue 依赖 */
  hasHuiIcons: Ref<boolean>
  /** 图标名称映射表 { [a2ui图标名]: IconPlusXxx 组件名 } */
  iconNameMap: Ref<Record<string, string>>
  /** 是否正在解析图标映射中 */
  resolving: Ref<boolean>
  /** hui 图标组件缓存，避免重复动态 import */
  huiIconCache: Map<string, Component>
}

// ========== 模块级响应式状态（全局单例） ==========
// 注意：导出供非组件环境（如 IconBase.ts）直接使用
// Vue 组件内应通过 useIconProvider() inject 获取，但拿到的是同一组对象
export const hasHuiIcons = ref(__HAS_ICONPLUS__ ?? false)
export const iconNameMap = ref<Record<string, string>>({})
export const resolving = ref(false)

/** 是否已执行过依赖检测 */
let dependencyChecked = false
/** 是否正在处理 JSON（防并发） */
let processingJson = false

/** hui 图标组件缓存，避免重复动态 import */
export const huiIconCache = new Map<string, Component>()

/**
 * 在 App.vue 中调用，提供图标系统响应式状态给所有子孙组件
 * 依赖检测已在 Vite 插件阶段完成
 */
export function provideIconProvider(): IconProviderContext {
  const context: IconProviderContext = { hasHuiIcons, iconNameMap, resolving, huiIconCache }
  provide(ICON_PROVIDER_KEY, context)

  if (!dependencyChecked) {
    dependencyChecked = true
    if (hasHuiIcons.value) {
      console.log('[iconProvider] @hui/icon-plus-vue 已检测到')
    } else {
      console.log('[iconProvider] @hui/icon-plus-vue 未安装，使用 lucide 图标')
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
    return { hasHuiIcons, iconNameMap, resolving, huiIconCache }
  }
  return context
}

/**
 * 处理从 createSurface / updateSurface 传进来的 JSON 数据，
 * 收集其中的 icon 引用字段并调用 API 映射为 hui 图标组件名
 *
 * 可被多次调用，每次新映射会合并到全局 iconNameMap 中
 */
export async function processJsonForIcons(jsonData: any): Promise<void> {
  if (!hasHuiIcons.value) return
  if (!jsonData?.elements) return

  if (processingJson) return
  processingJson = true

  resolving.value = true
  try {
    const newMap = await resolveAllIcons([jsonData])
    if (Object.keys(newMap).length > 0) {
      iconNameMap.value = { ...iconNameMap.value, ...newMap }
    }
  } catch (err) {
    console.warn('[iconProvider] 处理 JSON 图标失败:', err)
  } finally {
    resolving.value = false
    processingJson = false
  }
}
