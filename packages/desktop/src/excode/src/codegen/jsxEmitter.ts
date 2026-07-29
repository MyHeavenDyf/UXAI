/**
 * jsx-emitter — BuildNode → JSX 字符串序列化
 *
 * 在 tree-finalizer 完成后运行。tree-finalizer 已做：
 *   - propRoute 提升（字面量 prop → moduleTopConsts / componentInternalConsts）
 *   - 字面量双绑 lift（LiteralValue.useState → useState 声明）
 *   - ExtractNode → 占位 ComponentNode（带 import 路径）
 *   - LoopNode.data → VarRefValue 指向 enrichment constName
 *
 * binding/computed 保留原类型不替换——state-builder 已把绝对 binding 的 accessPath
 * 收集为文件顶部 destructure 的 local var，jsx-emitter 直接 emit `accessPath`。
 */

/** ─── 手动开关 ─── */
/** 是否在产物 JSX 标签上输出 `id` 属性。设为 false 则所有标签不带 id。className 不受影响。 */
const EMIT_ID_DEFAULT = true

import type { BuildNode, ComponentNode, HtmlNode, TextNode, LoopNode, RegularNode } from '../core/nodeTypes'
import type { PropValue } from '../core/valueTypes'
import { collectRelativeFields } from '../core/scopedEnrichment'
import { stateRef, computedJsxConstName } from '../core/accessPath'

// ─── 选项 ───

export interface EmitOptions {
  /** 当前是否在循环体内（影响相对 binding 的渲染形态） */
  isInLoop?: boolean
  /** 循环变量名（默认 'item'） */
  loopVar?: string
  /** 是否在模板组件内部：相对 binding 渲染为裸 `{accessPath}`（不走 `item.`），由模板顶部 destructure 提供 */
  inTemplate?: boolean
  /** 是否在 render fn body 内部：相对 binding 渲染为裸 `{accessPath}`（不走 `item.`） */
  inRenderFnBody?: boolean
  /** render fn 的数据源 param 名（如 'rowData'），用于嵌套序列化时控制绑定前缀 */
  renderFnDataVarName?: string
  /** 是否使用 CSS Modules（*.module.less）；为 true 时 className 走 `styles.X` */
  useCssModules?: boolean
  /** CSS Modules 导入变量名，默认 'styles' */
  cssModuleVarName?: string
  /** 当前节点 id；className 通过 `styles.${selfId}` 引用 */
  selfId?: string
  /** 是否在产物 JSX 标签上输出 id 属性（默认 true） */
  emitId?: boolean
}

const DEFAULT_OPTS: Required<EmitOptions> = {
  isInLoop: false,
  loopVar: 'item',
  inTemplate: false,
  inRenderFnBody: false,
  renderFnDataVarName: '',
  useCssModules: false,
  cssModuleVarName: 'styles',
  selfId: '',
  emitId: EMIT_ID_DEFAULT,
}

function mergedOpts(opts?: EmitOptions): Required<EmitOptions> {
  return { ...DEFAULT_OPTS, ...(opts ?? {}) }
}

// ─── 公共辅助 ───

const AMP = '&'

