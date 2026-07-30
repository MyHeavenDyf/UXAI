/**
 * Icon → 动态 Icon 组件映射（新架构）
 *
 * A2UI Icon → 动态切换到 `@nce/icon-plus` 的对应命名导出。
 *
 * ## Props 对照
 *
 * | A2UI prop | 处理方式 |
 * |-----------|---------|
 * | name（字面量） | resolveIcon 直出（无 binding 场景） |
 * | name（DataBinding，绝对/相对） | **ComputedValue** + Fragment + Node.text，transform 内 cvCtx.resolveIcon |
 * | color（字面量） | 传给 resolveIcon（→ iconColor） |
 * | color（DataBinding，绝对/相对） | ComputedValue 内 cvCtx.resolveValueFromPath 解析（per-item 正确） |
 * | shape（字面量） | 传给 resolveIcon（→ type） |
 * | className | 传给 resolveIcon |
 *
 * ## 特殊逻辑
 *
 * - 无任何 binding（name+color 都是字面量）→ ctx.resolveIcon 直接返回 BuildNode（静态）
 * - 有 binding（name 或 color）→ ComputedValue + Fragment + Node.text：
 *   - Fragment 是必需包装，因为 tag 是 runtime 动态确定
 *   - Fragment 用具名导入：`{ source: 'react', named: true }`
 *   - cvPath 取 name（name 是 binding 时）或 color，transform 内用 cvCtx 解析另一个
 *   - 绝对/相对路径都正确（cvCtx per-item 执行）
 * - 不再使用 ctx.resolveAbsoluteStateValue（相对路径只取首项的设计瑕疵已消除）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 Icon 组件 import 路径（图标本身的包名由
 * iconCollection 模块级 iconPkg 决定，经 registerComponents 注入，非此处的 pkg）。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import { Value } from '../../../src/core/value'
import { Node } from '../../../src/core/node'

/**
 * 从 A2UI props 中抽出 resolveIcon 接受的字面量 prop
 *
 * resolveIcon 只支持字面量参数（color/shape/className 需为 string）。
 * 返回的 iconProps 只含字面量值，DataBinding 已被排除。
 */
function extractLiteralIconProps(props: Record<string, any>): Record<string, any> {
  const { name, color, shape, className, ...rest } = props
  const iconProps: Record<string, any> = { ...rest }
  if (typeof color === 'string') iconProps.color = color
  if (typeof shape === 'string') iconProps.shape = shape
  if (typeof className === 'string') iconProps.className = className
  return iconProps
}

export function createIconMapping(pkg: string): MappingDef {
  return {
    tag: 'Icon',
    import: `${pkg}/Icon`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const name = props.name
      const color = props.color
      const iconProps = extractLiteralIconProps(props)

      const nameIsBinding = !!(name && typeof name === 'object' && name.type === 'binding')
      const colorIsBinding = !!(color && typeof color === 'object' && color.type === 'binding')

      // ─── 无任何 binding → 静态 resolveIcon 直出 ───
      if (!nameIsBinding && !colorIsBinding) {
        const literalName = typeof name === 'string' ? name : ''
        return ctx.resolveIcon(literalName, iconProps) as any
      }

      // ─── 有 binding → ComputedValue + Fragment + Node.text ───
      // cvPath：name 是 binding 时取 name（transform 的 rawValue 即 name 值）；否则取 color
      const cvPath = nameIsBinding ? name : color
      const cv = Value.computed({
        path: cvPath.path,
        pathType: cvPath.pathType ?? 'absolute',
        accessPath: cvPath.accessPath,
        containsJSX: true,
        transform: (rawCvValue: any, cvCtx?: any) => {
          const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
          // name：binding 时 cvPath=name → raw 就是 name；否则字面量
          const rawName = nameIsBinding ? rawCvValue : name
          if (typeof rawName !== 'string') return null
          // color：binding 时，若 cvPath=color → raw 就是 color；否则用 cvCtx 解析
          let finalProps = iconProps
          if (colorIsBinding) {
            const rawColor = (cvPath === color) ? rawCvValue : cvCtx?.resolveValueFromPath(color.path)
            if (typeof rawColor === 'string') finalProps = { ...iconProps, color: rawColor }
          }
          const iconNode = rIcon(rawName, finalProps)
          // 透传原始元素 id：图标被提升为 jsxLiteralConst 时，id 作为 styles 选择器 key
          // （与非 binding 静态图标经 NodeMapper `{...node}` 保留 id 的行为对齐）
          if (iconNode && node.id) iconNode.id = node.id
          return iconNode
        },
      })

      return {
        tag: 'Fragment',
        import: { source: 'react', named: true },
        props: {},
        children: [Node.text({ value: cv })],
      } as any
    },
  }
}
