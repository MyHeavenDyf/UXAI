/**
 * Tree → Tree 映射（eview-ui 本地副本）
 *
 * 与 eview-react Tree 的差异：eview-ui 的节点图标字段名是 `icon`（**不是**
 * eview-react 的 `treeNodePrefix`），且 eview-ui 的 icon 相关属性只接 URL 字符串、
 * 不接 React DOM。故 A2UI 节点 `icon`（Lucide 名）→ eview-ui `icon` = 统一占位 URL
 * （写死，不调 resolveIcon）。其余 title→text、key→id、children 递归同 eview-react。
 *
 * | A2UI prop | eview-ui prop | 处理 |
 * |-----------|---------------|------|
 * | checkable | enableCheckbox | 同名透传 |
 * | defaultExpandedKeys（DataBinding） | expandedKeys | BindingValue 原样透传（只改名） |
 * | defaultExpandedKeys（字面量数组） | expandedKeys | 改名透传 |
 * | defaultSelectedKeys（DataBinding） | selectedKeys | BindingValue 原样透传（只改名） |
 * | defaultSelectedKeys（字面量数组） | selectedKeys | 改名透传 |
 * | options（DataBinding） | data | ComputedValue + containsJSX:false（icon 占位字符串，无 JSX） |
 * | options（字面量） | data | 递归转换 title→text, key→id, icon→占位 URL |
 * | className | className | 同名透传 |
 *
 * ## options 节点数据结构转换
 *
 * ```
 * A2UI { title, key, icon, children }  →  eview-ui { text, id, icon, children }
 * ```
 * - children 递归应用相同转换规则
 * - icon（Lucide string）→ icon = PLACEHOLDER_ICON_URL（写死占位 URL；eview-ui 节点 icon 只接 URL）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 *
 * ⚠️ eview-ui 本地副本：与 eview-react 差异即属性名 treeNodePrefix→icon + 值占位 URL，
 * 不调 resolveIcon、不产 React DOM——eview-ui 的 icon 相关属性只接 URL。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

// ─── 递归选项数据转换 ───

/**
 * 递归转换 A2UI 节点 → eview-ui 节点：
 *   title → text, key → id, icon → 占位 URL（写死）, children 递归。
 * 不调 resolveIcon——eview-ui 节点 icon 只接 URL 字符串。
 */
function normalizeTreeNode(item: any): any {
  if (typeof item !== 'object' || item === null) {
    return item
  }

  const result: any = { ...item }

  // title → text
  if (item.title !== undefined) {
    result.text = item.text ?? item.title
    delete result.title
  }

  // key → id
  if (item.key !== undefined) {
    result.id = item.id ?? item.key
    delete result.key
  }

  // icon → icon = 占位 URL（写死，eview-ui 节点 icon 只接 URL，不产 React DOM）
  // 不管输入是什么（字面量图标名 / 任意值），一律用统一占位 URL；保留 `icon` 字段名
  // （eview-ui 用 icon，非 eview-react 的 treeNodePrefix）。
  if (item.icon != null) {
    result.icon = PLACEHOLDER_ICON_URL
  }

  // children 递归
  if (Array.isArray(item.children)) {
    result.children = item.children.map((child: any) =>
      normalizeTreeNode(child),
    )
  }

  return result
}

// ─── Tree 映射定义 ───

export function createTreeMapping(pkg: string): MappingDef {
  return {
    tag: 'Tree',
    import: `${pkg}/Tree`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Tree 的 props 是封闭集合
      // (checkable/defaultExpandedKeys/defaultSelectedKeys/options/className)，不做兜底透传。

      // ─── checkable → enableCheckbox ───
      if (props.checkable !== undefined) {
        outputProps.enableCheckbox = props.checkable
      }

      // ─── defaultExpandedKeys → expandedKeys（双形态透传，只改名不改值） ───
      if ('defaultExpandedKeys' in props && props.defaultExpandedKeys != null) {
        outputProps.expandedKeys = props.defaultExpandedKeys as PropValue
      }

      // ─── defaultSelectedKeys → selectedKeys（双形态透传，只改名不改值） ───
      if ('defaultSelectedKeys' in props && props.defaultSelectedKeys != null) {
        outputProps.selectedKeys = props.defaultSelectedKeys as PropValue
      }

      // ─── options → data（递归转换 title→text, key→id, icon→占位 URL） ───
      if ('options' in props) {
        const opts = props.options
        if (opts && typeof opts === 'object' && opts.type === 'binding') {
          outputProps.data = Value.computed({
            path: opts.path,
            pathType: opts.pathType ?? 'absolute',
            accessPath: opts.accessPath,
            containsJSX: false, // icon 占位字符串后 data 无 JSX → 走 state.js 纯 JSON
            transform: (rawItems: any) => {
              const itemsArray = Array.isArray(rawItems) ? rawItems : []
              return itemsArray.map((item: any) =>
                normalizeTreeNode(item),
              )
            },
          })
        } else if (Array.isArray(opts)) {
          outputProps.data = opts.map((item: any) =>
            normalizeTreeNode(item),
          )
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // 不做剩余兜底透传：A2UI Tree 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
      }
    },
  }
}
