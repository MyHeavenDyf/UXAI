/**
 * tree-finalizer — FileGenerator 树上处理层
 *
 * 对 rootTree 一次性 DFS，在 state-builder 完成之后：
 *
 *   B1: （已删除 — binding/computed 不再替换为 varRef，保留原类型供 jsx-emitter 直接序列化）
 *   B2: LoopNode.data 数据源引用处理（有 enrichment 时指向 enrichment constName）
 *   B3: ExtractNode → 注册到 extractedFiles；引用端替换为占位 ComponentNode
 *   B4: propRoute 消费（'inline' | 'module-top' | 'component-internal'）
 *   + 字面量双绑 lift（LiteralValue.useState → useState 声明）
 *
 * 输出：TreeFinalizerResult = { mainFile: FileDraft, extractedFiles: PendingExtractedFile[] }
 *
 * 不做（下一阶段 import-collector / jsx-emitter）：
 *   - import 收集、JSX 字符串生成
 *   - 文件顶部 const 拼装（file-assembler 按 FileUnit 信息生成）
 */

import path from 'path'

import type { BuildNode, ComponentNode, HtmlNode, TextNode, ExtractNode, LoopNode, RegularNode } from '../core/node-types'
import type { PropValue, VarRefValue } from '../core/value-types'
import { Value } from '../core/value-factory'
import type { StateBuilderResult } from './state-builder'
import { sharedKeyOfPath } from './state-builder'
import { stateRef, makeEnrichmentConstName, loopClassNamePrefix, loopClassNameConstName, loopClassNameMapName, cssModuleRef, accessPathToJsExpr } from '../core/access-path'

// ─── 产出物 ───

export interface PendingConstDecl {
  name: string
  value: PropValue
  isUseState?: boolean
  /** 共享标记：该 const 来自 eventMutatedPaths 命中的 binding/computed → emit useSharedState 而非 useState/initialState */
  shared?: boolean
  /** 共享 store 的顶层 key（v.accessPath，如 'isDetailOpen'）；shared=true 时必填 */
  sharedKey?: string
  /** 共享只读（无 useState 的 shared binding）→ emit `const name = useSharedState(key)`（单常量，无 setter） */
  sharedRead?: boolean
}

export interface PendingExtractedFile extends Pick<ExtractNode, 'purpose' | 'fileName'> {
  path: string
  componentName: string
  body: BuildNode[]
  params?: Record<string, PropValue>
  moduleTopConsts?: PendingConstDecl[]
  componentInternalConsts?: PendingConstDecl[]
}

export interface FileDraft {
  path: string
  componentName: string
  rootTree: BuildNode
  moduleTopConsts: PendingConstDecl[]
  componentInternalConsts: PendingConstDecl[]
}

export interface TreeFinalizerResult {
  mainFile: FileDraft
  extractedFiles: PendingExtractedFile[]
}

// ─── 上下文 ───

interface TreeCtx {
  /** pageName（用于路径生成） */
  pageName: string
  /** 当前正在编辑的文件草稿 */
  currentDraft: FileDraft
  /** 累计的抽取文件 */
  extractedFiles: PendingExtractedFile[]
  /** loopId → enrichment constName（来自 state-builder） */
  loopEnrichmentMap: Map<string, { constName: string }>
}

// ─── 工具 ───

function buildExtractedFilePath(pageName: string, componentName: string, purpose: 'module' | 'component'): string {
  const dir = purpose === 'module' ? 'modules' : 'components'
  return `src/pages/${pageName}/${dir}/${componentName}.tsx`
}

function buildRefImportPath(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')
  if (!rel.startsWith('./') && !rel.startsWith('../')) rel = './' + rel
  return rel
}

function toPageComponentName(pageName: string): string {
  const pascal = pageName
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return `${pascal}Page`
}

/** propRoute / useState lift 后常量名生成（小驼峰） */
function makePropRouteName(nodeId: string | undefined, componentName: string, propKey: string): string {
  // 格式：${lowerCamel(componentName)}${Capitalize(propKey)}${nodeId}
  // 例：{ componentName: 'Button', nodeId: 'hdrHelpBtn', propKey: 'icon' } → buttonIconHdrHelpBtn
  // 缺 nodeId 时退化为 ${lowerCamel(componentName)}${Capitalize(propKey)}
  // 缺 componentName 时退化为 ${nodeId}${Capitalize(propKey)}
  const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
  const lowerFirst = (s: string) => s ? s.charAt(0).toLowerCase() + s.slice(1) : ''

  if (componentName && nodeId) {
    return `${lowerFirst(componentName)}${cap(propKey)}${cap(nodeId)}`
  }
  if (componentName) {
    return `${lowerFirst(componentName)}${cap(propKey)}`
  }
  return `${nodeId ?? 'node'}${cap(propKey)}`
}

/**
 * useState 初始值的引用名。
 *
 * 与 jsx-emitter 对绝对 binding 的 emit 规则保持一致（收拢到 accessPath.stateRef）：
 *   - 绝对路径：平面→裸 accessPath（已 destructure）；嵌套→initialState.xxx
 *   - 相对路径→裸 accessPath（模板从 data 解构顶级字段，再属性访问）
 */
