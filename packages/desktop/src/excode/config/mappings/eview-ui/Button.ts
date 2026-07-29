/**
 * eview-ui Button 映射（bespoke）
 *
 * 与 eview-react Button 的差异：
 *   1. eview-react `types: link` → `status: 'text'`；eview-ui 若 `types === 'link'` → 映射为 **TextButton**（不同组件）
 *      组件（支持 `text` + `onClick`，value→text，注入 onClick 占位，className 透传）。
 *   2. eview-ui **不做** eview-react 的"纯图标按钮（有 icon 无 value）→ IconButton"特殊分支；
 *      纯图标按钮走普通 Button（icon→leftIcon/rightIcon，无 text）。
 *   普通 Button（非 link）的 value→text、icon→leftIcon/rightIcon、color→status/style、size、shape、
 *   className、onClick 占位等逻辑与 eview-react 一致。
 *
 * | A2UI prop | eview-ui prop | 处理 |
 * |-----------|--------------|------|
 * | types: link | → TextButton | 切换组件：TextButton（@cloudsop/eview-ui/TextButton） |
 * | value（types=link） | text | 改名透传（TextButton） |
 * | value（普通） | text | 改名透传（Button） |
 * | icon | leftIcon / rightIcon | resolveIcon / ComputedValue（普通 Button；无 IconButton 分支） |
 * | color | status / style.backgroundColor | 值映射（普通 Button） |
 * | size: medium | size: normal | 值映射（普通 Button） |
 * | shape: circle | style.borderRadius: '50%' | 转换（普通 Button） |
 * | className | className | 透传 |
 * | — | onClick | 注入占位 (e) => {} |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 工具（与 eview-react Button 一致） ───

/**
 * 解析 A2UI Button 的 color prop
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

  return { status: color }
}

/**
 * 构造 icon prop 值
 * - 字面量 icon → ctx.resolveIcon() 出 BuildNode
 * - DataBinding icon → ComputedValue + containsJSX:true
 */
function buildIconProp(
  iconProp: any,
  ctx: TransformContext,
): PropValue | null {
  if (!iconProp) return null

  if (typeof iconProp === 'object' && iconProp.type === 'binding') {
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
    return ctx.resolveIcon(iconProp) as any
  }

  return null
}

// ─── eview-ui Button 映射定义 ───

const ButtonMapping: MappingDef = {
  tag: 'Button',
  import: '@cloudsop/eview-ui/Button',

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {}

    // ─── types:link → TextButton（支持 text + onClick） ───
    if (props.types === 'link') {
      const outputProps: Record<string, PropValue> = {}

      // value → text（双形态）
      if ('value' in props) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          outputProps.text = val
        } else if (typeof val === 'string' || typeof val === 'number') {
          outputProps.text = val
        }
      }

      // onClick 占位
      outputProps.onClick = Value.rawExpr({ value: '(e) => {}' })

      // className 透传
      if (props.className) outputProps.className = props.className

      return {
        tag: 'TextButton',
        import: '@cloudsop/eview-ui/TextButton',
        props: outputProps,
        children: null,
        selfClosing: true,
      }
    }

    // ─── 普通 Button（无 IconButton 分支） ───
    const hasIcon = 'icon' in props
    const hasValue = 'value' in props
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set([
      'value', 'icon', 'iconPlacement', 'color', 'size', 'types', 'shape',
    ])

    // 1. icon → leftIcon / rightIcon
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
        outputProps.text = val
      } else if (typeof val === 'string' || typeof val === 'number') {
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
        const existingStyle = outputProps.style ? { ...(outputProps.style as any) } : {}
        outputProps.style = { ...existingStyle, ...resolved.style } as any
      }
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

    // 8. 透传剩余 prop（disabled 等）
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) {
        outputProps[key] = value as PropValue
      }
    }

    return {
      props: outputProps,
      children: null,
    }
  },
}

export default ButtonMapping
