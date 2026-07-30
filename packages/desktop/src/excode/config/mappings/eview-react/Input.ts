/**
 * Input → TextField 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value | value | LiteralValue.useState（受控） |
 * | placeholder | placeholder | 同名透传 |
 * | size | — | 丢弃 |
 * | maxLength | maxLength | 同名透传 |
 * | prefix/suffix | prefix/suffix | resolveIconProp → BuildNode |
 * | password: true | type: 'password' | boolean → string |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── icon prop 解析（字面量 / DataBinding） ───
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

// ─── Input → TextField 映射定义 ───

export function createInputMapping(pkg: string): MappingDef {
  return {
    tag: 'TextField',
    import: `${pkg}/TextField`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set([
        'value', 'placeholder', 'size', 'maxLength',
        'prefix', 'suffix', 'password',
      ])

      // ─── value → value（useState 受控，双形态） ───
      //   字面量 → Value.literal（初始值 hardcode）
      //   DataBinding → Value.computed + useState（初始值从 state.js 取，path 直传，无需 resolveValueFromPath）
      if ('value' in props) {
        const val = props.value
        if (val && typeof val === 'object' && val.type === 'binding') {
          outputProps.value = Value.computed({
            path: val.path,
            pathType: val.pathType ?? 'absolute',
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (rawValue) => rawValue ?? '',
          })
        } else {
          outputProps.value = Value.literal({
            value: val ?? '',
            useState: {
              event: 'onChange',
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          })
        }
      }

      // ─── placeholder（双形态：字面量直传，DataBinding 保持 BindingValue 原样） ───
      if ('placeholder' in props) {
        const ph = props.placeholder
        if (ph && typeof ph === 'object' && ph.type === 'binding') {
          // 只改名不改值：保持 BindingValue，管线自动 emit 为 state 引用
          outputProps.placeholder = ph
        } else if (typeof ph === 'string') {
          outputProps.placeholder = ph
        }
      }

      // ─── size 丢弃 ───

      // ─── maxLength 透传 ───
      if (props.maxLength !== undefined) {
        outputProps.maxLength = props.maxLength
      }

      // ─── prefix/suffix icon ───
      if (props.prefix) {
        outputProps.prefix = resolveIconProp(props.prefix, ctx)
      }
      if (props.suffix) {
        outputProps.suffix = resolveIconProp(props.suffix, ctx)
      }

      // ─── password → type ───
      if (props.password === true) {
        outputProps.type = 'password'
      }

      // ─── className ───
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