function useStateRefName(cv: { pathType: string; accessPath: string }): string {
  if (cv.pathType === 'absolute') return stateRef(cv.accessPath)
  return cv.accessPath
}

// ─── B4: propRoute 消费 ───

function applyPropRoute(node: ComponentNode, ctx: TreeCtx): ComponentNode {
  const pr = node.propRoute
  if (!pr || Object.keys(pr).length === 0) return node

  const newProps: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(node.props)) {
    const route = pr[k]
    if (!route || route === 'inline') {
      newProps[k] = v
      continue
    }
    const name = makePropRouteName(node.id, node.component, k)
    if (route === 'component-internal') {
      // 检测 useState：LiteralValue.useState 或 ComputedValue.useState
      const vObj = v && typeof v === 'object' ? (v as any) : null
      const isLiteralWithUseState = vObj && vObj.type === 'literal' && vObj.useState
      const isComputedWithUseState = vObj && vObj.type === 'computed' && vObj.useState

      if (isComputedWithUseState) {
        // ComputedValue.useState：初始值引用 accessPath
        // 嵌套绝对路径走 initialState.xxx；平面绝对 / 相对路径走裸 accessPath
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: Value.varRef({ name: useStateRefName(vObj) }),
          isUseState: true,
          // 共享：path 命中 eventMutatedPaths（state-builder 打标）→ emit useSharedState
          ...(vObj.shared ? { shared: true, sharedKey: vObj.accessPath } : {}),
        })
      } else if (isLiteralWithUseState) {
        // LiteralValue.useState：值直接作为初始值
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: vObj.value,
          isUseState: true,
        })
      } else {
        ctx.currentDraft.componentInternalConsts.push({
          name,
          value: v,
          isUseState: false,
        })
      }

      // 生成 event handler（LiteralValue / ComputedValue 的 useState 均适用）
      const useStateMarker = isLiteralWithUseState ? (vObj as any).useState : (isComputedWithUseState ? (vObj as any).useState : null)
      if (useStateMarker?.event && typeof useStateMarker.extractor === 'function') {
        const setterName = 'set' + name.charAt(0).toUpperCase() + name.slice(1)
        const handler = useStateMarker.extractor(setterName)
        newProps[useStateMarker.event] = Value.rawExpr({ value: handler })
      }
    } else {
      ctx.currentDraft.moduleTopConsts.push({ name, value: v })
    }
    newProps[k] = Value.varRef({ name })
  }
  return { ...node, props: newProps }
}

// ─── 字面量/Computed 双绑 lift ───

function liftLiteralTwoWayBindings<T extends { props: Record<string, PropValue> }>(node: T, ctx: TreeCtx): T {
  const newProps: Record<string, PropValue> = {}
  let touched = false

  for (const [key, value] of Object.entries(node.props)) {
    if (!value || typeof value !== 'object' || !(value as any).useState) {
      newProps[key] = value
      continue
    }
    const v = value as any
    const isComputed = v.type === 'computed'

    // 只处理 literal 或 computed + useState
    if (v.type !== 'literal' && v.type !== 'computed') {
      newProps[key] = value
      continue
    }

    const name = makePropRouteName(
      (node as any).id,
      (node as any).component ?? 'node',
      key
    )

    // B1d: 共享 + runtimeKeyMap（opt-in，Tabs activeKey 被 setState/cycleState 外部驱动）。
    // store 原始值是 key 字符串（setState/cycleState 写入的），而组件 prop（如 selectedIndex）
    // 需数字索引 → 改产三段 const + 改写 onClick 写回 key（保持 store 恒为 key 字符串）：
    //   const [raw, setRaw] = useSharedState(key);   // 带 setter 的 shared useState
    //   const <keysConst> = [...keys];               // 编译期 TabItem key 数组（mapping 挂 runtimeKeyMap）
    //   const <name> = <keysConst>.indexOf(raw);      // 派生索引
    //   prop = <name>；onClick = (index) => setRaw(<keysConst>[index])
    // 仅 shared && runtimeKeyMap 时生效；非 shared（自驱动）走下方原 useState(initial)+extractor 路径，
    // 故现有页签 等非外部驱动 Tabs 零回归。
    if (
      isComputed &&
      v.shared &&
      Array.isArray(v.useState?.runtimeKeyMap?.keys) &&
      v.useState.runtimeKeyMap.keys.length > 0
    ) {
      const rawName = name + 'Key'
      const keysConst = name + 'Keys'
      const rawSetter = 'set' + rawName.charAt(0).toUpperCase() + rawName.slice(1)
      // const#1：shared useState（带 setter）→ const [raw, setRaw] = useSharedState(key)
      ctx.currentDraft.componentInternalConsts.push({
        name: rawName,
        value: Value.rawExpr({ value: 'null' }),  // 占位：formatConstDecl shared useState 不读 value
        isUseState: true,
        shared: true,
        sharedKey: v.accessPath,
      })
      // const#2：编译期 key 数组 → const keysConst = ["0", ...]
      ctx.currentDraft.componentInternalConsts.push({
        name: keysConst,
        value: v.useState.runtimeKeyMap.keys,
        isUseState: false,
      })
      // const#3：派生索引 → const name = keysConst.indexOf(raw)
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: Value.rawExpr({ value: `${keysConst}.indexOf(${rawName})` }),
        isUseState: false,
      })
      newProps[key] = Value.varRef({ name })
      if (v.useState.event) {
        newProps[v.useState.event] = Value.rawExpr({
          value: `(index) => ${rawSetter}(${keysConst}[index])`,
        })
      }
      touched = true
      continue
    }

    if (isComputed) {
      // ComputedValue.useState：嵌套绝对路径走 initialState.xxx，平面绝对 / 相对走裸 accessPath
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: Value.varRef({ name: useStateRefName(v) }),
        isUseState: true,
        // 共享：path 命中 eventMutatedPaths（state-builder 打标）→ emit useSharedState
        ...(v.shared ? { shared: true, sharedKey: v.accessPath } : {}),
      })
    } else {
      // LiteralValue.useState：值直接作为初始值
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: v.value ?? null,
        isUseState: true,
      })
    }

    if (v.useState.event && typeof v.useState.extractor === 'function') {
      const setterName = 'set' + name.charAt(0).toUpperCase() + name.slice(1)
      const handler = v.useState.extractor(setterName)
      newProps[v.useState.event] = Value.rawExpr({ value: handler })
    }
    newProps[key] = Value.varRef({ name })
    touched = true
  }
  return touched ? { ...node, props: newProps } as T : node
}

