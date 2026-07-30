/**
 * Tree → Tree 映射
 *
 * A2UI Tree 对应 eview-react 的 Tree 组件。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | checkable | enableCheckbox | 同名透传 |
 * | defaultExpandedKeys（DataBinding） | expandedKeys | BindingValue 原样透传（只改名） |
 * | defaultExpandedKeys（字面量数组） | expandedKeys | 改名透传 |
 * | defaultSelectedKeys（DataBinding） | selectedKeys | BindingValue 原样透传（只改名） |
 * | defaultSelectedKeys（字面量数组） | selectedKeys | 改名透传 |
 * | options（DataBinding） | data | ComputedValue + containsJSX:true（icon 解析） |
 * | options（字面量） | data | 递归转换 title→text, key→id, icon resolve |
 * | className | className | 同名透传 |
 *
 * ## options 节点数据结构转换
 *
 * ```
 * A2UI { title, key, icon, children }  →  eview { text, id, icon, children }
 * ```
 * - children 递归应用相同转换规则
 * - icon（Lucide string）→ resolveIcon 转为 BuildNode（不包 slotNode）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

// ─── 递归选项数据转换 ───

function normalizeTreeNode(
  item: any,
  resolveIcon: TransformContext['resolveIcon'],
): any {
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

  // icon（Lucide string → resolveIcon 转为 BuildNode，与 Menu 一致）
  if (item.icon && typeof item.icon === 'string') {
    result.icon = resolveIcon(item.icon)
  }

  // children 递归
  if (Array.isArray(item.children)) {
    result.children = item.children.map((child: any) =>
      normalizeTreeNode(child, resolveIcon),
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
      const SKIP_KEYS = new Set([
        'checkable',
        'defaultExpandedKeys',
        'defaultSelectedKeys',
        'options',
        'className',
      ])

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

      // ─── options → data（递归转换 title→text, key→id, icon resolve） ───
      if ('options' in props) {
        const opts = props.options
        if (opts && typeof opts === 'object' && opts.type === 'binding') {
          outputProps.data = Value.computed({
            path: opts.path,
            pathType: opts.pathType ?? 'absolute',
            accessPath: opts.accessPath,
            containsJSX: true,
            transform: (rawItems, cvCtx) => {
              const itemsArray = Array.isArray(rawItems) ? rawItems : []
              const iconResolver = cvCtx?.resolveIcon ?? ctx.resolveIcon
              return itemsArray.map((item: any) =>
                normalizeTreeNode(item, iconResolver),
              )
            },
          })
        } else if (Array.isArray(opts)) {
          outputProps.data = opts.map((item: any) =>
            normalizeTreeNode(item, ctx.resolveIcon),
          )
        }
      }

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className
      }

      // ─── 剩余 prop 透传 ───
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