export function escapeJSX(s: string): string {
  return s
    .replace(/"/g, `${AMP}quot;`)
    .replace(/\{/g, `${AMP}#123;`)
    .replace(/\}/g, `${AMP}#125;`)
}

export function indent(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return code
    .split('\n')
    .map(line => pad + line)
    .join('\n')
}

// ─── PropValue 分发 ───

function emitValue(value: PropValue, opts: Required<EmitOptions>, isPropValue?: boolean): string {
  if (value === null || value === undefined) return '{null}'

  // 非对象：原语。
  // isPropValue=true（默认）→ 套 {} 作为 JSX 表达式；
  // isPropValue=false（嵌套在数组/对象内）→ 裸值，不需要额外 {}（外层表达式已提供）
  if (typeof value !== 'object') {
    if (typeof value === 'string') return isPropValue !== false ? `{${JSON.stringify(value)}}` : JSON.stringify(value)
    if (typeof value === 'number' || typeof value === 'boolean') return isPropValue !== false ? `{${String(value)}}` : String(value)
    return '{null}'
  }

  // 数组：递归，数组内的值非 prop 上下文（isPropValue=false）。
  // 顶层 prop 数组 → `{[...]}`（进入 JSX 表达式上下文）；
  // 嵌套在对象/数组内的数组 → 裸 `[...]`（外层已提供表达式上下文，再包 {} 会变成 `{[...]}` 非法语法）。
  if (Array.isArray(value)) {
    const items = value.map(v => emitValue(v, opts, false)).join(', ')
    return isPropValue !== false ? `{[${items}]}` : `[${items}]`
  }

  const v = value as any

  // VarRefValue：编译期常量引用
  if (v.type === 'varRef') return `{${v.name}}`

  // RawExprValue：原始 JS 表达式
  if (v.type === 'rawExpr') return `{${v.value}}`

  // RenderFnValue：内联渲染函数（结构化 params + destructure 模式）
  if (v.type === 'renderFn') {
    const paramsArr: Array<{ name: string; dataSource?: any; dataField?: string }> = v.params ?? []
    const sig = paramsArr.map((p: any) => p.name).join(', ')
    const dataSourceParam = paramsArr.find((p: any) => p.dataSource)
    const dataSourceName: string = dataSourceParam?.name ?? ''
    const dataField: string | undefined = dataSourceParam?.dataField
    // 解构源：dataField 时为 name.dataField（如 row.rawData），否则 name
    const dataAccessor: string = dataField ? `${dataSourceName}.${dataField}` : dataSourceName

    const bodies = Array.isArray(v.body) ? v.body : [v.body]
    const bodyOpts = { ...opts, inRenderFnBody: !!dataSourceName, renderFnDataVarName: dataAccessor }

    // destructure 行（源 = dataAccessor，如 row.rawData；body 内相对绑定裸引用解构出的字段）
    let destructureLine = ''
    if (dataSourceName) {
      const fields = new Set<string>()
      for (const b of bodies) {
        const f = collectRelativeFields(b as BuildNode)
        for (const field of f) fields.add(field)
      }
      if (fields.size > 0) {
        destructureLine = `  const { ${[...fields].sort().join(', ')} } = ${dataAccessor};\n`
      }
    }

    const bodyJSX = bodies.map((n: BuildNode) => emitNode(n, bodyOpts)).join('\n')

    if (destructureLine) {
      return `(${sig}) => {\n${destructureLine}  return (\n${indent(bodyJSX, 4)}\n  )\n}`
    }
    return `(${sig}) => (\n${indent(bodyJSX, 2)}\n)`
  }

  // SlotNodeValue：渲染子树
  if (v.type === 'slotNode') {
    return emitNode(v.node, opts)
  }

  // BindingValue / ComputedValue：直接 emit 引用名（state.js destructure 后即为 local var）
  if (v.type === 'binding' || v.type === 'computed') {
    // 相对路径用 `/` 分隔（JSON Pointer），emit 时转 `.` 做属性访问
    const relPath = (v.accessPath ?? v.path).replace(/\//g, '.')
    if (v.pathType === 'relative') {
      // 优先级：inTemplate > inRenderFnBody > 主树循环
      if (opts.inTemplate) return `{${relPath}}`
      if (opts.inRenderFnBody) return `{${relPath}}`
      // 主树循环：渲染为 `{item.xxx}`
      return `{${opts.loopVar}.${relPath}}`
    }
    // containsJSX:true 的绝对 computed → 值在文件顶部 const（不在 initialState），
    // 引用 const 名（合法标识符，平面/嵌套统一），与 stateBuilder 的 jsxLiteralConst 名一致。
    // 嵌套 accessPath（brandInfo.logoIcon）若走 initialState 会引用错且 const 名带 `.` 非法。
    if (v.type === 'computed' && v.containsJSX) {
      return `{${computedJsxConstName(v)}}`
    }
    // 绝对路径：平面→本地变量（已 destructure）；嵌套→initialState.ap（值在 state.js）
    // 收拢到 accessPath.stateRef，与 treeFinalizer（useState / loop data）一致。
    const ap = v.accessPath ?? v.path
    return `{${stateRef(ap)}}`
  }

  // 嵌套数据对象（table datasets / columns 等） → JSON 形态
  if (v.type === undefined) {
    // BuildNode 组件（kind:'component'，来自 resolveIcon 等）→ JSX 元素
    // 作为 prop value 时需要包 {…}，嵌套在对象/数组内时不包
    if (v.kind === 'component' && typeof v.tag === 'string' && typeof v.props === 'object') {
      const expr = emitBuildNodeExpr(v)
      return isPropValue ? `{${expr}}` : expr
    }
    const entries = Object.entries(value)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, vv]) => `${k}: ${emitValue(vv as PropValue, opts, false)}`)
      .join(', ')
    const objBody = `{ ${entries} }`
    return isPropValue ? `{${objBody}}` : objBody
  }

  return '{null}'
}

