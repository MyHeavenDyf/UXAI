/**
 * Button → Button / IconButton 映射（新架构）
 *
 * A2UI Button → eview-react Button 或 IconButton 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量） | text | 改名透传 |
 * | value（DataBinding） | text | 保持 BindingValue 原样 |
 * | color: primary/danger/default | status: primary/risk/default | 值映射 |
 * | color: 色板值（blue/purple/...） | style.backgroundColor | 色板分流 |
 * | color: #HEX | style.backgroundColor | HEX 分流 |
 * | size: medium | size: normal | 值映射 |
 * | size: large/small | 透传 | 不变 |
 * | shape: circle | style.borderRadius: '50%' | transform 转换 |
 * | icon（字面量） | leftIcon / rightIcon | ctx.resolveIcon() → BuildNode 直出 |
 * | icon（DataBinding） | leftIcon / rightIcon | **ComputedValue** + containsJSX:true，编译期 resolveIcon |
 * | iconPlacement: end | → rightIcon | 位置分流 |
 * | iconPlacement: start/缺省 | → leftIcon | 位置分流 |
 * | types: link | status: text | 值映射（link 按钮→文本样式，覆盖 color 的 status） |
 * | className | className | 透传 |
 * | — | onClick | 注入占位 (e) => {} |
 *
 * ## 特殊逻辑
 *
 * - 纯图标按钮：有 icon 无 value → 切换为 IconButton
 * - onClick 注入占位 (e) => {} 确保事件不会 undefined
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（含 IconButton 分支），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 工具 ───

/**
 * 解析 A2UI Button 的 color prop
 *
 * - primary / danger / default → status（值映射）
 * - 色板名（blue/purple/cyan...）→ style.backgroundColor
 * - #HEX → style.backgroundColor
 * - 其他 → 原样作为 status 透传
 */