// ─── B1b: 共享只读 binding lift（无 useState 的 shared absolute binding/computed） ───
//
// 被事件 Action 改写的 path（eventMutatedPaths）若被某组件只读绑定（非 useState 双绑），
// 必须提升为组件顶部 `const x = useSharedState('key')`（订阅 store 切片）——
// useSharedState 是 hook，不能 inline 在 JSX prop 里（rules-of-hooks）。
// 非共享只读 binding 仍 inline initialState.xxx（快照只读，无运行时写入）。

function liftSharedReadBindings<T extends { props: Record<string, PropValue> }>(node: T, ctx: TreeCtx): T {
  const newProps: Record<string, PropValue> = {}
  let touched = false
  for (const [key, value] of Object.entries(node.props)) {
    const v = value as any
    if (
      v && typeof v === 'object' &&
      v.__node &&
      (v.type === 'binding' || v.type === 'computed') &&
      v.shared === true &&
      v.pathType === 'absolute' &&
      !v.useState
    ) {
      const name = makePropRouteName((node as any).id, (node as any).component ?? 'node', key)
      ctx.currentDraft.componentInternalConsts.push({
        name,
        value: Value.rawExpr({ value: 'null' }),  // 占位：formatConstDecl sharedRead 不读 value
        isUseState: false,
        shared: true,
        sharedKey: v.accessPath,
        sharedRead: true,
      })
      newProps[key] = Value.varRef({ name })
      touched = true
    } else {
      newProps[key] = value
    }
  }
  return touched ? ({ ...node, props: newProps } as T) : node
}

// ─── B1c: condition 判据只读 lift（A2UI Scenario 3） ───
//
// 元素级 condition `{ path, in }` 的判据 path 必须订阅共享 store（响应 action 变化），
// 不能 inline initialState 快照。lift 出 `const [name] = useSharedState(sharedKey)`，
// 写回 condition.varName 供 jsx-emitter 包守卫 `{[...in].includes(varName) && (<Node/>)}`。
// 与 sharedRead binding 同款 const 条目（shared:true / sharedRead:true），
// file-assembler 据此自动注入 useSharedState import + emit 顶部 hook 申明。
// 不产值 prop（condition 不是值绑定），只产守卫变量。
function liftConditionBindings<T extends { id?: string; component?: string; condition?: { path: string; in: string[]; varName?: string } }>(node: T, ctx: TreeCtx): T {
  const cond = node.condition
  if (!cond) return node
  const name = makePropRouteName(node.id, node.component ?? 'node', 'condition')
  const sharedKey = sharedKeyOfPath(cond.path)
  ctx.currentDraft.componentInternalConsts.push({
    name,
    value: Value.rawExpr({ value: 'null' }),  // 占位：formatConstDecl sharedRead 不读 value
    isUseState: false,
    shared: true,
    sharedKey,
    sharedRead: true,
  })
  return { ...node, condition: { ...cond, varName: name } } as T
}

// ─── B2: LoopNode 数据源引用处理 ───
//
// 关键：loop template 也是一个 ExtractNode（purpose: 'component'），其 body 应该
// 在模板自己的 childDraft 中走，而不是在主 draft 中。routeLoopNode 必须：
//   1. 切到 childDraft
//   2. 在 childDraft 中走 body
//   3. 把 template 注册到 extractedFiles（避免在末尾 extracts 循环中重复处理）

