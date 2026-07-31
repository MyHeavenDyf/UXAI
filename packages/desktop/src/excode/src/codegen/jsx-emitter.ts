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

import type { BuildNode, ComponentNode, HtmlNode, TextNode, LoopNode, RegularNode } from '../core/node-types'
import type { PropValue } from '../core/value-types'
import { collectRelativeFields } from '../core/scoped-enrichment'
import { stateRef, computedJsxConstName } from '../core/access-path'
import { pathToJsAccess } from '../core/access-path'

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
  /** inline loop 解构时需排除的字段名（enrichment/const 名撞名，由 fileAssembler 从 fileUnit 收集传入） */
  inlineLoopExcludedFields?: Set<string>
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
  inlineLoopExcludedFields: new Set<string>(),
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

/**
 * BindingValue / ComputedValue → 裸引用名（不带 `{}`，由调用方按上下文决定是否包）。
 *
 * 模板（emitValue）与抽离 const（fileAssembler.serializeForConstValue）共用本函数，
 * binding→引用规则只在此一处维护，避免两边各写一份改一边漏另一边。
 *
 *   - containsJSX computed → 文件顶部 const 名（computedJsxConstName）
 *   - absolute → stateRef（平面裸名已 destructure / 嵌套 initialState.ap）
 *   - relative → 按 opts（inTemplate/inRenderFnBody 裸字段，主树循环 loopVar.field）；
 *     const 场景（opts 未传/无 loopVar）理论上不出现 relative（模块顶部不在作用域），best-effort 裸 accessPath
 */
