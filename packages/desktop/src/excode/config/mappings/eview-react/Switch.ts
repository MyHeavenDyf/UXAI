/**
 * Switch → Switch 映射（新架构）
 *
 * A2UI Switch → eview-react Switch 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | value（字面量 boolean） | toggled | 改名透传 + **LiteralValue.useState** |
 * | value（DataBinding） | toggled | **LiteralValue.useState** + onToggle，编译期取值作初始值 |
 * | checkedChildren | taggledChildren | 改名（注意 API 拼写错误） |
 * | unCheckedChildren | unTaggledChildren | 改名（注意 API 拼写错误） |
 * | checkedChildrenIcon（字面量） | taggledChildren | ctx.resolveIcon() → BuildNode（覆盖文本） |
 * | checkedChildrenIcon（DataBinding） | taggledChildren | **ComputedValue** + containsJSX:true |
 * | unCheckedChildrenIcon（字面量） | unTaggledChildren | ctx.resolveIcon() → BuildNode（覆盖文本） |
 * | unCheckedChildrenIcon（DataBinding） | unTaggledChildren | **ComputedValue** + containsJSX:true |
 * | size: medium/small | — | 丢弃（Switch API 不接受 size） |
 * | className | className | 透传 |
 * | — | onToggle | 通过 LiteralValue.useState 的 event 注入 |
 *
 * ## 特殊逻辑
 *
 * - value 无论字面量还是 DataBinding，都产生 useState（Switch 是受控组件）
 * - checkedChildrenIcon 优先于 checkedChildren（覆盖 taggledChildren）
 * - unCheckedChildrenIcon 优先于 unCheckedChildren（覆盖 unTaggledChildren）
 * - icon 双形态分叉：字面量 resolveIcon，DataBinding 走 ComputedValue
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 工具 ───

/**
 * 解析 icon prop（字面量或 DataBinding）→ prop val
 */
function resolveIconProp(
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

// ─── Switch 映射定义 ───

export function createSwitchMapping(pkg: string): MappingDef {
  return {
    tag: 'Switch',
    import: `${pkg}/Switch`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'value', 'size', 'checkedChildren', 'unCheckedChildren',
        'checkedChildrenIcon', 'unCheckedChildrenIcon', 'className',
      ])

      // ─── value → toggled（双形态 + useState） ───
      // Switch 是受控组件，必须产生 useState
      //   字面量 → Value.literal（初始值为 hardcode）
      //   DataBinding → Value.computed + useState（初始值从 state.js 取值）
      if ('value' in props) {
        const val = props.value

        if (val && typeof val === 'object' && val.type === 'binding') {
          // DataBinding → ComputedValue + useState
          // 值进 state.js，useState 初始值引用 initialState.{accessPath}
          outputProps.toggled = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: 'onToggle',
              extractor: (setter) => `(checked) => ${setter}(checked)`,
            },
            transform: (rawValue) => !!rawValue,
          })
        } else {
          // 字面量 → Value.literal + useState
          outputProps.toggled = Value.literal({
            value: val ?? false,
            useState: {
              event: 'onToggle',
              extractor: (setter) => `(checked) => ${setter}(checked)`,
            },
          })
        }
      }

      // ─── checkedChildren → taggledChildren ───
      // 注意：eview-react API 拼写即为 taggledChildren（不是 toggledChildren）
      if (Object.prototype.hasOwnProperty.call(props, 'checkedChildren')) {
        outputProps.taggledChildren = props.checkedChildren
      }

      // ─── unCheckedChildren → unTaggledChildren ───
      if (Object.prototype.hasOwnProperty.call(props, 'unCheckedChildren')) {
        outputProps.unTaggledChildren = props.unCheckedChildren
      }

      // ─── checkedChildrenIcon → taggledChildren（覆盖文本） ───
      if ('checkedChildrenIcon' in props) {
        const iconProp = resolveIconProp(props.checkedChildrenIcon, ctx)
        if (iconProp) {
          outputProps.taggledChildren = iconProp
        }
      }

      // ─── unCheckedChildrenIcon → unTaggledChildren（覆盖文本） ───
      if ('unCheckedChildrenIcon' in props) {
        const iconProp = resolveIconProp(props.unCheckedChildrenIcon, ctx)
        if (iconProp) {
          outputProps.unTaggledChildren = iconProp
        }
      }

      // ─── size 丢弃（Switch API 不接受 size） ───

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // ─── 透传剩余 prop ───
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
}
