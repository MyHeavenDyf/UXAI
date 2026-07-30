/**
 * Menu → Accordion 映射（新架构）
 *
 * A2UI Menu → eview-react Accordion 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | items（字面量） | data | `convertMenuItems` 直接转换（icon→resolveIcon） |
 * | items（DataBinding） | data | **ComputedValue** + containsJSX:true，编译期 convertMenuItems |
 * | selectedKeys（字面量数组） | selectedValue | 取首项 → `LiteralValue.useState` + onClick 事件 |
 * | selectedKeys（DataBinding） | selectedValue | **ComputedValue.useState** + onClick（transform 取数组首项，path 直传） |
 * | openKeys（DataBinding + items DataBinding） | dataItem.isExpand | 挪进 items ComputedValue.transform，用 `cvCtx.resolveValueFromPath`（绝对/相对都对） |
 * | openKeys（字面量 / items 字面量场景） | dataItem.isExpand | transform 期构建 Set（字面量直取；绝对 binding 用 `ctx.resolveAbsoluteStateValue`） |
 * | inlineCollapsed | expanded | 1:1 透传 |
 * | mode: vertical/horizontal | — | 丢弃（Accordion 无此概念） |
 * | className | className | 透传 |
 * | — | hideTitleBar | `defaults: true` |
 * | — | enableMultiOpen | `defaults: true` |
 * | — | isControlSelectedValue | `defaults: true` |
 * | — | enableExpand | `defaults: true` |
 *
 * ## 特殊逻辑
 *
 * - items 双形态分叉：字面量直接转换，DataBinding 走 ComputedValue
 * - selectedKeys 双形态分叉：字面量→LiteralValue.useState，DataBinding→ComputedValue.useState
 * - openKeys 作为辅助决策（不进 outputProps），仅用于计算 isExpand：
 *   items 是 DataBinding 时挪进 transform 内用 cvCtx 解析（per-item 正确）；
 *   items 是字面量时 transform 期构建（顶层 Menu 绝对路径场景）
 * - items[i].icon 是纯 string（非 DataBinding），始终用 ctx.resolveIcon 直接转
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'
import type { BuildNode } from '../../../src/core/nodeTypes'

// ─── 工具 ───

/**
 * 递归转换 menuItem → Accordion dataItem
 */
function convertMenuItems(
  items: any[],
  openKeySet: Set<string | number>,
  resolveIcon: (name: string, props?: Record<string, any>) => BuildNode | null,
): any[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => {
    const dataItem: Record<string, any> = {
      title: item.title,
      value: item.key,
    }
    if (item.icon !== undefined) {
      dataItem.icon = typeof item.icon === 'string' ? resolveIcon(item.icon) : item.icon
    }
    if (openKeySet.has(item.key)) {
      dataItem.isExpand = true
    }
    if (Array.isArray(item.children) && item.children.length > 0) {
      dataItem.children = convertMenuItems(item.children, openKeySet, resolveIcon)
    }
    return dataItem
  })
}

// ─── Menu 映射定义 ───

export function createMenuMapping(pkg: string): MappingDef {
  return {
    tag: 'Accordion',
    import: `${pkg}/Accordion`,

    defaults: {
      hideTitleBar: true,
      enableMultiOpen: true,
      enableExpand: true,
    },

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}

      // selectedKeys → selectedValue（单项双绑，双形态）
      //   字面量数组 → Value.literal（取首项 hardcode）
      //   DataBinding → Value.computed + useState（transform 把数组取首项，path 直传无需 resolveValueFromPath）
      let selectedValueProp: PropValue | undefined
      const hasSelectedKeys = Object.prototype.hasOwnProperty.call(props, 'selectedKeys')
      if (hasSelectedKeys) {
        const sk = props.selectedKeys
        const extractor = (setter: string) => `(node) => ${setter}(node.value)`
        if (sk && typeof sk === 'object' && sk.type === 'binding') {
          selectedValueProp = Value.computed({
            path: sk.path,
            pathType: sk.pathType ?? 'absolute',
            accessPath: sk.accessPath,
            containsJSX: false,
            useState: { event: 'onClick', extractor },
            transform: (rawArray: any) => Array.isArray(rawArray) && rawArray.length > 0 ? rawArray[0] : '',
          })
        } else if (Array.isArray(sk)) {
          selectedValueProp = Value.literal({
            value: sk.length > 0 ? sk[0] : '',
            useState: { event: 'onClick', extractor },
          })
        }
      }

      // openKeys：构建 Set 标记展开项
      //   - items 是 DataBinding → 挪进 items ComputedValue.transform 内用 cvCtx 解析（绝对/相对都对）
      //   - items 是字面量 → transform 期构建（openKeys 字面量直取；绝对 binding 用 ctx；相对 binding 是边缘场景）
      const openKeysBinding = props.openKeys?.type === 'binding' ? props.openKeys : null
      const literalOpenKeys: any[] = Array.isArray(props.openKeys) ? props.openKeys : []

      // 构建 output props
      const outputProps: Record<string, PropValue> = {}

      // items → data：字面量直接转换，path 绑定走 ComputedValue
      const itemsIsBinding = props.items && typeof props.items === 'object' && props.items.type === 'binding'

      if (itemsIsBinding) {
        outputProps.data = Value.computed({
          path: props.items.path,
          pathType: props.items.pathType ?? 'absolute',
          accessPath: props.items.accessPath ?? 'menuData',
          containsJSX: true,
          transform: (rawItems, cvCtx?) => {
            const itemsArray = Array.isArray(rawItems) ? rawItems : []
            const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon
            // 在 transform 内构建 openKeySet：cvCtx.resolveValueFromPath 绝对/相对都正确
            let openKeySet = new Set<string | number>(literalOpenKeys)
            if (openKeysBinding && cvCtx) {
              const rawOpenKeys = cvCtx.resolveValueFromPath(openKeysBinding.path) ?? []
              if (Array.isArray(rawOpenKeys)) openKeySet = new Set<string | number>(rawOpenKeys)
            }
            return convertMenuItems(itemsArray, openKeySet, rIcon)
          },
        })
      } else {
        // 字面量 items：直接转换
        //   openKeys 字面量 → 直取；openKeys 绝对 binding → ctx.resolveAbsoluteStateValue（顶层 Menu 场景）
        const rawOpenKeys = openKeysBinding
          ? (ctx.resolveAbsoluteStateValue(openKeysBinding.path) ?? [])
          : literalOpenKeys
        const openKeySet = new Set<string | number>(rawOpenKeys)
        const rawItems = Array.isArray(props.items) ? props.items : []
        outputProps.data = convertMenuItems(rawItems, openKeySet, ctx.resolveIcon) as any
      }

      if (selectedValueProp !== undefined) {
        outputProps.selectedValue = selectedValueProp
      }
      if (props.inlineCollapsed !== undefined) {
        outputProps.expanded = props.inlineCollapsed
      }
      if (props.className) {
        outputProps.className = props.className
      }
      // 透传剩余 prop（skip 掉已处理 / 无对应概念的字段）
      const SKIP_KEYS = new Set(['items', 'selectedKeys', 'openKeys', 'inlineCollapsed', 'mode', 'className', 'id'])
      for (const [key, value] of Object.entries(props)) {
        if (!SKIP_KEYS.has(key)) {
          outputProps[key] = value as PropValue
        }
      }

      return {
        props: outputProps,
        propRoute: hasSelectedKeys ? { selectedValue: 'component-internal' } : undefined,
        children: null,
      }
    },
  }
}
