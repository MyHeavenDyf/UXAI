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
import { stateRef, computedJsxConstName, accessPathToJsExpr, isValidIdentifier, cssModuleRef } from '../core/access-path'
import { emitKey } from './js-serializer'

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
  /** className 在产物 JSX 上的输出 key 别名（默认 'className'）；由 emitComponent 从 node.classNameProp 透传，emitClassName 输出时用 */
  classNameProp?: string
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
  classNameProp: 'className',
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
  const ap = v.accessPath ?? v.path
  if (v.pathType === 'relative') {
    if (!opts) {
      // const 场景（模块顶部不在循环/render fn 作用域）不该出现 relative binding；
      // 若误入，裸 accessPath 运行时 undefined，加 warn 提示而非静默
      console.warn(`  [warn] bindingRef: relative binding "${ap}" in const 场景（模块顶部不在作用域，可能产错代码）`)
      return accessPathToJsExpr(ap)
    }
    if (opts.inTemplate) return relativeRef(ap, 'data')
    if (opts.inRenderFnBody) return relativeRef(ap, opts.renderFnDataVarName)
    // 主树循环：始终 base=loopVar（item.a / item["a-b"] / item.a["b-c"]）
    return accessPathToJsExpr(ap, opts.loopVar)
  }
  return stateRef(v.accessPath ?? v.path)
}

/**
 * 模板 / render fn body 内相对 binding 的 emit（首段是否合法标识符决定形态）。
 *
 * - 首段合法标识符 → 已被模板/render fn 顶部 destructure 为本地变量，裸首段 + 嵌套 bracket
 *   （`a`→`a`；`a.b-c`→`a["b-c"]`）
 * - 首段非标识符（如 `a-b`）→ 不进 destructure，用 base 访问
 *   （`data["a-b"]` / `row.rawData["a-b"]`）
 *
 * destructure 生成处（file-assembler 模板 / jsx-emitter render fn）已过滤掉非标识符 top 字段，
 * 故非标识符首段不会出现在 `const { ... } = data` 里，与此处 base 访问一致。
 */
