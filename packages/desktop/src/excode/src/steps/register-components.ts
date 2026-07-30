/**
 * 步骤：RegisterComponents — 注册组件映射
 *
 * 从 mappingRegistry 加载目标组件库的 MappingDef，注入 ComponentRegistry。
 * 使用 ESM 静态 import，编译期完成路径解析。
 */

import { Step } from '../core/step'
import type { PipelineContext } from '../pipeline/pipelineContext'
import { mappingRegistry } from '../../config/mappings/index'
import { setIconPackage } from '../core/iconCollection'

export class RegisterComponents extends Step {
  async execute(ctx: PipelineContext): Promise<void> {
    const targetLib = ctx.targetLib || 'eview-react'
    const registry = ctx.registry

    const lib = mappingRegistry[targetLib]
    if (!lib) {
      console.warn(`  [warn] 目标组件库 "${targetLib}" 未在 mappingRegistry 中注册`)
      return
    }

    // 装载组件映射 + 注入配套图标库包名（resolveIcon emit / importCollector 排序用）
    registry.loadMappings(lib.default)
    setIconPackage(lib.iconPkg)

    const count = Object.keys(lib.default).length
    const stats = registry.getStats()
    console.log(`  ℹ  加载了 ${count} 个组件映射 (${targetLib})`)
    console.log(`  ℹ  注册表中 ${stats.registeredCount} 个组件可用`)
  }
}