function routeLoopNode(loop: LoopNode, parentNodeId: string, ctx: TreeCtx): LoopNode {
  const loopId = parentNodeId + ':' + (loop.template?.componentName ?? '')
  const enrich = ctx.loopEnrichmentMap.get(loopId)
  const dataBinding = loop.data as any
  let dataRefName: string
  // pathType 标记 loop.data 来源：absolute（顶层 state/const，嵌套时外层不该 destructure）
  // vs relative（外层 item 字段，外层需 destructure）。供 collectRelativeFields 区分。
  let dataPathType: 'absolute' | 'relative' = 'absolute'
  if (enrich) {
    // 富集：const 名（如 images_galImageGridEnriched），由文件顶部声明，裸引用即可
    dataRefName = enrich.constName
  } else if (dataBinding.pathType === 'absolute') {
    // 绝对路径：平面→裸（已 destructure）；嵌套→initialState.xxx（收拢到 accessPath.stateRef）
    dataRefName = stateRef(dataBinding.accessPath)
  } else {
    // 相对路径（模板内从 data 解构）→ 裸引用
    dataRefName = dataBinding.accessPath ?? dataBinding.path ?? 'data'
    dataPathType = 'relative'
  }

  // inline loop（如 TabItem）：模板不抽离，body 走当前 draft，不注册 extractedFiles
  if (loop.inline) {
    const newBody = loop.template.body.map(c => walkNode(c, ctx))
    return {
      ...loop,
      data: Value.varRef({ name: dataRefName, pathType: dataPathType }),
      template: {
        ...loop.template,
        body: newBody as RegularNode[],
      },
    }
  }

  // 切到 template 的 childDraft
  const targetPath = buildExtractedFilePath(ctx.pageName, loop.template.componentName, 'component')
  const childDraft: FileDraft = {
    path: targetPath,
    componentName: loop.template.componentName,
    rootTree: null as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }
  const prevDraft = ctx.currentDraft
  ctx.currentDraft = childDraft

  const newBody = loop.template.body.map(c => walkNode(c, ctx))

  ctx.currentDraft = prevDraft

  // 注册到 extractedFiles（标记同名跳过，避免末尾循环重复）
  ctx.extractedFiles.push({
    path: targetPath,
    componentName: loop.template.componentName,
    purpose: 'component',
    body: newBody,
    params: loop.template.refProps,
    moduleTopConsts: childDraft.moduleTopConsts,
    componentInternalConsts: childDraft.componentInternalConsts,
  })

  return {
    ...loop,
    data: Value.varRef({ name: dataRefName, pathType: dataPathType }),
    template: {
      ...loop.template,
      body: newBody as RegularNode[],
    },
  }
}

// ─── B5: slotNode prop 子树处理 ───
//
// slotNode 作 prop 值（如 eview-ui Dropdown overlay={<Menu>...</Menu>}）时，其 node 子树内可能
// 含 LoopNode / ExtractNode。tree-finalizer 的 DFS 默认只走 children，prop 值里的子树不会被
// routeLoopNode 处理 → loop.data 不被替换为 varRef、模板不抽离注册 → emit 时 loop 兜底成 'data'
// 且引用未生成的模板组件。
// 故 walkComponent/walkHtml 在处理完 children 后，对每个 slotNode prop 的 node 再走一次 walkNode，
// 让其内的 LoopNode 经 walkChildren→routeLoopNode 正常路由（data→varRef、模板注册到 extractedFiles）。
//
// 对既有映射无副作用：没有任何既有映射把 slotNode 留进 outputProps（均在 transform 里
// ctx.resolveNode 消费进 children），故此处对既有 e2e 是死代码触发。

function walkSlotNodeProps(
  props: Record<string, PropValue>,
  ctx: TreeCtx,
): Record<string, PropValue> {
  let touched = false
  const newProps: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).type === 'slotNode' && (v as any).node) {
      newProps[k] = { ...(v as any), node: walkNode((v as any).node, ctx) } as PropValue
      touched = true
    } else {
      newProps[k] = v
    }
  }
  return touched ? newProps : props
}

// ─── B6: loop className binding（per-item const 数组 + rawExpr 替换）───
//
// relative className binding 在循环内逐项已知（binding.collectedClassStrings，build-trees
// 收集）。此处：注册文件顶部 const 数组 `[styles.{prefix}Item0, ...]` + 把 className prop
// 替成 rawExpr `{constName}[idx]`（emit 经 emitValue 裸输出，inline map 回调里 idx 在作用域）。
//
// style-converter 在本步之后跑、此时 prop 已是 rawExpr（readPropClassName 返 null、不编 .{nodeId}），
// 故把 { prefix, collected } 经节点侧信道 __loopClassNameInfo 传出，供 collectRulesFromNode
// 逐项编 .{prefix}Item{i} 规则。
//
// 对既有映射零副作用：仅当 props.className 是带 collectedClassStrings 的 binding 才触发
// （只有 build-trees 的 loop className binding 路径会设此字段）。

