/**
 * mappings/index.ts — 组件库映射统一注册表（新架构）
 *
 * 通过静态 ESM 导入集中注册所有目标组件库的映射模块。
 * 每个库的 index.ts 命名导出 `iconPkg`（配套图标库包名）与 `default`（MappingDef 集合）。
 * 管线通过 ctx.targetLib 选择对应库；registerComponents 取 .default 装载、取 .iconPkg
 * 注入 iconCollection（resolveIcon emit 图标 import 用）。
 */
import * as eviewReact from './eview-react/index'
import * as eviewUi from './eview-ui/index'

export const mappingRegistry: Record<string, { default: any; iconPkg: string }> = {
  'eview-react': eviewReact,
  'eview-ui': eviewUi,
}