function resolveColor(color: string): { status?: string; style?: Record<string, string> } {
  const PALETTE = new Set([
    'blue', 'purple', 'cyan', 'green', 'magenta',
    'pink', 'red', 'orange', 'yellow', 'volcano',
    'geekblue', 'lime', 'gold',
  ])

  if (color === 'primary') return { status: 'primary' }
  if (color === 'danger') return { status: 'risk' }
  if (color === 'default') return { status: 'default' }
  if (PALETTE.has(color)) return { style: { backgroundColor: color } }
  if (/^#[0-9a-f]{3,6}$/i.test(color)) return { style: { backgroundColor: color } }

  // 其他字面量值透传为 status
  return { status: color }
}

/**
 * 构造 icon prop 值
 *
 * - 字面量 icon → 直接 ctx.resolveIcon() 出 BuildNode（嵌入 prop 值中，jsx-emitter 序列化）
 * - DataBinding icon → ComputedValue + containsJSX:true，编译期求值后分流到 jsxLiteralConsts
 */
function buildIconProp(
  iconProp: any,
  ctx: TransformContext,
): PropValue | null {
  if (!iconProp) return null

  if (typeof iconProp === 'object' && iconProp.type === 'binding') {
    // DataBinding → ComputedValue：遵循 LLM-MAPPING-GUIDE §5
    // 编译期从 state 取值后 resolveIcon → BuildNode，containsJSX 分流到文件单元 jsxLiteralConsts
    return Value.computed({
      path: iconProp.path,
      pathType: iconProp.pathType ?? 'absolute',
      accessPath: iconProp.accessPath,
      containsJSX: true,
      transform: (rawValue, cvCtx) => {
        const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
        return typeof rawValue === 'string' ? rIcon(rawValue) : null
      },
    })
  }

  if (typeof iconProp === 'string') {
    // 字面量 → 直接 resolveIcon，BuildNode 嵌入 prop 值
    return ctx.resolveIcon(iconProp) as any
  }

  return null
}

// ─── Button 映射定义 ───

export function createButtonMapping(pkg: string): MappingDef {
  return {
    tag: 'Button',
    import: `${pkg}/Button`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const hasIcon = 'icon' in props
      const hasValue = 'value' in props

      // ─── 纯图标按钮分支 → IconButton ───
      if (hasIcon && !hasValue) {
        const iconProp = buildIconProp(props.icon, ctx)
        const iconOutput: Record<string, PropValue> = {
          iconName: iconProp ?? (ctx.resolveIcon('') as any),
          onClick: Value.rawExpr({ value: '(e) => {}' }),
        }

        // color → status / style.backgroundColor
        if ('color' in props && typeof props.color === 'string') {
          const resolved = resolveColor(props.color)
          if (resolved.status) iconOutput.status = resolved.status
          if (resolved.style) iconOutput.style = resolved.style as any
        }

        // shape: circle → style.borderRadius: '50%'
        if (props.shape === 'circle') {
          const existingStyle = iconOutput.style ? { ...(iconOutput.style as any) } : {}
          iconOutput.style = { ...existingStyle, borderRadius: '50%' } as any
        }

        // className 透传
        if (props.className) iconOutput.className = props.className

        // 透传剩余（disabled 等）
        const ICON_SKIP = new Set(['icon', 'value', 'color', 'shape', 'className', 'iconPlacement', 'size', 'types'])
        for (const [key, value] of Object.entries(props)) {
          if (!ICON_SKIP.has(key)) iconOutput[key] = value as PropValue
        }

        return {
          tag: 'IconButton',
          import: `${pkg}/IconButton`,
          props: iconOutput,
          children: null,
          selfClosing: true,
        }
      }

      // ─── 普通 Button ───
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'value', 'icon', 'iconPlacement', 'color', 'size', 'types', 'shape',
      ])

      // 1. icon → leftIcon / rightIcon
      //    字面量 → BuildNode 直出；DataBinding → ComputedValue + containsJSX
      if (hasIcon) {
        const iconProp = buildIconProp(props.icon, ctx)
        if (iconProp) {
          if (props.iconPlacement === 'end') {
            outputProps.rightIcon = iconProp
          } else {
            outputProps.leftIcon = iconProp
          }
        }
      }

      // 2. value → text（双形态）
      if (hasValue) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding：保持 BindingValue 原样（管线收集路径绑定到 state.js）
          outputProps.text = val
        } else if (typeof val === 'string' || typeof val === 'number') {
          // 字面量：直接赋值
          outputProps.text = val
        }
      }

      // 3. color → status / style.backgroundColor
      if ('color' in props && typeof props.color === 'string') {
        const resolved = resolveColor(props.color)
        if (resolved.status) {
          outputProps.status = resolved.status
        }
        if (resolved.style) {
          // 如果已有 style（如 shape:circle 设的 borderRadius），合并
          const existingStyle = outputProps.style ? { ...(outputProps.style as any) } : {}
          outputProps.style = { ...existingStyle, ...resolved.style } as any
        }
      }

      // 3.5 types: link → status: text（link 按钮是文本样式，覆盖 color 的 status）
      if (props.types === 'link') {
        outputProps.status = 'text'
      }

      // 4. size: medium → normal
      if (props.size === 'medium') {
        outputProps.size = 'normal'
      } else if (props.size) {
        outputProps.size = props.size // large / small 透传
      }

      // 5. shape: circle → style.borderRadius: '50%'
      if (props.shape === 'circle') {
        const existingStyle = outputProps.style ? { ...(outputProps.style as any) } : {}
        outputProps.style = { ...existingStyle, borderRadius: '50%' } as any
      }

      // 6. className 透传
      if (props.className) {
        outputProps.className = props.className
      }

      // 7. onClick 占位
      outputProps.onClick = Value.rawExpr({ value: '(e) => {}' })

      // 8. 透传剩余 prop（disabled 等管线自行处理的字段）
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) {
          outputProps[key] = value as PropValue
        }
      }

      return {
        props: outputProps,
        children: null, // Button 不使用 children
      }
    },
  }
}