interface LoopClassNameInfo {
  prefix: string
  collected: string[]
}

/**
 * 组装 className rawExpr 值。ref 是 styles 引用表达式（Phase 2 `${constName}[idx]` /
 * Option 1 `${constName}[accessor]`）。若 binding 带 `__staticClassName`（映射层追加的
 * 原始 DOM 类前缀，如 eview-ui Tag variant:filled 的 'filled'——非 tailwind、不经
 * style-converter 编译，靠共享 CSS `.eui_tag.filled.eui_tag_info` 生效），包成模板字面量
 * `` `<static> ${ref}` ``，让 static 作原始 DOM 类、ref 作 per-item styles 类同时上 DOM；
 * 无 static 则裸 ref。
 */
function composeClassNameExpr(staticCls: string | undefined, ref: string): string {
  if (!staticCls) return ref
  return '`' + staticCls + ' ${' + ref + '}`'
}

function processClassNameBindings(
  props: Record<string, PropValue>,
  ctx: TreeCtx,
): { props: Record<string, PropValue>; classNameInfo?: LoopClassNameInfo } {
  const v = props.className
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    (v as any).type !== 'binding' ||
    !(v as any).collectedClassStrings
  ) {
    return { props }
  }
  const binding = v as any
  // 多级 loopStack（__flatCollected）：collected 跨行扁平化、idx 不对齐 → Phase 2 [idx] 数组方案
  // 不适用。跳过，保持裸 binding；由 B7 substituteRenderFnClassName 的 value-map（按串查表）
  // 处理（render fn body 内嵌套循环 cell）。主树多级嵌套场景同理跳过（无 e2e，保持裸 binding）。
  if (binding.__flatCollected) return { props }
  const prefix = loopClassNamePrefix(binding.path, binding.nodeId)
  const constName = loopClassNameConstName(binding.path, binding.nodeId)
  const items: string[] = binding.collectedClassStrings

  // const 数组值：每项静态 styles.{prefix}Item{i} 访问（CSS Modules 可静态分析）；
  // 非串/空项产 '' 占位保 idx 对齐。走 rawExpr 通路，file-assembler 的
  // serializeForConstValue rawExpr 分支裸输出字面量。
  const arrLiteral =
    '[' +
    items
      .map((s, i) => (s && s.trim() ? cssModuleRef('styles', `${prefix}Item${i}`) : "''"))
      .join(', ') +
    ']'
  ctx.currentDraft.moduleTopConsts.push({
    name: constName,
    value: Value.rawExpr({ value: arrLiteral }),
  })

  return {
    props: {
      ...props,
      className: Value.rawExpr({ value: composeClassNameExpr(binding.__staticClassName, `${constName}[idx]`) }),
    },
    classNameInfo: { prefix, collected: items },
  }
}

// ─── B7: render fn body 内 cell 自身 className=row-relative binding（value-map 机制）───
//
// Phase 3 Option 1。Table 列 render fn 的 body cell
// 自身 className 若是 row-relative binding（{path:'rowCls'}，相对当前行），build-trees 的
// #collectRelativeClassNameFromLoop 已在 loopStack 在场时逐行收集了 collectedClassStrings
// （与 main-tree 循环同口）。但 render fn body 里**没有 idx 变量**（map 回调签名是
// (cellValue, rowData, options, row)），故不能复用 Phase 2 的 `${constName}[idx]` 数组方案。
//
// 本 pass 改用「串→styles.{prefix}Item{i}」值映射：
//   const {prefix}ClassMap = { '串0': styles.{prefix}Item0, '串1': styles.{prefix}Item1, ... }
//   className = { {prefix}ClassMap[row.rawData.{field}] }
// 其中 accessor 用 base 形式 accessPathToJsExpr(accessPath, dataAccessor)（如 row.rawData.foo），
// 与 jsx-emitter bindingRef 的 base 访问一致——不依赖 destructure（className 替成 rawExpr 后
// 不被 collectRelativeFields 收集，foo 不进 destructure 行；即使 foo 被同 cell 其它 binding
// 收集而 destructure，base 形式 row.rawData.foo 仍合法，仅冗余、无冲突）。
//
// 侧信道 __loopClassNameInfo = { prefix, collected: unique } 复用 Phase 2 的同读口：
// style-converter 的 collectRulesFromNode 逐项 toRule(collected[i], '.{prefix}Item{i}')，
// unique 已去空去重，每条串一条规则。FileGenerator 对 moduleTopConsts 值调 collectRulesFromValue
// → renderFn → body → cell → collectRulesFromNode 读到 stash，故 style-converter 零改动。
//
// 挂载时机：walkNode 主树 + extracts 走完后（moduleTopConsts 已就绪），return 前。
// 作用域边界：cell-DIRECT className（cell 自身 + 其静态子树）+ 嵌套 LoopNode template body
// cell（case b，render-fn-internal nested loop，多级 collection）—— Phase 3 Option 2：遇嵌套
// LoopNode 下钻 template body，dataAccessor 重置为该层 loopVar，内层 cell 的 item-relative
// className binding 同走 value-map（accessor=item.field，跨行去重无 idx 对齐问题）。

