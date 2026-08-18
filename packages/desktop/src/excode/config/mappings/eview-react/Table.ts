/**
 * Table → Table 映射（新架构）
 *
 * A2UI Table → eview-react Table 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | dataSource（DataBinding） | dataset | **enrichScopedData** → ComputedValue（含 cells 内 relative CV 的编译期 enrichment） |
 * | columns（字面量数组） | columns | 每列从 cells 生成 `render` fn + A2UI 列定义（title/width/align/sort...）→ 字面量数组，propRoute module-top |
 * | columns（DataBinding） | columns | **ComputedValue**（containsJSX:true）逐项 zip：state 列元数据 + 编译期 render fn，产物形态同字面量 |
 * | colDef.sort | col.allowSort | sort===true→true；否则显性 false（避免 eview-react 默认开排序） |
 * | rowKey | rowKey | 透传 |
 * | pagination: true/false | enablePagination + recordCount | false→enablePagination:false；其他（含缺省）→true + recordCount=dataset.length |
 * | rowSelection.type: checkbox | checkType: multi + enableCheckBox: true | 值映射 |
 * | rowSelection.type: radio | checkType: single + enableCheckBox: true | 值映射 |
 * | rowSelection.selectedRowKeys（字面量数组） | checkedRows | **LiteralValue.useState** + onRowCheck |
 * | rowSelection.selectedRowKeys（DataBinding） | checkedRows | **ComputedValue.useState** + onRowCheck（值进 state.js，useState 引用 initialState） |
 * | expandable.expandedRowKeys | expandedRowKeys | 双形态 useState（同 selectedRowKeys → checkedRows 结构）；onRowExpendClick 签名 (row) 无新值，extractor 占位 (row) => {} 暂不调 setter |
| expandable（存在） | enableRowExpand: true + enableMulitiExpand: true | 存在即启用行展开 + 多行展开 |
| TableRow.expandedRowRender（slot） | onRowExpend | buildRenderFn（与 column render 同构，row.rawData 上下文），propRoute 提升 module-top |
 * | className | className | 透传 |
 * | rowClassName | — | eview-react 无直接对应，暂不处理 |
 * | size | — | eview-react Table 不支持 size 属性，丢弃（schema 已新增，但不透传） |
 *
 * ## 特殊逻辑
 *
 * - Table.children 总是 TemplateChildren（LoopNode），不存在静态 children
 * - LoopNode.data → enrichScopedData（收集 cells 中的 relative ComputedValue，对数据源整体 enrichment）
 * - cells resolve 后清除 loopScope（断循环引用，render fn body emit 不再需要 scope 链）
 * - columns 双形态：字面量→字面量数组（propRoute module-top）；DataBinding→ComputedValue 逐项 zip render fn（inline，不走 propRoute）
 * - enablePagination=true 时传 recordCount（dataset 长度，运行时表达式，引用名按 dataset 是否 containsJSX 选 computedJsxConstName / stateRef）
 * - selectedRowKeys 双形态分叉：字面量 → Value.literal.useState，DataBinding → Value.computed.useState
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { LoopNode, RegularNode } from '../../../src/core/node-types'
import type { PropValue, BindingValue } from '../../../src/core/value-types'
import { Value } from '../../../src/core/value-factory'
import { enrichScopedData, buildRenderFn } from '../../../src/core/scoped-enrichment'
import { stateRef, computedJsxConstName } from '../../../src/core/access-path'

/** A2UI 列定义（字面量形态） */
interface A2UIColDef {
  title: string
  dataIndex?: string
  align?: 'left' | 'right' | 'center'
  width?: string | number
  minWidth?: string | number
  fixed?: boolean | 'start' | 'end'
  sort?: boolean
  className?: string
  filters?: Array<{ text: string; value: string | number }>
}

