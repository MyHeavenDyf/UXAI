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
 * | color: default/primary/danger（枚举） | status: default/primary/risk | 值映射（schema 已收敛为枚举，无色板/HEX） |
 * | size: medium | size: normal | 值映射 |
 * | size: large/small | 透传 | 不变 |
 * | shape: circle | style.borderRadius: '50%' | transform 转换 |
 * | icon（字面量） | leftIcon / rightIcon | ctx.resolveIcon() → BuildNode 直出 |
 * | icon（DataBinding） | leftIcon / rightIcon | **ComputedValue** + containsJSX:true，编译期 resolveIcon |
 * | iconPlacement: end | → rightIcon | 位置分流 |
 * | iconPlacement: start/缺省 | → leftIcon | 位置分流 |
 * | types: link | status: text | 值映射（link 按钮→文本样式，覆盖 color 的 status） |
 * | disabled（boolean） | disabled | 同名透传（schema 为字面量 boolean，无 DataBinding） |
 * | className | className | 透传 |
 * | onClick（Action） | onClick | 透传 ActionValue → emitValue 产 setSharedState(key,value)；无 Action 则占位 (e) => {} |
 *
 * ## 特殊逻辑
 *
 * - 纯图标按钮：有 icon 无 value → 切换为 IconButton
 * - icon color 特化（传给 resolveIcon，普通 Button 与 IconButton 分支一致）：
 *   - link 按钮（types=link）→ icon color=brand（含纯图标 link → IconButton 分支）
 *   - primary/danger 按钮（实色背景，仅普通 Button）→ icon color=#fff（白图标）
 * - onClick：有 Action（build-trees 已转 ActionValue）透传 → setSharedState(key,value)；无则占位 (e) => {} 确保事件不 undefined
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（含 IconButton 分支），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'

// ─── 工具 ───

/**
 * 解析 A2UI Button 的 color prop
 *
 * schema 已收敛为枚举 default/primary/danger（无 DataBinding、无色板/HEX）：
 * - default → status: default
 * - primary → status: primary
 * - danger → status: risk
 */
function resolveColor(color: string): { status: string } {
  if (color === 'primary') return { status: 'primary' }
  if (color === 'danger') return { status: 'risk' }
  return { status: 'default' }
}

/**
 * 构造 icon prop 值
 *
 * - 字面量 icon → 直接 ctx.resolveIcon() 出 BuildNode（嵌入 prop 值中，jsx-emitter 序列化）
 * - DataBinding icon → ComputedValue + containsJSX:true，编译期求值后分流到 jsxLiteralConsts
 *
 * @param iconProps 透传给 resolveIcon 的 icon 组件 props（color / className / shape / iconSize 等，
 *                  A2UI Icon 组件支持的属性，见 md/a2ui/.../Icon.json）
 */
function buildIconProp(
  iconProp: any,
  ctx: TransformContext,
  iconProps?: Record<string, any>,
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
        return typeof rawValue === 'string' ? rIcon(rawValue, iconProps) : null
      },
    })
  }

  if (typeof iconProp === 'string') {
    // 字面量 → 直接 resolveIcon，BuildNode 嵌入 prop 值
    return ctx.resolveIcon(iconProp, iconProps) as any
  }

  return null
}