/** 一个文件草稿里需要走 render-fn className 下钻的 const 集合（两种 draft 共形态）。 */
type ConstDraftLike = { moduleTopConsts?: PendingConstDecl[]; componentInternalConsts?: PendingConstDecl[] }

/**
 * 算 render fn 的 dataAccessor，与 file-assembler serializeForConstValue 的 renderFn 分支
 * （file-assembler.ts:682-686）完全一致：取首个带 dataSource 的 param，
 * dataAccessor = dataField ? `${name}.${dataField}` : name（如 Table 的 row.rawData）。
 * 无 dataSource param → 返 ''（body 内无 row-relative 作用域，本 pass 不介入）。
 */
function renderFnDataAccessor(params: any[]): string {
  const dataSourceParam = params.find((p: any) => p.dataSource)
  const dataSourceName: string = dataSourceParam?.name ?? ''
  const dataField: string | undefined = dataSourceParam?.dataField
  return dataField ? `${dataSourceName}.${dataField}` : dataSourceName
}

/**
 * 对一个命中条件（className = 带 collectedClassStrings 的 binding）的 render fn body 节点：
 * 注册 ClassMap const + 替 className 为 rawExpr（查表）+ 侧信道 stash。
 */
function substituteRenderFnClassName(node: any, binding: any, dataAccessor: string, draft: ConstDraftLike): void {
  const prefix = loopClassNamePrefix(binding.path, binding.nodeId)
  const constName = loopClassNameMapName(binding.path, binding.nodeId)
  // 去重非空串：value-map 的 key 是串本身，重复串共用一条 .{prefix}Item{i} 规则
  const unique = [...new Set((binding.collectedClassStrings as string[]).filter((s: string) => s && s.trim()))]
  if (unique.length === 0) return  // 无可编译串 → 不替换（保持 binding，emit 走 bindingRef 运行时值兜底）
  // 值映射 const：{ '串0': styles.{prefix}Item0, ... }，i 与 style-converter 的 .{prefix}Item{i} 一一对应
  const mapLiteral =
    '{ ' + unique.map((s, i) => `${JSON.stringify(s)}: ${cssModuleRef('styles', `${prefix}Item${i}`)}`).join(', ') + ' }'
  const consts = draft.moduleTopConsts
  if (consts) consts.push({ name: constName, value: Value.rawExpr({ value: mapLiteral }) })
  // 替换 className prop → rawExpr（值映射查表）；accessor 用 base 形式，不依赖 destructure
  const accessor = accessPathToJsExpr(binding.accessPath, dataAccessor)
  node.props.className = Value.rawExpr({
    value: composeClassNameExpr(binding.__staticClassName, `${constName}[${accessor}]`),
  })
  // 侧信道供 style-converter 按 unique 串编 .{prefix}Item{i} 规则（与 Phase 2 同读口）
  node.__loopClassNameInfo = { prefix, collected: unique }
}

/**
 * 递归一个 render fn body 节点（cell 及其静态子树），命中 className binding 即替换。
 *
 * dataAccessor 语义随递归层级切换：
 *   - render fn body root（入口层）：dataAccessor = renderFnDataAccessor(params)（如 row.rawData），
 *     cell 自身 className 是 row-relative binding → value-map 查表 `ClassMap[row.rawData.field]`
 *     （Option 1）。render fn map 回调签名 (cellValue,rowData,options,row) 无 idx。
 *   - 嵌套 LoopNode template body（下钻层）：dataAccessor 重置为该层 loopVar（`loop.loopVar ?? 'item'`，
 *     与 jsx-emitter emitLoop 同源），cell 自身 className 是 item-relative binding → value-map 查表
 *     `ClassMap[item.field]`（Option 2，case b）。内层循环 map 回调 (item, idx) 有 idx 但 idx 是
 *     per-row 的，跟 build-trees 跨行收集的 collectedClassStrings 不对齐（row1.tags[0]=red 用 Classes[0]
 *     对，row2.tags[0]=green 用 Classes[0]=red 错），故不能用 Phase 2 的 [idx] 数组方案，仍用 value-map
 *     按串查表（跨行去重 unique 串共一条规则，accessor=item.field 运行时查）。
 */