export function bindingRef(v: any, opts?: Required<EmitOptions>): string {
  if (v.type === 'computed' && v.containsJSX) return computedJsxConstName(v)
  const relPath = pathToJsAccess(v.accessPath ?? v.path)
  if (v.pathType === 'relative') {
    if (!opts) return relPath
    if (opts.inTemplate) return relPath
    if (opts.inRenderFnBody) return relPath
    return `${opts.loopVar}.${relPath}`
  }
  return stateRef(v.accessPath ?? v.path)
}

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

  // BindingValue / ComputedValue → 引用名（规则见 bindingRef，模板/const 共用）
  if (v.type === 'binding' || v.type === 'computed') {
    const expr = bindingRef(v, opts)
    // isPropValue（= JSX 独立表达式位置：顶级 prop 值 / 文本子节点）包 {…}；
    // 嵌套在对象/数组内（isPropValue=false）或 const 序列化（serializeForConstValue，不调此分支的包装）
    // 时裸引用——否则 key: {expr} 的 {} 在对象值位置是块语句，语法非法（如 Chart option.data）。
    return isPropValue ? `{${expr}}` : expr
  }

  // 嵌套数据对象（table datasets / columns 等） → JSON 形态
  if (v.type === undefined) {
    // BuildNode 组件（kind:'component'，来自 resolveIcon 等）→ JSX 元素
    // 作为 prop value 时需要包 {…}，嵌套在对象/数组内时不包
    if (v.kind === 'component' && typeof v.tag === 'string' && typeof v.props === 'object') {
      const expr = emitBuildNodeExpr(v, opts)
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
    return `className=${emitValue(value, opts, true)}`
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
  // value 是 varRef / rawExpr / binding（JSX 文本子节点 = 独立表达式位置，需包 {}）
  return emitValue(node.value, _opts, true)
}

// ─── BuildNode 组件表达式（kind:'component'，在 prop 值中嵌入 JSX 元素） ───
//
// 适用场景：resolveIcon 产出的图标节点被嵌入到 data 数组等字面量 prop 值中。
// 区别于 emitComponent（用于独立的 ComponentNode 节点），这个是 JSX 表达式值形态。

function emitBuildNodeExpr(v: { tag: string; props: Record<string, any>; selfClosing?: boolean; children?: any; id?: string }, opts: Required<EmitOptions>): string {
  const tagName = v.tag
  const props = v.props ?? {}
  const propParts: string[] = []
  for (const [k, vv] of Object.entries(props)) {
    // className 走 emitClassName（CSS Modules → styles.{id}，与 StyleConverter 收集的选择器对齐）；
    // 无 id 时回退裸字符串（旧行为）。selfId 取 BuildNode 自身 id（resolveIcon 由调用方传入）。
    if (k === 'className' || k === 'class') {
      const cn = emitClassName(vv as PropValue, { ...opts, selfId: v.id ?? opts.selfId })
      if (cn) propParts.push(cn)
      continue
    }
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number') propParts.push(`${k}={${vv}}`)
    else if (typeof vv === 'boolean') propParts.push(`${k}={${String(vv)}}`)
    else propParts.push(`${k}={${emitValue(vv as PropValue, opts, false)}}`)
  }
  const propsStr = propParts.join(' ')
  const attrs = propsStr ? ' ' + propsStr : ''

  // children（如 Dropdown overlay 的 Menu+Menu.Item 子树）：递归 emit；无 children 则自闭合。
  // 向后兼容：resolveIcon 产出的图标节点无 children / selfClosing，仍走自闭合分支。
  const children = (v as any).children
  if (v.selfClosing || !children) return `<${tagName}${attrs} />`
  if (Array.isArray(children)) {
    const childContent = children
      .map(c => emitNode(c as BuildNode, opts))
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
// 抽离模式：{(data || []).map((item, idx) => <Template data={item} key={idx} />)}
//   模板本身在 assembleComponentTemplate 中渲染，body 内容走 inTemplate 上下文。
// inline 模式（loop.inline=true，如 TabItem）：body 直接在 map 回调里渲染，
//   {(data || []).map((item, idx) => <TabItem key={idx} ...>{item.field}</TabItem>)}
//   相对绑定渲染为 item.field（isInLoop 上下文），不抽成单独文件。

function emitLoop(loop: LoopNode, opts: Required<EmitOptions>): string {
  // data 已被 tree-finalizer 替换为 VarRefValue({name: constName})；
  // render fn body 内的循环不经 tree-finalizer，loop.data 仍是 BindingValue。
  //   - varRef → name（主树循环，已被 routeLoopNode 替换）
  //   - relative binding → accessPath（render fn body 循环，数据源是外层
  //     render fn destructure 出的字段，如 row.rawData.actions → actions）
  //   - 兜底 'data'
  const dataBinding = loop.data as any
  let dataVar: string
  if (dataBinding?.type === 'varRef') {
    dataVar = dataBinding.name
  } else if (dataBinding?.type === 'binding' && dataBinding.pathType === 'relative') {
    dataVar = dataBinding.accessPath ?? dataBinding.path ?? 'data'
  } else {
    dataVar = 'data'
  }
  const paramName = loop.loopVar ?? 'item'

  // render fn body 内的循环强制 inline：render fn body 本就是 inline 上下文
  //（无单独模板文件），循环 body 直接在 map 回调里渲染，避免引用未生成的
  // Template 组件文件。相对绑定在此上下文 emit 为 {item.field}（运行时逐项值）。
  const forceInline = loop.inline || opts.inRenderFnBody

  // inline：body 直接在 map 回调里渲染（不引用 Template 组件）
  // 提前解构相对字段（const { f1, f2 } = item），body 内用裸 {f1}（inTemplate 模式，
  // 与抽离模板一致），避免循环模板复杂时满屏 item.xxx
  if (forceInline) {
    const bodyOpts = { ...opts, inTemplate: true }
    const bodies = loop.template.body
    const bodyJsx = bodies
      .map(n => emitNode(n, bodyOpts))
      .filter(s => s && s !== 'null')
      .join('\n')

    // 收集相对字段 → 解构行（排除 enrichment/const 名，避免撞名）
    const excluded = opts.inlineLoopExcludedFields ?? new Set<string>()
    const fields = new Set<string>()
    for (const b of bodies) {
      const f = collectRelativeFields(b)
      for (const field of f) {
        if (!excluded.has(field)) fields.add(field)
      }
    }

    // 第一个 JSX 元素注入 key={idx}（React list key 要求）
    const withKey = bodyJsx.replace(/^<([A-Za-z][A-Za-z0-9.]*)/, '<$1 key={idx}')

    if (fields.size > 0) {
      const sortedFields = [...fields].sort().join(', ')
      return `{(${dataVar} || []).map((${paramName}, idx) => {\n  const { ${sortedFields} } = ${paramName};\n  return (\n${indent(withKey, 4)}\n  );\n})}`
    }
    return `{(${dataVar} || []).map((${paramName}, idx) => ${withKey})}`
  }

  const templateName = loop.template.componentName ?? 'LoopTemplate'
  return `{(${dataVar} || []).map((${paramName}, idx) => <${templateName} data={${paramName}} key={idx} />)}`
}
