/**
 * Menu → Accordion / Tab 映射（新架构）
 *
 * A2UI Menu 按 `mode` 分两个分支：
 *   - mode=horizontal → eview-react **Tab** 组件，items → TabItem children（inline LoopNode / 静态节点）
 *   - 其他（vertical/缺省） → eview-react **Accordion** 组件，items → data prop
 *
 * 无静态 defaults——两分支各自在 transform 内加（Accordion: hideTitleBar/enableMultiOpen/enableExpand(=false)/hideIcons；Tab: lazyLoad）。
 *
 * ## Props 对照（Accordion 分支）
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | items（字面量） | data | `convertMenuItems` 直接转换（icon→占位 URL） |
 * | items（DataBinding） | data | **ComputedValue** + containsJSX:false，编译期 convertMenuItems（icon→占位 URL） |
 * | selectedKeys（字面量数组） | selectedValue | 取首项 → `LiteralValue.useState` + onClick 事件 |
 * | selectedKeys（DataBinding） | selectedValue | **ComputedValue.useState** + onClick（transform 取数组首项，path 直传） |
 * | openKeys（DataBinding + items DataBinding） | dataItem.isExpand | 挪进 items ComputedValue.transform，用 `cvCtx.resolveValueFromPath`（绝对/相对都对） |
 * | openKeys（字面量 / items 字面量场景） | dataItem.isExpand | transform 期构建 Set（字面量直取；绝对 binding 用 `ctx.resolveAbsoluteStateValue`） |
 * | inlineCollapsed | expanded | 1:1 透传 |
 * | mode: vertical | — | 走 Accordion 分支 |
 * | className | className | 透传 |
 * | — | hideTitleBar/enableMultiOpen(=true)/enableExpand(=false)/hideIcons | transform 内加 |
 *
 * ## Props 对照（Tab 分支，mode=horizontal）
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | items（字面量） | children（TabItem[]） | item.title→label、item.icon→icon，TabItem 映射处理（_resolved:false） |
 * | items（DataBinding） | children（inline LoopNode） | TabItem 模板相对绑定 title/icon，TabItem 映射处理；inline 不抽离 |
 * | selectedKeys（字面量数组） | selectedIndex | key→index 匹配 → `LiteralValue.useState` + onClick |
 * | selectedKeys（DataBinding） | selectedIndex | **ComputedValue.useState** + onClick（transform 内 cvCtx 解析 items 算 index） |
 * | openKeys | — | 丢弃（Tab 无展开概念） |
 * | inlineCollapsed | — | 丢弃（Tab 无 expanded） |
 * | className | className | 透传 |
 * | — | lazyLoad | transform 内加 |
 *
 * ## 特殊逻辑
 *
 * - mode=horizontal → Tab + TabItem children（items 转为 TabItem，交给 TabItem 映射处理 label→title、icon→resolveIcon）
 * - items DataBinding 时 Tab 分支用 inline LoopNode（TabItem 在 INLINE_LOOP_COMPONENTS 白名单，不抽离）
 * - selectedKeys → selectedIndex（Tab）用 `(index) => setter(index)` extractor（不同于 Accordion 的 `(node) => setter(node.value)`）
 * - openKeys 作为辅助决策（不进 outputProps），仅用于 Accordion 分支计算 isExpand
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 *
 * ⚠️ eview-ui 本地副本：icon 一律用统一占位 URL（写死），不调 resolveIcon、不产
 * React DOM——eview-ui 的 icon 相关属性只接 URL。Accordion data 里的 icon 由
 * BuildNode 变字符串 → data 无 JSX → items DataBinding 的 containsJSX 翻 false
 * （data 走 state.js 纯 JSON）。Tab 分支 icon 委托 TabItem 映射（已占位），不改。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { Node } from '../../../src/core/node-factory'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

/**
 * 从 items 数组中按 key 查找索引（horizontal → Tab 的 selectedKeys → selectedIndex 用）
 */
function findIndexInRawItems(rawItems: any[], keyVal: string): number {
  if (!Array.isArray(rawItems)) return -1
  for (let i = 0; i < rawItems.length; i++) {
    if (rawItems[i]?.key === keyVal) return i
  }
  return -1
}