function processRenderFnBodyNode(node: any, dataAccessor: string, draft: ConstDraftLike): void {
  if (!node || typeof node !== 'object') return
  if (node.kind === 'component' || node.kind === 'html') {
    const v = node.props?.className
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).type === 'binding' && (v as any).collectedClassStrings) {
      substituteRenderFnClassName(node, v as any, dataAccessor, draft)
    }
    // 递归子节点：静态子树里的 className binding 与 cell 同作用域（同一 dataAccessor）
    const ch = node.children
    if (Array.isArray(ch)) {
      for (const c of ch) processRenderFnBodyNode(c, dataAccessor, draft)
    } else if (ch && ch.kind === 'loop') {
      // 嵌套循环（case b，Phase 3 Option 2）：下钻 template body，dataAccessor 重置为该层 loopVar
      // （与 jsx-emitter emitLoop 的 `loop.loopVar ?? 'item'` 一致）。内层循环 cell 的 className binding
      // 是 item-relative → value-map 查表 `ClassMap[item.field]`，accessor base=item（块作用域遮蔽外层）。
      // 多级嵌套亦成立：每下钻一层重置 dataAccessor=该层 loopVar，最内层 cell 用最内层 item。
      const innerBase = (ch as any).loopVar ?? 'item'
      for (const b of (ch as any).template?.body ?? []) processRenderFnBodyNode(b, innerBase, draft)
    }
    // slotNode prop 内的静态子树（如 cell 内 Dropdown overlay）也下钻（同 dataAccessor）
    if (node.props) {
      for (const pv of Object.values(node.props)) {
        if (pv && typeof pv === 'object' && !Array.isArray(pv) && (pv as any).type === 'slotNode' && (pv as any).node) {
          processRenderFnBodyNode((pv as any).node, dataAccessor, draft)
        }
      }
    }
  } else if (node.kind === 'extract') {
    for (const c of node.body ?? []) processRenderFnBodyNode(c, dataAccessor, draft)
  }
}

/**
 * 递归一个 const 值，找其中的 RenderFnValue（如 Table columns 的 col.render），进入其 body
 * 做 className binding 替换。跳过 type-tagged 非 renderFn 值类与 BuildNode（非 render fn 作用域）。
 */
function walkConstValueForRenderFnClassName(value: any, draft: ConstDraftLike): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) walkConstValueForRenderFnClassName(v, draft)
    return
  }
  // type-tagged PropValue
  if (typeof value.type === 'string') {
    if (value.type === 'renderFn') {
      const dataAccessor = renderFnDataAccessor(value.params ?? [])
      if (!dataAccessor) return  // 无 dataSource param → body 内无 row-relative 作用域
      const bodies = Array.isArray(value.body) ? value.body : [value.body]
      for (const b of bodies) processRenderFnBodyNode(b, dataAccessor, draft)
    }
    // slotNode/literal/varRef/rawExpr/binding/computed：不携带嵌套 render fn（render fn 仅在
    //  纯对象属性如 col.render 出现），slotNode.node 是静态子树非 render fn 作用域，均跳过
    return
  }
  // BuildNode（kind 标记）→ 非 render fn body 作用域，跳过
  if (value.kind) return
  // 纯对象（无 type/kind，如 tableColumns 列对象 {key,title,render,...}）→ 递归值找嵌套 renderFn
  for (const v of Object.values(value)) walkConstValueForRenderFnClassName(v, draft)
}

/**
 * 对一个文件草稿的 moduleTopConsts + componentInternalConsts 跑 render-fn className 替换。
 * 快照遍历：新注册的 ClassMap const（rawExpr map 字面量、无 render fn body）不重走。
 */
function processRenderFnClassNameInDraft(draft: ConstDraftLike): void {
  const top = draft.moduleTopConsts ? [...draft.moduleTopConsts] : []
  const internal = draft.componentInternalConsts ? [...draft.componentInternalConsts] : []
  for (const decl of top) walkConstValueForRenderFnClassName(decl.value, draft)
  for (const decl of internal) walkConstValueForRenderFnClassName(decl.value, draft)
}

// ─── DFS 主循环 ───

function walkNode(node: BuildNode, ctx: TreeCtx): BuildNode {
  if (!node) return node as any

  switch (node.kind) {
    case 'component':
      return walkComponent(node as ComponentNode, ctx)
    case 'html':
      return walkHtml(node as HtmlNode, ctx)
    case 'text':
      return node  // TextNode 无需要处理
    case 'extract':
      return walkExtract(node as ExtractNode, ctx)
    default:
      return node
  }
}

function walkComponent(node: ComponentNode, ctx: TreeCtx): ComponentNode {
  const routed = applyPropRoute(node, ctx)
  const lifted = liftLiteralTwoWayBindings(routed, ctx)
  const shared = liftSharedReadBindings(lifted, ctx)
  // condition 判据只读 lift：产 useSharedState hook + 写回 condition.varName
  const condLifted = liftConditionBindings(shared, ctx)
  const newChildren = walkChildren(condLifted.children, ctx, condLifted.id ?? '')
  // slotNode prop 子树内的 LoopNode/ExtractNode 也需经 routeLoopNode/walkExtract 路由
  const slotProps = walkSlotNodeProps(condLifted.props, ctx)
  // loop className binding：注册 const 数组 + 替 prop 为 rawExpr（侧信道传 style-converter）
  const { props: cnProps, classNameInfo } = processClassNameBindings(slotProps, ctx)
  const result: any = { ...condLifted, props: cnProps, children: newChildren as any }
  if (classNameInfo) result.__loopClassNameInfo = classNameInfo
  return result
}

