/**
 * Timeline → TimeLine 映射（新架构）
 *
 * A2UI Timeline → eview-react TimeLine 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | orientation | — | 丢弃（eview-react 只支持垂直） |
 * | mode / variant | — | 丢弃 |
 * | className | className | 透传 |
 * | children（TimelineItem 列表） | data + render | **吞噬 children** → 转为 dataType[] + render 函数 |
 *
 * ## dataType 映射
 *
 * | A2UI TimelineItem prop | eview-react dataType | 处理方式 |
 * |------------------------|---------------------|---------|
 * | title / label | title + content[{title, text}] | A2UI title/label → dataType.title，同时放入 content 对象 |
 * | content（字面量） | content[{title, text}] | 与 title 合并到同一对象：{ title, text } |
 * | content（DataBinding） | content[{title, text}] | 同上，每项 item[path] 映射 |
 * | content（SlotNode） | render fn body | 不放入 content 数组，resolve 后作为 render 函数 body |
 * | icon（字面量，iconType 值） | iconType | 'success'/'error'/'default' → iconType |
 * | icon（字面量，图标名） | icon | ctx.resolveIcon() |
 * | icon（DataBinding） | iconType / icon | ComputedValue，运行时判断 iconType vs icon |
 *
 * ## render 函数
 *
 * eview-react TimeLine 组件需要 `render` prop：`(content?: { [key: string]: any }[]) => ReactNode`。
 * 组件对每个时间线项调用 render，传入该项的 content 数组。render 只接收一个参数。
 *
 * - SlotNode content → render body 为 resolve 后的子树
 *   相对绑定改写为 content?.[0]?.fieldName 的 rawExpr（因为 eview-react 只传 content 数组，
 *   无法用 dataSource 解构——解构 const { field } = content 对数组无效）
 *   data 项的 content 对象需包含所有相对绑定字段，供 render 通过 content[0] 访问
 * - 文本/绑定 content → render 使用 rawExpr 渲染 content 数组中的 title 和 text
 *
 * ## 特殊逻辑
 *
 * - 同 Steps/Table 的"吞噬 children → data prop"模式
 * - eview-react 的 content 是对象数组 `{ title, text }` 格式（title 和 text 在同一对象）
 * - icon 字面量区分 iconType（'success'/'error'/'default'）和自定义图标路径
 * - icon DataBinding 走 ComputedValue，运行时自动分发 iconType vs icon
 * - render 函数是组件级别的（所有 item 共用一个 render）
 * - SlotNode + loop 时，相对绑定改写为 content?.[0]?.field 引用（不走 dataSource 解构）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 *
 * ⚠️ eview-ui 本地副本：自定义图标（非 iconType 枚举）一律用统一占位 URL（写死），
 * 不调 resolveIcon、不产 React DOM——eview-ui 的 icon 相关属性只接 URL。
 * iconType 枚举（success/error/default）保留不变。icon 由 BuildNode 变字符串 →
 * data 无 JSX → 循环 data 的 containsJSX 翻 false（data 走 state.js 纯 JSON）。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { LoopNode } from '../../../src/core/node-types'
import type { PropValue, BindingValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { PLACEHOLDER_ICON_URL } from './icon-placeholder'

/** iconType 预设值集合 */
const ICON_TYPES = new Set(['success', 'error', 'default'])

/** 从 TimelineItem 节点 props 中提取字段映射信息 */
interface ItemFieldMap {
  titleField: string | null; titleValue: string | null
  labelField: string | null; labelValue: string | null
  contentField: string | null; contentValue: string | null; contentIsSlot: boolean
  iconField: string | null; iconValue: string | null; iconIsType: boolean
  hasJSX: boolean
}

function extractFieldMap(item: any): ItemFieldMap {
  const p = item?.props || {}
  const m: ItemFieldMap = {
    titleField: null, titleValue: null,
    labelField: null, labelValue: null,
    contentField: null, contentValue: null, contentIsSlot: false,
    iconField: null, iconValue: null, iconIsType: false,
    hasJSX: false,
  }

  // label（A2UI 新版用 label 代替 title，优先于 title）
  if (p.label) {
    if (p.label.type === 'binding') m.labelField = p.label.path
    else if (typeof p.label === 'string') m.labelValue = p.label
  }

  // title（兼容旧版 A2UI，label 优先）
  if (!m.labelField && !m.labelValue && p.title) {
    if (p.title.type === 'binding') m.titleField = p.title.path
    else if (typeof p.title === 'string') m.titleValue = p.title
  }

  // content（三分支：string / DataBinding / SlotNode）
  if (p.content) {
    if (p.content.type === 'binding') m.contentField = p.content.path
    else if (p.content.type === 'slotNode') m.contentIsSlot = true
    else if (typeof p.content === 'string') m.contentValue = p.content
  }

  // icon（string / DataBinding）
  //   eview-ui：自定义图标占位 URL（写死），不再 resolveIcon；iconType 枚举仍走下方 iconIsType 分支。
  //   hasJSX 不再置 true（icon 不产 JSX → data 无 JSX → containsJSX:false）。
  if (p.icon) {
    if (p.icon.type === 'binding') { m.iconField = p.icon.path }
    else if (typeof p.icon === 'string') {
      m.iconValue = p.icon
      m.iconIsType = ICON_TYPES.has(p.icon)
    }
  }

  return m
}

