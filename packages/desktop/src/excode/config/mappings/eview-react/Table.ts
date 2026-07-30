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
 * | columns（字面量数组） | columns | 每列从 cells 生成 `render` fn，title/width/align 从 A2UI 列定义透传 |
 * | columns（DataBinding） | columns | 透传 BindingValue（仅改名，不改值） |
 * | rowKey | rowKey | 透传 |
 * | pagination: true/false | enablePagination | false→false，其他（含缺省）→true |
 * | rowSelection.type: checkbox | checkType: multi + enableCheckBox: true | 值映射 |
 * | rowSelection.type: radio | checkType: single + enableCheckBox: true | 值映射 |
 * | rowSelection.selectedRowKeys（字面量数组） | checkedRows | **LiteralValue.useState** + onRowCheck |
 * | rowSelection.selectedRowKeys（DataBinding） | checkedRows | **ComputedValue.useState** + onRowCheck（值进 state.js，useState 引用 initialState） |
 * | expandable | enableRowExpand: true | 存在即启用 |
 * | className | className | 透传 |
 * | rowClassName | — | eview-react 无直接对应，暂不处理 |
 *
 * ## 特殊逻辑
 *
 * - Table.children 总是 TemplateChildren（LoopNode），不存在静态 children
 * - LoopNode.data → enrichScopedData（收集 cells 中的 relative ComputedValue，对数据源整体 enrichment）
 * - cells resolve 后清除 loopScope（断循环引用，render fn body emit 不再需要 scope 链）
 * - columns 由字面量构造 → propRoute 提升到 module-top
 * - selectedRowKeys 双形态分叉：字面量 → Value.literal.useState，DataBinding → Value.computed.useState
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { LoopNode, RegularNode } from '../../../src/core/nodeTypes'
import type { PropValue, BindingValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'
import { enrichScopedData, buildRenderFn } from '../../../src/core/scopedEnrichment'

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

      // ─── dataset = dataSource enrichment ───
      // dataSource 一定是 DataBinding（A2UI 强制），转为 ComputedValue 做整体 enrichment
      const dsBinding = (node.props.dataSource as BindingValue) ?? dataBinding
      const dataset = enrichScopedData(dsBinding, resolvedCells as any)

      // ─── columns ───
      // 字面量分支：从 resolved cells + A2UI 列定义构造
      const columns: any[] = []
      for (let i = 0; i < resolvedCells.length; i++) {
        const cell = resolvedCells[i] as any
        const colDef: A2UIColDef = a2uiCols[i] || {}

        const col: Record<string, any> = {
          key: colDef.dataIndex ?? cell.id ?? `col_${i}`,
          title: typeof colDef.title === 'string' ? colDef.title : (cell.id ?? `col_${i}`),
          // eview-react Table render 签名：(cellValue, rowData, options, row)
          // 当前行数据在 row.rawData，故 row 持 dataSource + dataField='rawData'，
          // emitter 解构源为 row.rawData（const { f1, f2 } = row.rawData），body 内相对绑定裸引用
          render: buildRenderFn(cell, [
            { name: 'cellValue' },
            { name: 'rowData' },
            { name: 'options' },
            { name: 'row', dataSource: dataBinding, dataField: 'rawData' },
          ]),
        }

        // 列属性映射（A2UI → eview-react）
        if (colDef.align) col.align = colDef.align
        if (colDef.width !== undefined) col.width = colDef.width
        if (colDef.minWidth !== undefined) col.width = colDef.minWidth
        if (colDef.sort === true) col.allowSort = true
        if (colDef.className) col.className = colDef.className
        if (colDef.fixed === 'start') col.freezeCol = true
        // filters 透传（A2UI 与 eview-react 结构一致：[{ text, value }]）
        if (colDef.filters) col.filters = colDef.filters

        columns.push(col)
      }

      // ─── 构造输出 props ───
      const outputProps: Record<string, PropValue> = {
        dataset,
        columns,
      }

      // rowKey：字面量，透传
      if (node.props.rowKey) outputProps.rowKey = node.props.rowKey

      // pagination → enablePagination（字面量 boolean，值映射）
      outputProps.enablePagination = node.props.pagination !== false

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

      // expandable → enableRowExpand（字面量 object，存在即启用）
      if (node.props.expandable) outputProps.enableRowExpand = true

      // className（字面量 string，透传）
      if (node.props.className) outputProps.className = node.props.className

      // 透传剩余（排除已处理的 A2UI 字段）
      const SKIP = new Set([
        'dataSource', 'columns', 'rowKey', 'pagination',
        'rowSelection', 'expandable', 'rowClassName', 'className', 'id',
      ])
      for (const [key, val] of Object.entries(node.props)) {
        if (!SKIP.has(key)) outputProps[key] = val as PropValue
      }

      // ─── propRoute ───
      // columns：字面量数组 → module-top 提升
      // checkedRows：受控 useState → component-internal
      const propRoute: Record<string, any> = { columns: 'module-top' }
      if (node.props.rowSelection?.selectedRowKeys !== undefined) {
        propRoute.checkedRows = 'component-internal'
      }

      return {
        props: outputProps,
        propRoute,
        children: null,
      }
    },
  }
}