function walkHtml(node: HtmlNode, ctx: TreeCtx): HtmlNode {
  const lifted = liftLiteralTwoWayBindings(node, ctx)
  const shared = liftSharedReadBindings(lifted, ctx)
  // condition 判据只读 lift：产 useSharedState hook + 写回 condition.varName
  const condLifted = liftConditionBindings(shared, ctx)
  const newChildren = walkChildren(condLifted.children, ctx, node.id ?? '')
  const slotProps = walkSlotNodeProps(condLifted.props, ctx)
  const { props: cnProps, classNameInfo } = processClassNameBindings(slotProps, ctx)
  const result: any = { ...condLifted, props: cnProps, children: newChildren as any }
  if (classNameInfo) result.__loopClassNameInfo = classNameInfo
  return result
}

function walkExtract(node: ExtractNode, ctx: TreeCtx): ComponentNode {
  // B3: ExtractNode → 记录到 extractedFiles；引用端替换为占位 ComponentNode
  const targetPath = buildExtractedFilePath(ctx.pageName, node.componentName, node.purpose)
  const refImport = buildRefImportPath(ctx.currentDraft.path, targetPath)

  // 切到子草稿
  const childDraft: FileDraft = {
    path: targetPath,
    componentName: node.componentName,
    rootTree: null as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }
  const prevDraft = ctx.currentDraft
  ctx.currentDraft = childDraft

  const newBody = node.body.map(c => walkNode(c, ctx))

  ctx.currentDraft = prevDraft

  ctx.extractedFiles.push({
    path: targetPath,
    componentName: node.componentName,
    purpose: node.purpose,
    body: newBody,
    params: node.refProps,
    moduleTopConsts: childDraft.moduleTopConsts,
    componentInternalConsts: childDraft.componentInternalConsts,
  })

  const placeholder: any = {
    __node: true,
    kind: 'component',
    component: node.componentName,
    tag: node.componentName,
    import: refImport,
    props: node.refProps ?? {},
    children: null,
    __extractRef: true,
  }
  if ((node as any).id !== undefined) placeholder.id = (node as any).id

  return placeholder
}

function walkChildren(
  children: RegularNode[] | LoopNode | null | undefined,
  ctx: TreeCtx,
  parentNodeId: string = ''
): RegularNode[] | LoopNode | null {
  if (!children) return null
  if ((children as any).kind === 'loop') {
    return routeLoopNode(children as LoopNode, parentNodeId, ctx)
  }
  return (children as RegularNode[]).map(c => walkNode(c, ctx)) as RegularNode[]
}

// ─── 主入口 ───

interface ExtractSpec {
  body: BuildNode[]
  purpose: 'module' | 'component'
  componentName: string
  props?: Record<string, PropValue>
  id?: string
}

export function finalizeTree(
  mappedPage: { pageName: string; rootTree: BuildNode; extracts?: ExtractSpec[] },
  stateResult: StateBuilderResult
): TreeFinalizerResult {
  const mainDraft: FileDraft = {
    path: `src/pages/${mappedPage.pageName}/index.tsx`,
    componentName: toPageComponentName(mappedPage.pageName),
    rootTree: {} as any,
    moduleTopConsts: [],
    componentInternalConsts: [],
  }

  const ctx: TreeCtx = {
    pageName: mappedPage.pageName,
    currentDraft: mainDraft,
    extractedFiles: [],
    loopEnrichmentMap: stateResult.loopEnrichmentMap,
  }

  // 主树走 DFS
  mainDraft.rootTree = walkNode(mappedPage.rootTree, ctx)

  // MappedPage.extracts — 已在 rootTree 中以 ExtractNode 形式被处理的同名文件不再重复
  for (const ext of mappedPage.extracts ?? []) {
    if (ctx.extractedFiles.some(e => e.componentName === ext.componentName)) continue
    // 跳过被映射文件吞噬的循环模板（purpose='component' 但树中未出现，如 Table 自行消化了 LoopNode）
    if (ext.purpose === 'component') continue
    const targetPath = buildExtractedFilePath(mappedPage.pageName, ext.componentName, ext.purpose)
    ctx.extractedFiles.push({
      path: targetPath,
      componentName: ext.componentName,
      purpose: (ext as any).purpose ?? 'module',
      body: ext.body.map(c => walkNode(c, ctx)) as BuildNode[],
      params: ext.props,
    })
  }

  // B7：render fn body 内 cell 自身 className=row-relative binding（value-map 机制）。
  // 须在 walkNode（主树 + extracts，moduleTopConsts/componentInternalConsts 已就绪）之后跑：
  // 下钻各 draft 的 const 值里的 RenderFnValue body，注册 ClassMap const + 替 className 为
  // rawExpr（查表）+ 侧信道 __loopClassNameInfo（供 style-converter 编 per-串规则）。
  processRenderFnClassNameInDraft(mainDraft)
  for (const ef of ctx.extractedFiles) processRenderFnClassNameInDraft(ef)

  return {
    mainFile: mainDraft,
    extractedFiles: ctx.extractedFiles,
  }
}