/** 获取有效的 title 字段名（label 优先于 title） */
function getTitleField(f: ItemFieldMap): string | null {
  return f.labelField ?? f.titleField
}

/** 获取有效的 title 字面值（label 优先于 title） */
function getTitleValue(f: ItemFieldMap): string | null {
  return f.labelValue ?? f.titleValue
}

/** 清除节点树中的 loopScope（断循环引用） */
function cleanLoopScope(n: any): void {
  if (!n || typeof n !== 'object') return
  delete n.loopScope
  if (Array.isArray(n.children)) n.children.forEach(cleanLoopScope)
  if (n.kind === 'loop') { cleanLoopScope(n.template); n.template?.body?.forEach(cleanLoopScope) }
  if (n.props && typeof n.props === 'object') {
    for (const v of Object.values(n.props)) {
      if (v && typeof v === "object" && !(v as any).type) cleanLoopScope(v)
    }
  }
}

/** 收集 SlotNode 子树中所有相对绑定的顶级字段名 */
function collectRelativeBindingFields(node: any, fields: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return fields
  // 检查是否为相对绑定值
  if (node.type === 'binding' && node.pathType === 'relative' && typeof node.path === 'string') {
    const topField = node.path.replace(/^\/?/, '').split('/')[0]
    if (topField) fields.add(topField)
  }
  // TextNode：value 可能是 BindingValue（BuildTrees 将 HTML value 下沉为 TextNode）
  if (node.kind === 'text' && node.value && typeof node.value === 'object') {
    collectRelativeBindingFields(node.value, fields)
  }
  // 递归子节点
  if (Array.isArray(node.children)) node.children.forEach((c: any) => collectRelativeBindingFields(c, fields))
  if (node.kind === 'loop') { collectRelativeBindingFields(node.template, fields); node.template?.body?.forEach((c: any) => collectRelativeBindingFields(c, fields)) }
  if (node.props && typeof node.props === 'object') {
    for (const v of Object.values(node.props)) {
      if (v && typeof v === 'object') collectRelativeBindingFields(v, fields)
    }
  }
  if (node.body && Array.isArray(node.body)) node.body.forEach((c: any) => collectRelativeBindingFields(c, fields))
  return fields
}

/**
 * 将 SlotNode 子树中的相对绑定改写为 content?.[0]?.field 的 rawExpr 引用。
 *
 * eview-react TimeLine 的 render 只接收一个参数（content 数组），
 * 无法用 dataSource 解构（const { field } = content 对数组无效），
 * 所以将相对绑定改写为从 content 首个元素直接取值。
 */
function rewriteRelativeBindingsAsContentAccess(node: any): void {
  if (!node || typeof node !== 'object') return

  // Props 中：替换相对绑定为 rawExpr
  if (node.props && typeof node.props === 'object') {
    for (const key of Object.keys(node.props)) {
      const val = node.props[key]
      if (val && typeof val === 'object' && val.type === 'binding' && val.pathType === 'relative' && typeof val.path === 'string') {
        // BindingValue 替换为 RawExprValue
        node.props[key] = Value.rawExpr({ value: `content?.[0]?.${val.path}` })
      }
    }
  }

  // TextNode：value 可能是相对 BindingValue（HTML value 下沉场景）
  if (node.kind === 'text' && node.value && typeof node.value === 'object'
    && node.value.type === 'binding' && node.value.pathType === 'relative' && typeof node.value.path === 'string') {
    node.value = Value.rawExpr({ value: `content?.[0]?.${node.value.path}` })
  }

  // 递归子节点
  if (Array.isArray(node.children)) node.children.forEach(rewriteRelativeBindingsAsContentAccess)
  if (node.kind === 'loop') {
    rewriteRelativeBindingsAsContentAccess(node.template)
    node.template?.body?.forEach(rewriteRelativeBindingsAsContentAccess)
  }
  if (node.body && Array.isArray(node.body)) node.body.forEach(rewriteRelativeBindingsAsContentAccess)
}