// ─── props 序列化 ───

function emitProps(props: Record<string, PropValue> | undefined, opts: Required<EmitOptions>): string {
  if (!props) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(props)) {
    // className 特化：CSS Modules 模式走 `styles.X`，否则字符串
    if (key === 'className' || key === 'class') {
      const cn = emitClassName(value, opts)
      if (cn) parts.push(cn)
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as any
      if (v.type === 'slotNode') {
        // Slot 作为子节点写入，不渲染为 prop
        continue
      }
    }
    parts.push(`${key}=${emitValue(value, opts, true)}`)
  }
  return parts.join(' ')
}

/**
 * 序列化 className prop。
 *
 * 来源：
 *   A2UI props.className（如 "flex flex-col min-h-screen ..."）
 *
 * 形态：
 *   - CSS Modules (useCssModules=true)：只输出 `className={styles.${selfId}}`，
 *       因为 StyleConverter 已经把所有 Tailwind 工具类编入了同名 selector
 *       的 LESS 规则。再散布会破坏单一入口。
 *   - 非 CSS Modules：原样输出 A2UI className 字符串。
 *   - 非字符串（varRef / rawExpr）：交 emitValue 通用规则。
 */
function emitClassName(value: PropValue, opts: Required<EmitOptions>): string | null {
  // 非字符串：交给 emitValue
  if (typeof value !== 'string') {
    return `className=${emitValue(value, opts)}`
  }

  // 自动基类 = selfId（CSS Modules 时直接做 styles.{id}）
  const autoBase = opts.selfId

  // CSS Modules 形态：只输出 `styles.${autoBase}`，丢弃 props 里的 Tailwind 类
  // （它们已由 StyleConverter 编入该 selector 的 LESS 规则）
  if (opts.useCssModules && autoBase) {
    return `className={${opts.cssModuleVarName}.${autoBase}}`
  }

  // 非 CSS Modules 形态：A2UI className（必要时保留原值）
  const tokens = value.split(/\s+/).filter(Boolean)
  return `className="${tokens.join(' ')}"`
}
// ─── 节点分发 ───

export function emitNode(node: BuildNode | null | undefined, opts?: EmitOptions): string {
  if (!node) return 'null'

  const o = mergedOpts(opts)
  switch (node.kind) {
    case 'component':
      return emitComponent(node as ComponentNode, o)
    case 'html':
      return emitHtml(node as HtmlNode, o)
    case 'text':
      return emitText(node as TextNode, o)
    default:
      return 'null'
  }
}

function emitComponent(node: ComponentNode, opts: Required<EmitOptions>): string {
  const tag = node.tag ?? node.component
  const idAttr = opts.emitId && node.id ? ` id="${escapeJSX(node.id)}"` : ''
  // className 整体由 emitProps → emitClassName 走（含自动基类合并 + CSS Modules 转换）

  const propsStr = emitProps(node.props, { ...opts, selfId: node.id ?? '' })
  const allAttrs = [idAttr, propsStr].filter(Boolean).join(' ').trim()

  // children 形态判定
  const children = node.children
  let inner: string
  if (node.selfClosing || !children) {
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
  } else if (children && (children as any).kind === 'loop') {
    inner = emitLoop(children as LoopNode, opts)
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''}>\n${indent(inner, 2)}\n</${tag}>`
  } else if (Array.isArray(children)) {
    const childContent = children
      .map(c => emitNode(c, opts))
      .filter(s => s && s !== 'null')
      .join('\n')
    if (!childContent) {
      inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
    } else {
      inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''}>\n${indent(childContent, 2)}\n</${tag}>`
    }
  } else {
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
  }

  // wrapper 包裹层（如 CarouselItem）
  if (node.wrapper) {
    const wTag = (node.wrapper as any).tag ?? 'div'
    const wPropsStr = emitProps((node.wrapper as any).props ?? {}, opts)
    const wAttrs = wPropsStr ? ' ' + wPropsStr : ''
    return `<${wTag}${wAttrs}>\n${indent(inner, 2)}\n</${wTag}>`
  }

  return inner
}