function relativeRef(ap: string, base: string): string {
  const topField = ap.split(/[.\[]/)[0]
  if (isValidIdentifier(topField)) return accessPathToJsExpr(ap)   // 裸首段（已 destructure）
  return accessPathToJsExpr(ap, base)
}

/**
 * 值序列化：PropValue → 裸 JS 表达式（不包 `{}`）。
 * `{}` 是 JSX 语法层的事（prop 值 `key={...}`、子节点 `{...}`），由调用方按上下文包。
 * 与 serializeForConstValue（const 路径）一致——两者都返回裸表达式。
 */
function emitValue(value: PropValue, opts: Required<EmitOptions>): string {
  if (value === null || value === undefined) return 'null'

  // 非对象：原语 → 裸值（字符串 JSON-quote、数字/布尔 String()）
  if (typeof value !== 'object') {
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return 'null'
  }

  // 数组：递归，元素为裸值
  if (Array.isArray(value)) {
    const items = value.map(v => emitValue(v, opts)).join(', ')
    return `[${items}]`
  }

  const v = value as any

  // VarRefValue：编译期常量引用 → 裸 name
  if (v.type === 'varRef') return v.name

  // RawExprValue：原始 JS 表达式 → 裸 value
  if (v.type === 'rawExpr') return v.value

  // ActionValue：事件 setState → () => setSharedState(key, value)
  // 调用方（emitProps）包 {} → onClick={() => setSharedState('isDetailOpen', true)}
  // key = path 剥前导 `/` 取顶层段（协议：共享 path 只在顶层）；value 暂只字面量。
  if (v.type === 'action') {
    const key = String(v.path || '').replace(/^\//, '').split('/')[0]
    return `() => setSharedState('${key}', ${JSON.stringify(v.value)})`
  }

  // RenderFnValue：内联渲染函数（结构化 params + destructure 模式）
  if (v.type === 'renderFn') {
    const paramsArr: Array<{ name: string; dataSource?: any; dataField?: string }> = v.params ?? []
    const dataSourceParam = paramsArr.find((p: any) => p.dataSource)
    const dataSourceName: string = dataSourceParam?.name ?? ''
    const dataField: string | undefined = dataSourceParam?.dataField
    const dataAccessor: string = dataField ? `${dataSourceName}.${dataField}` : dataSourceName
    const bodyOpts = { ...opts, inRenderFnBody: !!dataSourceName, renderFnDataVarName: dataAccessor }
    return serializeRenderFnBody(v, bodyOpts, 0)
  }

  // SlotNodeValue：渲染子树
  if (v.type === 'slotNode') {
    return emitNode(v.node, opts)
  }

  // BindingValue / ComputedValue → 裸引用（规则见 bindingRef，模板/const 共用）
  if (v.type === 'binding' || v.type === 'computed') {
    return bindingRef(v, opts)
  }

  // BuildNode（kind:'component'，来自 resolveIcon 等）→ 裸 JSX 元素
  // 注意：BuildNode 有 __node brand 但无 PropValue type，须在 !v.__node 之前检查
  if (v.kind === 'component' && typeof v.tag === 'string' && typeof v.props === 'object') {
    return emitBuildNodeExpr(v, opts)
  }

  // 普通对象（无 __node brand）→ 对象字面量
  if (!v.__node) {
    const entries = Object.entries(value)
      .filter(([k]) => !k.startsWith('__'))
      .map(([k, vv]) => `${emitKey(k)}: ${emitValue(vv as PropValue, opts)}`)
      .join(', ')
    return `{ ${entries} }`
  }

  return 'null'
}

/**
 * RenderFnValue → 内联渲染函数序列化（emitValue 主树 + serializeForConstValue const 共用）。
 *
 * - params → sig；dataSource param → dataAccessor（destructure 源，调用方算好传 bodyOpts.renderFnDataVarName）
 * - body 内相对绑定裸引用（inRenderFnBody，emitNode/bindingRef 消费），destructure 顶级字段（collectRelativeFields）
 * - indentBase：缩进基准（emitValue 主树传 0；serializeForConstValue const 传 lvl，随嵌套层级）
 * - bodyOpts：调用方构造（emitValue 继承主树 opts；const 从 constEmit 取 useCssModules/cssModuleVarName）
 */
export function serializeRenderFnBody(v: any, bodyOpts: any, indentBase: number): string {
  const paramsArr: Array<{ name: string; dataSource?: any; dataField?: string }> = v.params ?? []
  const sig = paramsArr.map((p: any) => p.name).join(', ')
  const dataAccessor: string = bodyOpts.renderFnDataVarName ?? ''
  const bodies = Array.isArray(v.body) ? v.body : [v.body]
  const bodyPad = ' '.repeat(indentBase + 2)
  const closePad = ' '.repeat(indentBase)
  let destructureLine = ''
  if (dataAccessor) {
    const fields = new Set<string>()
    for (const b of bodies) {
      const f = collectRelativeFields(b as BuildNode)
      for (const field of f) fields.add(field)
    }
    if (fields.size > 0) {
      // 仅 destructure 合法标识符 top 字段；非标识符字段（如 a-b）不进 destructure，
      // 由 bindingRef 用 base 访问（row.rawData["a-b"]）
      const validFields = [...fields].filter(isValidIdentifier).sort()
      if (validFields.length > 0) {
        destructureLine = `${bodyPad}const { ${validFields.join(', ')} } = ${dataAccessor};\n`
      }
    }
  }
  const bodyJSX = bodies.map((n: BuildNode) => emitNode(n, bodyOpts)).join('\n')
  if (destructureLine) {
    return `(${sig}) => {\n${destructureLine}${bodyPad}return (\n${indent(bodyJSX, indentBase + 4)}\n${bodyPad})\n${closePad}}`
  }
  return `(${sig}) => (\n${indent(bodyJSX, indentBase + 2)}\n${closePad})`
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
    // slotNode / BuildNode / 字面量对象等：一律交 emitValue 渲染为 prop 值。
    // slotNode 在 prop 值位置 = 「子树作 prop 值」（如 eview-ui Dropdown overlay={<Menu>...}）：
    // emitValue 对 slotNode 走 emitNode（完整 emit 含 LoopNode children），stateBuilder 的
    // consumeValue 对 slotNode 走 walk（收集子树 binding/computed/LoopNode）。四端基础设施已就绪。
    // （既有映射若需把 slotNode 转成 children，应在 transform 里 ctx.resolveNode 消费掉、
    //   不留进 outputProps——留给 emitProps 的兜底渲染只是防「静默丢失」。）
    parts.push(`${key}={${emitValue(value, opts)}}`)
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
  const key = opts.classNameProp
  // 非字符串：交给 emitValue
  if (typeof value !== 'string') {
    return `${key}={${emitValue(value, opts)}}`
  }

  // 自动基类 = selfId（CSS Modules 时直接做 styles.{id}）
  const autoBase = opts.selfId

  // CSS Modules 形态：只输出 `styles.${autoBase}`，丢弃 props 里的 Tailwind 类
  // （它们已由 StyleConverter 编入该 selector 的 LESS 规则）
  if (opts.useCssModules && autoBase) {
    return `${key}={${cssModuleRef(opts.cssModuleVarName, autoBase)}}`
  }

  // 非 CSS Modules 形态：A2UI className（必要时保留原值）
  const tokens = value.split(/\s+/).filter(Boolean)
  return `${key}="${tokens.join(' ')}"`
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
  // 注释占位：未注册组件 / transform 抛错时由 NodeMapper 标记，
  // 输出为 JSX 注释，子节点与 props 丢弃（节点已退化，无可用渲染形态）。
  if (node.commentPlaceholder) {
    return `{/* ${node.commentPlaceholder} */}`
  }
  const tag = node.tag ?? node.component
  const idAttr = opts.emitId && node.id ? ` id="${escapeJSX(node.id)}"` : ''
  // className 整体由 emitProps → emitClassName 走（含自动基类合并 + CSS Modules 转换）

  const propsStr = emitProps(node.props, { ...opts, selfId: node.id ?? '', classNameProp: node.classNameProp ?? 'className' })
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

  const propsStr = emitProps(node.props, { ...opts, selfId: node.id ?? '', classNameProp: 'className' })
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

function emitText(node: TextNode, opts: Required<EmitOptions>): string {
  if (typeof node.value === 'string') return escapeJSX(node.value)
  // value 是 varRef / rawExpr / binding（JSX 文本子节点 = 独立表达式位置，需包 {}）
  return `{${emitValue(node.value, opts)}}`
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
      const cn = emitClassName(vv as PropValue, { ...opts, selfId: v.id ?? opts.selfId, classNameProp: (v as any).classNameProp ?? 'className' })
      if (cn) propParts.push(cn)
      continue
    }
    if (vv === true) propParts.push(k)
    else if (vv === false || vv === null || vv === undefined) continue
    else if (typeof vv === 'string') propParts.push(`${k}=${JSON.stringify(vv)}`)
    else if (typeof vv === 'number') propParts.push(`${k}={${vv}}`)
    else if (typeof vv === 'boolean') propParts.push(`${k}={${String(vv)}}`)
    else propParts.push(`${k}={${emitValue(vv as PropValue, opts)}}`)
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
    // ⚠️ 暂只支持单 JSX 元素 body：A2UI 循环模板 body 约定单根（一个组件/元素）。
    // 正则 ^< 只匹配 bodyJsx 开头的 <Tag：text-leading body（首节点文本）不注入 key；
    // multi-element body（多元素）只首个注入。这两类场景输入数据不出现，暂不处理。
    //
    // 若首元素已自带 key prop（如 eview-ui Dropdown overlay 的 Menu.Item 模板，
    // key={key} 来自相对绑定，既是 React list key 又是 Menu.Item 语义 value），
    // 则跳过 key={idx} 注入、map 回调用 (item) 签名（无 idx），避免覆盖/冲突。
    const firstBody = bodies[0] as any
    const hasOwnKey =
      firstBody && typeof firstBody === 'object' && firstBody.props && 'key' in firstBody.props
    const withKey = hasOwnKey
      ? bodyJsx
      : bodyJsx.replace(/^<([A-Za-z][A-Za-z0-9.]*)/, '<$1 key={idx}')
    const mapSig = hasOwnKey ? `(${paramName})` : `(${paramName}, idx)`

    if (fields.size > 0) {
      const sortedFields = [...fields].sort().join(', ')
      return `{(${dataVar} || []).map(${mapSig} => {\n  const { ${sortedFields} } = ${paramName};\n  return (\n${indent(withKey, 4)}\n  );\n})}`
    }
    return `{(${dataVar} || []).map(${mapSig} => ${withKey})}`
  }

  const templateName = loop.template.componentName ?? 'LoopTemplate'
  return `{(${dataVar} || []).map((${paramName}, idx) => <${templateName} data={${paramName}} key={idx} />)}`
}
