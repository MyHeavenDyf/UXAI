/**
 * Dropdown → DropDown 映射（新架构）
 *
 * A2UI Dropdown → eview-react DropDown 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | menu（字面量数组） | data | label→text、key→value、icon→resolveIcon |
 * | menu（DataBinding） | data | **ComputedValue** 编译期每项 icon resolve |
 * | placement | position + popupDirection | antd 值→eview-react 拆分映射 |
 * | trigger（数组） | trigger | 取首项 |
 * | children | children | 透传（eview-react DropDown 支持 children 作为触发元素） |
 * | className | className | 透传 |
 *
 * ## 特殊逻辑
 *
 * - placement 拆分映射表见下方
 * - children 透传，不做处理
 * - menu 中的 icon 需要 resolveIcon 处理
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── placement 映射表 ───
const PLACEMENT_MAP: Record<string, { position: string; popupDirection: string }> = {
  bottom:      { position: 'auto', popupDirection: 'bottom' },
  bottomLeft:  { position: 'left', popupDirection: 'bottom' },
  bottomRight: { position: 'right', popupDirection: 'bottom' },
  top:         { position: 'auto', popupDirection: 'top' },
  topLeft:     { position: 'left', popupDirection: 'top' },
  topRight:    { position: 'right', popupDirection: 'top' },
}

/** 递归转换 menu items（label→text, key→value, icon→resolveIcon） */
function convertMenuItems(
  items: any[],
  rIcon: (name: string) => any,
): any[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => {
    const out: Record<string, any> = {
      text: item.label,
      value: item.key,
    }
    if (item.icon) {
      const iconNode = rIcon(item.icon)
      if (iconNode) out.icon = iconNode
    }
    return out
  })
}

export function createDropdownMapping(pkg: string): MappingDef {
  return {
    tag: 'DropDown',
    import: `${pkg}/DropDown`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}
      const SKIP_KEYS = new Set(['menu', 'placement', 'trigger'])

      // ─── menu → data ───
      if (props.menu) {
        const menuIsBinding = props.menu && typeof props.menu === 'object' && props.menu.type === 'binding'

        if (menuIsBinding) {
          // DataBinding → ComputedValue（编译期转换 + icon resolve）
          outputProps.data = Value.computed({
            path: props.menu.path,
            pathType: props.menu.pathType ?? 'absolute',
            accessPath: props.menu.accessPath ?? 'dropdownData',
            containsJSX: true,
            transform: (rawData: any, cvCtx?: any) => {
              const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
              return convertMenuItems(rawData ?? [], rIcon)
            },
          })
        } else if (Array.isArray(props.menu)) {
          // 字面量 → 直接转换
          outputProps.data = convertMenuItems(props.menu, ctx.resolveIcon) as any
        }
      }

      // ─── placement → position + popupDirection ───
      if (props.placement) {
        const mapped = PLACEMENT_MAP[props.placement]
        if (mapped) {
          outputProps.position = mapped.position as PropValue
          outputProps.popupDirection = mapped.popupDirection as PropValue
        }
      }

      // ─── trigger（数组）→ trigger（单值）───
      if (props.trigger && Array.isArray(props.trigger) && props.trigger.length > 0) {
        outputProps.trigger = props.trigger[0] as PropValue
      }

      // ─── className ───
      if (props.className) outputProps.className = props.className as PropValue

      // 透传剩余
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) outputProps[key] = value as PropValue
      }

      return {
        props: outputProps,
      }
    },
  }
}