function emitHtml(node: HtmlNode, opts: Required<EmitOptions>): string {
  const tag = node.tag
  const idAttr = opts.emitId && node.id ? ` id="${escapeJSX(node.id)}"` : ''

  const propsStr = emitProps(node.props, { ...opts, selfId: node.id ?? '' })
  const allAttrs = [idAttr, propsStr].filter(Boolean).join(' ').trim()

  const children = node.children
  let inner: string
  if (!children) {
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
  } else if (children && (children as any).kind === 'loop') {
    const loopInner = emitLoop(children as LoopNode, opts)
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''}>\n${indent(loopInner, 2)}\n</${tag}>`
  } else if (Array.isArray(children)) {
    const childContent = children
      .map(c => emitNode(c, opts))
      .filter(s => s && s !== 'null')
      .join('\n')
    if (!childContent) {
      inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
    } else {
      inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''}>\n${indent(childContent, 2)}\n</${tag}>`
    }
  } else {
    inner = `<${tag}${allAttrs ? ' ' + allAttrs : ''} />`
  }

  // wrapper 包裹层（如 CarouselItem）
  if (node.wrapper) {
    const wTag = (node.wrapper as any).tag ?? 'div'
    const wPropsStr = emitProps((node.wrapper as any).props ?? {}, opts)
    const wAttrs = wPropsStr ? ' ' + wPropsStr : ''
    return `<${wTag}${wAttrs}>\n${indent(inner, 2)}\n</${wTag}>`
  }

  return inner
}

function emitText(node: TextNode, _opts: Required<EmitOptions>): string {
  if (typeof node.value === 'string') return escapeJSX(node.value)
  // value 是 varRef / rawExpr / 占位 binding
  return emitValue(node.value, _opts)
}

// ─── BuildNode 组件表达式（kind:'component'，在 prop 值中嵌入 JSX 元素） ───
//
// 适用场景：resolveIcon 产出的图标节点被嵌入到 data 数组等字面量 prop 值中。
// 区别于 emitComponent（用于独立的 ComponentNode 节点），这个是 JSX 表达式值形态。

function emitBuildNodeExpr(v: { tag: string; props: Record<string, any>; selfClosing?: boolean; children?: any }): string {
  const tagName = v.tag
  const props = v.props ?? {}
  const propParts: string[] = []
  for (const [k, vv] of Object.entries(props)) {
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number') propParts.push(`${k}={${vv}}`)
    else if (typeof vv === 'boolean') propParts.push(`${k}={${String(vv)}}`)
    else propParts.push(`${k}={${emitValue(vv as PropValue, { ...mergedOpts() }, false)}}`)
  }
  const propsStr = propParts.join(' ')
  const attrs = propsStr ? ' ' + propsStr : ''

  // children（如 Dropdown overlay 的 Menu+Menu.Item 子树）：递归 emit；无 children 则自闭合。
  // 向后兼容：resolveIcon 产出的图标节点无 children / selfClosing，仍走自闭合分支。
  const children = (v as any).children
  if (v.selfClosing || !children) return `<${tagName}${attrs} />`
  if (Array.isArray(children)) {
    const childContent = children
      .map(c => emitNode(c as BuildNode, mergedOpts()))
      .filter(s => s && s !== 'null')
      .join('\n')
    if (!childContent) return `<${tagName}${attrs} />`
    return `<${tagName}${attrs}>\n${indent(childContent, 2)}\n</${tagName}>`
  }
  // LoopNode 等其他 children 形态在 prop 值内暂不支持，回退自闭合
  return `<${tagName}${attrs} />`
}

// ─── 循环 children ───
//
// 父组件 emit 形式：{(data || []).map((item, idx) => <Template data={item} key={idx} />)}
// 模板本身在 assembleComponentTemplate 中渲染，body 内容走 inTemplate 上下文。

function emitLoop(loop: LoopNode, opts: Required<EmitOptions>): string {
  // data 已被 tree-finalizer 替换为 VarRefValue({name: constName})
  const dataVar = (loop.data as any).type === 'varRef' ? (loop.data as any).name : 'data'
  const paramName = loop.loopVar ?? 'item'
  const templateName = loop.template.componentName ?? 'LoopTemplate'

  return `{(${dataVar} || []).map((${paramName}, idx) => <${templateName} data={${paramName}} key={idx} />)}`
}