/** A2UI Button size 枚举 → IconPlus iconSize 数字 */
const BUTTON_SIZE_TO_ICON_SIZE: Record<string, number> = { large: 20, medium: 18, small: 14 }
function sizeToIconSize(size: string): number | undefined {
  return BUTTON_SIZE_TO_ICON_SIZE[size]
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
        // A2UI Icon 组件支持的属性（md/a2ui/.../Icon.json）：color / className。
        // 这些透传给 resolveIcon（产出 IconPlus），不再转 IconButton 的 status/style。
        // Button.size → iconSize（数字），一并传给 resolveIcon。
        // ⚠️ Button.shape（default/circle/round，按钮圆角）≠ Icon.shape（outline/fill/square/circle），
        //    不能传给 resolveIcon——Button.shape 走下面的 style.borderRadius。
        const iconProps: Record<string, any> = {}
        // link 按钮（types=link）→ icon 用品牌色 brand（与普通 Button 分支一致：
        //   link 是文本样式，icon 应品牌色，覆盖 props.color）。非 link 时用 props.color。
        if (props.types === 'link') {
          iconProps.color = 'brand'
        } else if ('color' in props && typeof props.color === 'string') {
          iconProps.color = props.color
        }
        if (props.className) iconProps.className = props.className
        const iconSize = typeof props.size === 'string' ? sizeToIconSize(props.size) : undefined
        if (iconSize !== undefined) iconProps.iconSize = iconSize
        // 传 Button 的 id 给 icon：CSS Modules 选择器键 + emit className → styles.{id}
        // （IconButton 自身无 className，id 选择器让给 icon 用）
        if (node.id) iconProps.id = node.id

        const iconProp = buildIconProp(props.icon, ctx, iconProps)
        const iconOutput: Record<string, PropValue> = {
          iconName: iconProp ?? (ctx.resolveIcon('', iconProps) as any),
          // onClick：有 Action（build-trees 已转 ActionValue）则透传 → emitValue 产 setSharedState；
          //           无则占位 (e) => {} 确保事件不 undefined
          onClick: ('onClick' in props ? props.onClick : null) ?? Value.rawExpr({ value: '(e) => {}' }),
        }
        // disabled 透传（schema 为 boolean 字面量；IconButton 亦是 Button 变体，disabled 透传）
        if (props.disabled !== undefined) {
          iconOutput.disabled = props.disabled
        }

        // A2UI Button 的 props 是封闭集合 (value/color/types/size/icon/iconPlacement/shape/disabled/className)，
        // IconButton 分支下：color/className/size/icon/id 进 iconProps；disabled 透传为 IconButton prop；
        // 其余在此分支不适用（value/iconPlacement/types/shape：shape 是 Button 圆角 ≠ Icon.shape，IconButton 自管；其余见 JSDoc）。
        // 不做剩余兜底透传。

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

      // 显性处理每个 A2UI prop：A2UI Button 的 props 是封闭集合
      // (value/color/types/size/icon/iconPlacement/shape/disabled/className)，不做兜底透传。

      // 1. icon → leftIcon / rightIcon
      //    字面量 → BuildNode 直出；DataBinding → ComputedValue + containsJSX
      //    icon color 特化（普通 Button，icon+value 同时存在）：
      //      link 按钮（types=link）→ icon color=brand
      //      primary/danger 按钮（实色背景）→ icon color=#fff（白图标）
      if (hasIcon) {
        const iconProps: Record<string, any> = {}
        if (props.types === 'link') {
          iconProps.color = 'brand'
        } else if (props.color === 'primary' || props.color === 'danger') {
          iconProps.color = '#fff'
        }
        const iconProp = buildIconProp(props.icon, ctx, iconProps)
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

      // 3. color → status（schema 枚举 default/primary/danger，无色板/HEX 分流）
      if ('color' in props && typeof props.color === 'string') {
        outputProps.status = resolveColor(props.color).status
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

      // 6. disabled 透传（schema 为 boolean 字面量，无 DataBinding）
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled
      }

      // 7. className 透传
      if (props.className) {
        outputProps.className = props.className
      }

      // 8. onClick：有 Action（build-trees 已转 ActionValue）则透传 → emitValue 产 setSharedState(key,value)；
      //    无则占位 (e) => {} 确保事件不 undefined
      outputProps.onClick = ('onClick' in props ? props.onClick : null) ?? Value.rawExpr({ value: '(e) => {}' })

      // 不做剩余兜底透传：A2UI Button 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null, // Button 不使用 children
      }
    },
  }
}