export function createTableMapping(pkg: string): MappingDef {
  return {
    tag: 'Table',
    import: `${pkg}/Table`,

    transform(node: any, ctx: TransformContext) {
      // ─── children 处理：取出 LoopNode 和 cells ───
      const children = node.children
      if (!children || children.kind !== 'loop') return null
      const loop = children as LoopNode
      const dataBinding = loop.data as BindingValue

      const templateBody = loop.template?.body ?? []
      const tableRow = templateBody[0]
      if (!tableRow || tableRow.kind !== 'component') return null
      const cells = (tableRow.children ?? []) as RegularNode[]
      if (cells.length === 0) return null

      // A2UI 字面量列定义（取 title/width/align 等；DataBinding 形态不在此处理）
      const a2uiCols: A2UIColDef[] = Array.isArray(node.props.columns)
        ? node.props.columns
        : []

      // ─── resolve cells ───
      const resolvedCells = cells.map(cell => ctx.resolveNode(cell as any))

      // 清除 loopScope（断循环引用）
      for (const cell of resolvedCells) {
        if (cell && typeof cell === 'object') {
          const clean = (n: any) => {
            if (!n || typeof n !== 'object') return
            delete n.loopScope
            if (Array.isArray(n.children)) n.children.forEach(clean)
            if (n.kind === 'loop') { clean(n.template); n.template?.body?.forEach(clean) }
          }
          delete (cell as any).loopScope
          if (Array.isArray((cell as any).children)) (cell as any).children.forEach(clean)
        }
      }

      // ─── 行展开：TableRow.expandedRowRender (slot) → onRowExpend render fn ───
      // A2UI TableRow.props.expandedRowRender = { componentId } → SlotNodeValue({ node })
      // build-trees 已把 { componentId } 转成 SlotNodeValue，node 即展开内容子树（如嵌套子表）
      // eview-react onRowExpend: (row) => ReactNode（展开内容渲染函数，非事件回调）
      // 与 column render 同构：row.rawData = 当前 item，子表 dataSource（相对路径如 subList）在 row.rawData 上下文解析
      const expandedRowRender = (tableRow as any).props?.expandedRowRender
      let expandedContent: RegularNode | null = null
      if (expandedRowRender && typeof expandedRowRender === 'object' && expandedRowRender.type === 'slotNode') {
        const subNode = expandedRowRender.node as RegularNode
        if (subNode) {
          expandedContent = ctx.resolveNode(subNode) as RegularNode
          // 清除 loopScope（断循环引用，与 cells 一致）
          const cleanExp = (n: any) => {
            if (!n || typeof n !== 'object') return
            delete n.loopScope
            if (Array.isArray(n.children)) n.children.forEach(cleanExp)
            if (n.kind === 'loop') { cleanExp(n.template); n.template?.body?.forEach(cleanExp) }
          }
          cleanExp(expandedContent)
        }
      }

      // ─── dataset = dataSource enrichment ───
      // dataSource 一定是 DataBinding（A2UI 强制），转为 ComputedValue 做整体 enrichment
      const dsBinding = (node.props.dataSource as BindingValue) ?? dataBinding
      const dataset = enrichScopedData(dsBinding, resolvedCells as any)

      // ─── columns ───
      // render fn 从 cells 编译期构造（字面量 / binding 共用），每列一个，按位置对应 cell
      const renderFns = resolvedCells.map((cell) =>
        buildRenderFn(cell as any, [
          { name: 'cellValue' },
          { name: 'rowData' },
          { name: 'options' },
          { name: 'row', dataSource: dataBinding, dataField: 'rawData' },
        ]),
      )

      // 单列构造：A2UI 列定义 + 对应 cell 的 render fn → eview-react ColumnProps
      const buildCol = (colDef: any, i: number): Record<string, any> => {
        const cd = colDef || {}
        const cell = resolvedCells[i] as any
        const col: Record<string, any> = {
          key: cd.dataIndex ?? cell?.id ?? `col_${i}`,
          title: typeof cd.title === 'string' ? cd.title : (cell?.id ?? `col_${i}`),
          render: renderFns[i],
          // allowSort：cd.sort===true 才允许排序，其余一律显性 false（避免 eview-react 默认开启排序）
          allowSort: cd.sort === true,
        }
        if (cd.align) col.align = cd.align
        if (cd.width !== undefined) col.width = cd.width
        if (cd.minWidth !== undefined) col.width = cd.minWidth
        if (cd.className) col.className = cd.className
        if (cd.fixed === 'start') col.freezeCol = true
        // filters 透传（A2UI 与 eview-react 结构一致：[{ text, value }]）
        if (cd.filters) col.filters = cd.filters
        return col
      }

      // columns 双形态：字面量数组 / DataBinding（ComputedValue 逐项 zip render fn）
      //   - 字面量：a2uiCols + cells 构造 → 字面量数组（propRoute module-top 提升）
      //   - DataBinding：ComputedValue（containsJSX:true，render fn 含 BuildNode），transform 读
      //     state 的列元数据数组，逐项与编译期 render fn 拼成 ColumnProps。产物形态与字面量一致。
      const columnsProp = node.props.columns
      let columnsValue: PropValue
      let columnsIsLiteral: boolean
      if (columnsProp && typeof columnsProp === 'object' && (columnsProp as any).type === 'binding') {
        const cb = columnsProp as BindingValue
        columnsValue = Value.computed({
          path: cb.path,
          pathType: cb.pathType ?? 'absolute',
          accessPath: cb.accessPath ?? 'columns',
          containsJSX: true,
          transform: (rawCols: any) => {
            const cols = Array.isArray(rawCols) ? rawCols : []
            return cols.map((cd: any, i: number) => buildCol(cd, i))
          },
        })
        columnsIsLiteral = false
      } else {
        columnsValue = a2uiCols.map((cd, i) => buildCol(cd, i)) as any
        columnsIsLiteral = true
      }

      // ─── 构造输出 props ───
      const outputProps: Record<string, PropValue> = {
        dataset,
        columns: columnsValue,
      }

      // rowKey：字面量，透传
      if (node.props.rowKey) outputProps.rowKey = node.props.rowKey

      // pagination → enablePagination（字面量 boolean，值映射）
      outputProps.enablePagination = node.props.pagination !== false
      // enablePagination=true → 传 recordCount（dataSource/dataset 数组长度，运行时表达式）
      //   引用名按 dataset 形态：containsJSX→jsxLiteralConst 名（computedJsxConstName）；
      //   否则→state.js 引用（stateRef，平面已 destructure / 嵌套 initialState.xxx）
      if (outputProps.enablePagination) {
        const datasetRef = (dataset as any).containsJSX
          ? computedJsxConstName(dataset as any)
          : stateRef((dsBinding as BindingValue).accessPath)
        outputProps.recordCount = Value.rawExpr({ value: `${datasetRef}.length` })
      }

      // rowSelection → checkType + enableCheckBox + checkedRows（受控组件）
      if (node.props.rowSelection) {
        const rs = node.props.rowSelection

        // checkType（字面量 string，值映射）
        outputProps.checkType = rs.type === 'radio' ? 'single' : 'multi'
        outputProps.enableCheckBox = true

        // selectedRowKeys → checkedRows（双形态：字面量 / DataBinding，均触发 useState）
        if (rs.selectedRowKeys !== undefined) {
          const sk = rs.selectedRowKeys

          if (sk && typeof sk === 'object' && (sk as any).type === 'binding') {
            // DataBinding → ComputedValue + useState（值进 state.js）
            outputProps.checkedRows = Value.computed({
              path: (sk as any).path,
              pathType: (sk as any).pathType ?? 'absolute',
              accessPath: (sk as any).accessPath ?? 'checkedRows',
              containsJSX: false,
              useState: {
                event: 'onRowCheck',
                extractor: (setter) => `(_, checkedRows) => ${setter}(checkedRows)`,
              },
              transform: (rawValue: any) => Array.isArray(rawValue) ? rawValue : [],
            })
          } else if (Array.isArray(sk)) {
            // 字面量 → LiteralValue + useState（初始值硬编码）
            outputProps.checkedRows = Value.literal({
              value: sk,
              useState: {
                event: 'onRowCheck',
                extractor: (setter) => `(_, checkedRows) => ${setter}(checkedRows)`,
              },
            })
          }
        }
      }

      // expandable → 行展开（enableRowExpand + enableMulitiExpand + expandedRowKeys useState）
      if (node.props.expandable) {
        // 启用行展开 + 允许多行展开
        outputProps.enableRowExpand = true
        outputProps.enableMulitiExpand = true
        // expandedRowKeys → expandedRowKeys（双形态：字面量 / DataBinding，均触发 useState）
        // 逻辑同 selectedRowKeys → checkedRows（双形态 useState 结构）
        // 但 onRowExpendClick 签名 (row) 只一参、无新值可取，extractor 暂占位 (row) => {}（不调 setter）
        // eview-react expandedRowKeys 接受行索引数组
        const ek = (node.props.expandable as any).expandedRowKeys
        if (ek !== undefined) {
          if (ek && typeof ek === 'object' && (ek as any).type === 'binding') {
            // DataBinding → ComputedValue + useState（值进 state.js）
            outputProps.expandedRowKeys = Value.computed({
              path: (ek as any).path,
              pathType: (ek as any).pathType ?? 'absolute',
              accessPath: (ek as any).accessPath ?? 'expandedRowKeys',
              containsJSX: false,
              useState: {
                event: 'onRowExpendClick',
                extractor: () => '(row) => {}',
              },
              transform: (rawValue: any) => Array.isArray(rawValue) ? rawValue : [],
            })
          } else if (Array.isArray(ek)) {
            // 字面量 → LiteralValue + useState（初始值硬编码）
            outputProps.expandedRowKeys = Value.literal({
              value: ek,
              useState: {
                event: 'onRowExpendClick',
                extractor: () => '(row) => {}',
              },
            })
          }
        }
      }
      // onRowExpend：由 TableRow.expandedRowRender（slot 子表）构造 render fn（与 column render 同构）
      if (expandedContent) {
        outputProps.onRowExpend = buildRenderFn(expandedContent, [
          { name: 'row', dataSource: dataBinding, dataField: 'rawData' },
        ])
      }

      // className（字面量 string，透传）
      if (node.props.className) outputProps.className = node.props.className

      // 不做剩余兜底透传：A2UI Table 的 props
      // (rowKey/columns/dataSource/pagination/rowSelection/expandable/rowClassName/className)
      // 已逐项显性处理（id 由管线别处处理，不进 outputProps）。

      // ─── propRoute ───
      // columns：字面量数组 → module-top 提升；DataBinding → ComputedValue（inline stateRef，不走 propRoute）
      // checkedRows：受控 useState → component-internal
      const propRoute: Record<string, any> = {}
      if (columnsIsLiteral) propRoute.columns = 'module-top'
      // dataset：ComputedValue（enrichScopedData，path 绑定）→ 不走 propRoute（inline stateRef）
      // onRowExpend：RenderFnValue（含子表 BuildNode，非 path 绑定）→ module-top 提升（仅有 expandedRowRender 时）
      if (expandedContent) propRoute.onRowExpend = 'module-top'
      if (node.props.rowSelection?.selectedRowKeys !== undefined) {
        propRoute.checkedRows = 'component-internal'
      }
      if ((node.props.expandable as any)?.expandedRowKeys !== undefined) {
        propRoute.expandedRowKeys = 'component-internal'
      }

      return {
        props: outputProps,
        propRoute,
        children: null,
      }
    },
  }
}