export function createTimelineMapping(pkg: string): MappingDef {
  return {
    tag: 'TimeLine',
    import: `${pkg}/TimeLine`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const children = node.children
      const outputProps: Record<string, PropValue> = {}

      // ─── 简单 prop ───
      if (props.className) outputProps.className = props.className as PropValue

      // ─── children → data + render ───
      if (!children) {
        outputProps.data = []
        return { props: outputProps, children: null }
      }

      if (Array.isArray(children)) {
        // ═══ 分支 A：静态 children ═══
        const data: any[] = []
        let hasSlotContent = false
        let slotChild: any = null

        for (let i = 0; i < children.length; i++) {
          const child = children[i] as any
          const f = extractFieldMap(child)

          // 构建 content 数组（eview-react 格式：{ title, text } 合并对象）
          const contentObj: Record<string, any> = {}
          const titleVal = getTitleValue(f)
          const titleField = getTitleField(f)

          // title/label → content 中的 title
          if (titleVal !== null) contentObj.title = titleVal
          else if (titleField) contentObj.title = child.props.label ?? child.props.title  // BindingValue

          // content → content 中的 text
          if (f.contentValue !== null) contentObj.text = f.contentValue
          else if (f.contentField) contentObj.text = child.props.content  // BindingValue
          // SlotNode content → 不放入 content 数组，由 render 函数直接渲染

          const contentArr: any[] = (Object.keys(contentObj).length > 0) ? [contentObj] : []

          // 构建 data 项：A2UI title/label → dataType.title（不是 date）
          const item: Record<string, any> = {}
          if (titleVal !== null) item.title = titleVal
          else if (titleField) item.title = child.props.label ?? child.props.title  // BindingValue

          if (contentArr.length > 0) item.content = contentArr

          // icon 分发：iconType（枚举）vs icon（占位 URL，写死）
          if (f.iconValue) {
            if (f.iconIsType) {
              item.iconType = f.iconValue
            } else {
              item.icon = PLACEHOLDER_ICON_URL
            }
          } else if (f.iconField) {
            // DataBinding icon：iconType 检测枚举；icon 非枚举时给占位 URL（写死，containsJSX:false）
            const iconBinding = child.props.icon
            item.iconType = Value.computed({
              path: iconBinding.path,
              pathType: iconBinding.pathType ?? 'absolute',
              accessPath: iconBinding.accessPath ? `${iconBinding.accessPath}IconType` : 'timelineIconType',
              containsJSX: false,
              transform: (raw: any) => (typeof raw === 'string' && ICON_TYPES.has(raw)) ? raw : undefined,
            })
            item.icon = Value.computed({
              path: iconBinding.path,
              pathType: iconBinding.pathType ?? 'absolute',
              accessPath: iconBinding.accessPath ?? 'timelineIcon',
              containsJSX: false,
              transform: (raw: any) => (typeof raw === 'string' && !ICON_TYPES.has(raw)) ? PLACEHOLDER_ICON_URL : null,
            })
          }

          // 记录 SlotNode content（用于 render 函数构建）
          if (f.contentIsSlot) {
            hasSlotContent = true
            slotChild = child
          }

          data.push(item)
        }
        outputProps.data = data as any

        // ─── render 函数 ───
        if (hasSlotContent && slotChild) {
          // SlotNode content → render body 为 resolve 后的子树
          const resolvedContent = ctx.resolveNode(slotChild.props.content.node)
          if (resolvedContent) {
            cleanLoopScope(resolvedContent)
            outputProps.render = Value.renderFn({
              params: [{ name: 'content' }],
              body: resolvedContent,
            })
          }
        } else {
          // 文本/绑定 content → render 使用 rawExpr 渲染 content 数组中的 title 和 text
          outputProps.render = Value.rawExpr({
            value: '(content) => <div>{content?.map((item, i) => <div key={i}>{item.title && <div>{item.title}</div>}{item.text && <div>{item.text}</div>}</div>)}</div>',
          })
        }

        // ─── propRoute ───
        const propRoute: Record<string, any> = {}
        if (outputProps.render && (outputProps.render as any).type === 'renderFn') {
          propRoute.render = 'module-top'
        }

        return { props: outputProps, children: null, propRoute: Object.keys(propRoute).length > 0 ? propRoute : undefined }
      }

      if ((children as any).kind === 'loop') {
        // ═══ 分支 B：循环模板 ═══
        const loop = children as LoopNode
        const tmpl = loop.template.body[0] as any
        if (!tmpl) { outputProps.data = []; return { props: outputProps, children: null } }

        const f = extractFieldMap(tmpl)
        const dataBinding = loop.data as BindingValue
        const titleField = getTitleField(f)

        // 收集 SlotNode 子树中的相对绑定字段（用于 content 对象构建）
        let slotRelativeFields: Set<string> = new Set()
        if (f.contentIsSlot) {
          const slotNode = tmpl.props.content?.node
          if (slotNode) {
            slotRelativeFields = collectRelativeBindingFields(ctx.resolveNode(slotNode))
          }
        }

        // SlotNode content 预 resolve
        let resolvedSlot: any = null
        if (f.contentIsSlot) {
          resolvedSlot = ctx.resolveNode(tmpl.props.content.node)
          if (resolvedSlot) cleanLoopScope(resolvedSlot)
        }

        outputProps.data = Value.computed({
          path: dataBinding.path,
          pathType: dataBinding.pathType ?? 'absolute',
          accessPath: dataBinding.accessPath ?? 'timelineData',
          containsJSX: false, // eview-ui icon 占位字符串后 data 无 JSX → 走 state.js 纯 JSON
          transform: (rawData: any, cvCtx?: any) => {
            if (!Array.isArray(rawData)) return []

            return rawData.map((item: any) => {
              // 构建 content 数组：合并 title + text 到同一对象
              const contentObj: Record<string, any> = {}

              // title/label → content 中的 title
              if (titleField) contentObj.title = item[titleField] ?? ''
              else if (getTitleValue(f)) contentObj.title = getTitleValue(f)

              // content → content 中的 text
              if (f.contentField) contentObj.text = item[f.contentField] ?? ''
              else if (f.contentValue !== null) contentObj.text = f.contentValue
              // SlotNode → 不放入 content 数组的 text 字段

              // 如果是 SlotNode，把相对绑定的字段也放入 content 对象
              // 供 render 函数通过 content[0].fieldName 访问
              if (f.contentIsSlot) {
                for (const field of slotRelativeFields) {
                  if (item[field] !== undefined) contentObj[field] = item[field]
                }
              }

              const contentArr: any[] = (Object.keys(contentObj).length > 0) ? [contentObj] : []

              // 构建 data 项：A2UI title/label → dataType.title
              const dataItem: Record<string, any> = {}
              if (titleField) dataItem.title = item[titleField] ?? ''
              else if (getTitleValue(f)) dataItem.title = getTitleValue(f)

              if (contentArr.length > 0) dataItem.content = contentArr

              // icon 分发：iconType（枚举）vs icon（占位 URL，写死）
              if (f.iconField) {
                const name = item[f.iconField]
                if (typeof name === 'string') {
                  if (ICON_TYPES.has(name)) {
                    dataItem.iconType = name
                  } else {
                    dataItem.icon = PLACEHOLDER_ICON_URL
                  }
                }
              } else if (f.iconValue) {
                if (f.iconIsType) {
                  dataItem.iconType = f.iconValue
                } else {
                  dataItem.icon = PLACEHOLDER_ICON_URL
                }
              }

              return dataItem
            })
          },
        })

        // ─── render 函数 ───
        if (f.contentIsSlot && resolvedSlot) {
          // SlotNode content → render body 为 resolve 后的子树
          // eview-react 的 render 只接收 content 数组一个参数，无法用 dataSource 解构
          // （const { field } = content 对数组无效），
          // 所以将相对绑定改写为 content?.[0]?.field 的 rawExpr 引用
          rewriteRelativeBindingsAsContentAccess(resolvedSlot)
          outputProps.render = Value.renderFn({
            params: [{ name: 'content' }],
            body: resolvedSlot,
          })
        } else {
          // 文本/绑定 content → render 使用 rawExpr 渲染 content 数组中的 title 和 text
          outputProps.render = Value.rawExpr({
            value: '(content) => <div>{content?.map((item, i) => <div key={i}>{item.title && <div>{item.title}</div>}{item.text && <div>{item.text}</div>}</div>)}</div>',
          })
        }

        // ─── propRoute ───
        const propRoute: Record<string, any> = {}
        if (outputProps.render && (outputProps.render as any).type === 'renderFn') {
          propRoute.render = 'module-top'
        }

        return { props: outputProps, children: null, propRoute: Object.keys(propRoute).length > 0 ? propRoute : undefined }
      }

      return { props: outputProps, children: null }
    },
  }
}