// ─── 工具 ───

/**
 * 递归转换 menuItem → Accordion dataItem
 *
 * eview-ui：icon 一律用统一占位 URL（写死），不再 resolveIcon。
 * 仅当 item.icon !== undefined 时设置（无 icon 字段的项不加 icon）。
 */
function convertMenuItems(
  items: any[],
  openKeySet: Set<string | number>,
): any[] {
  if (!Array.isArray(items)) return []
  return items.map((item: any) => {
    const dataItem: Record<string, any> = {
      title: item.title,
      value: item.key,
    }
    if (item.icon !== undefined) {
      dataItem.icon = PLACEHOLDER_ICON_URL
    }
    if (openKeySet.has(item.key)) {
      dataItem.isExpand = true
    }
    if (Array.isArray(item.children) && item.children.length > 0) {
      dataItem.children = convertMenuItems(item.children, openKeySet)
    }
    return dataItem
  })
}

// ─── Menu 映射定义 ───

export function createMenuMapping(pkg: string): MappingDef {
  return {
    tag: 'Accordion',
    import: `${pkg}/Accordion`,

    // 无静态 defaults——两分支各自在 transform 内加（Accordion: hideTitleBar/enableMultiOpen/enableExpand(=false)/hideIcons；Tab: lazyLoad）

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}

      // ─── mode: horizontal → Tab + TabItem children ───
      // items → TabItem（字面量：直接构造节点；DataBinding：inline LoopNode）
      // selectedKeys → selectedIndex（Tab 用 index，不是 key）
      if (props.mode === 'horizontal') {
        const tabOutputProps: Record<string, PropValue> = {}

        // selectedKeys → selectedIndex
        const hasSK = Object.prototype.hasOwnProperty.call(props, 'selectedKeys')
        if (hasSK) {
          const sk = props.selectedKeys
          const extractor = (setter: string) => `(index) => ${setter}(index)`
          const itemsBinding = props.items?.type === 'binding' ? props.items : null
          const literalItems: any[] = Array.isArray(props.items) ? props.items : []

          if (sk && typeof sk === 'object' && sk.type === 'binding') {
            tabOutputProps.selectedIndex = Value.computed({
              path: sk.path,
              pathType: sk.pathType ?? 'absolute',
              accessPath: sk.accessPath,
              containsJSX: false,
              useState: { event: 'onClick', extractor },
              transform: (rawSK: any, cvCtx?: any) => {
                const keyVal = Array.isArray(rawSK) && rawSK.length > 0 ? String(rawSK[0]) : ''
                if (!keyVal) return 0
                const rawItems = itemsBinding && cvCtx
                  ? (cvCtx.resolveValueFromPath(itemsBinding.path) ?? [])
                  : literalItems
                const idx = findIndexInRawItems(rawItems, keyVal)
                return idx !== -1 ? idx : 0
              },
            })
          } else if (Array.isArray(sk)) {
            const keyVal = sk.length > 0 ? String(sk[0]) : ''
            let idx = 0
            if (keyVal) {
              const found = findIndexInRawItems(literalItems, keyVal)
              if (found !== -1) idx = found
            }
            tabOutputProps.selectedIndex = Value.literal({
              value: idx,
              useState: { event: 'onClick', extractor },
            })
          }
        }

        // items → TabItem children
        let tabChildren: any = null
        const items = props.items
        if (items && typeof items === 'object' && items.type === 'binding') {
          // DataBinding → inline LoopNode（TabItem 模板，交给 TabItem 映射处理 label→title、icon→resolveIcon）
          const dataBinding = {
            type: 'binding' as const,
            path: items.path,
            pathType: items.pathType ?? 'absolute',
            accessPath: items.accessPath ?? 'menuData',
          }
          // 据样本数据判断 items 是否有 icon 字段（与字面量分支 item.icon !== undefined 对齐）。
          // 无 icon 时不加 icon binding，否则解析成 null、emit 出游离的 icon={null}。
          const sampleItems: any[] = Array.isArray(items.stateValue) ? items.stateValue : []
          const hasIcon = sampleItems.some((it: any) => it && typeof it === 'object' && 'icon' in it)
          const templateProps: Record<string, any> = {
            label: Value.binding({ path: 'title', pathType: 'relative', accessPath: 'title' }),
          }
          if (hasIcon) {
            templateProps.icon = Value.binding({ path: 'icon', pathType: 'relative', accessPath: 'icon' })
          }
          const templateItem = Node.component({
            component: 'TabItem',
            tag: 'TabItem',
            // _resolved:false → NodeMapper 走 TabItem 映射：label→title 透传、icon→resolveIcon
            props: templateProps,
          }) as any
          templateItem._resolved = false
          const extract = Node.extract({
            componentName: `${node.id || 'Menu'}TabItemTemplate`,
            purpose: 'component',
            body: [templateItem],
            _resolved: false,
          })
          const loopNode = Node.loop({ data: dataBinding as any, template: extract })
          loopNode.inline = true
          tabChildren = loopNode
        } else if (Array.isArray(items)) {
          // 字面量 → TabItem 节点（_resolved:false，交给 TabItem 映射处理 icon resolve）
          tabChildren = items.map((item: any) => {
            const itemProps: Record<string, any> = { label: item.title }
            if (item.icon !== undefined) itemProps.icon = item.icon
            const n = Node.component({
              component: 'TabItem',
              tag: 'TabItem',
              props: itemProps,
            }) as any
            n._resolved = false
            return n
          })
        }

        // Tab defaults + className
        if (!('lazyLoad' in tabOutputProps)) tabOutputProps.lazyLoad = true
        if (props.className) tabOutputProps.className = props.className

        return {
          tag: 'Tab',
          import: `${pkg}/Tab`,
          props: tabOutputProps,
          children: tabChildren,
          propRoute: hasSK ? { selectedIndex: 'component-internal' } as Record<string, any> : undefined,
        }
      }

      // ─── 非 horizontal → Accordion（现有逻辑） ───

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

      // Accordion defaults（从静态 defaults 移到此处，仅 Accordion 分支生效）
      if (!('hideTitleBar' in outputProps)) outputProps.hideTitleBar = true
      if (!('enableMultiOpen' in outputProps)) outputProps.enableMultiOpen = true
      if (!('enableExpand' in outputProps)) outputProps.enableExpand = false
      if (!('hideIcons' in outputProps)) outputProps.hideIcons = true

      // items → data：字面量直接转换，path 绑定走 ComputedValue
      const itemsIsBinding = props.items && typeof props.items === 'object' && props.items.type === 'binding'

      if (itemsIsBinding) {
        // eview-ui：icon 占位字符串后 data 无 JSX → containsJSX:false（data 走 state.js 纯 JSON）
        outputProps.data = Value.computed({
          path: props.items.path,
          pathType: props.items.pathType ?? 'absolute',
          accessPath: props.items.accessPath ?? 'menuData',
          containsJSX: false,
          transform: (rawItems, cvCtx?) => {
            const itemsArray = Array.isArray(rawItems) ? rawItems : []
            // 在 transform 内构建 openKeySet：cvCtx.resolveValueFromPath 绝对/相对都正确
            let openKeySet = new Set<string | number>(literalOpenKeys)
            if (openKeysBinding && cvCtx) {
              const rawOpenKeys = cvCtx.resolveValueFromPath(openKeysBinding.path) ?? []
              if (Array.isArray(rawOpenKeys)) openKeySet = new Set<string | number>(rawOpenKeys)
            }
            return convertMenuItems(itemsArray, openKeySet)
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
        outputProps.data = convertMenuItems(rawItems, openKeySet) as any
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
      // 不做剩余兜底透传：A2UI Menu 的 props (items/selectedKeys/openKeys/inlineCollapsed/mode/className)
      // 已逐项显性处理（id 由管线别处处理，不进 outputProps）。

      return {
        props: outputProps,
        propRoute: hasSelectedKeys ? { selectedValue: 'component-internal' } : undefined,
        children: null,
      }
    },
  }
}
