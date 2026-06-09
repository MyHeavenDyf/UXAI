<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { ElTable, ElTableColumn, ElPagination } from "element-plus"
import type { TableNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import ComponentNode from "../../renderer/render/ComponentNode.vue"
import "./Table.less"
const fixedEnum = {
  start: "left",
  end: "right",
}
const alignEnum = {
  left: "left",
  center: "center",
  right: "right",
}

const props = defineProps<A2UIComponentProps<TableNode>>()
const { node, surfaceId } = props
const { properties } = node

const { resolveValue, setValue } = useA2UIComponent(node, surfaceId)
const tableRef = ref()

const id = computed(() => node.id)
const className = computed(() => properties.className)
const rowClassName = computed(() => properties.rowClassName)
const rowKey = computed(() => properties.rowKey)

const dataSource = computed(
  () => (resolveValue(properties.dataSource) as []) ?? []
)
// 分页
const showPagination = computed(() => properties.pagination === false ? false : true)
const rowsPerPage = ref(10)
const page = ref(1)
const rows = computed(() => {
  if (showPagination.value) {
    const start = (page.value - 1) * rowsPerPage.value
    const end = start + rowsPerPage.value
    return {
      node: properties.children.slice(start, end),
      data: dataSource.value.slice(start, end),
    }
  }

  return {
    node: properties.children,
    data: dataSource.value,
  }
})
function handlePageChange(newPage: number) {
  page.value = newPage
}

// 多选
const selectType = computed(() => {
  const rowSelection = properties.rowSelection
  return rowSelection?.type
})
const initSelectedKeys = computed(() => {
  return (resolveValue(properties.rowSelection?.selectedRowKeys) as []) ?? []
})
const rowSelectedKeys = ref<string[]>()
watch(
  () => initSelectedKeys.value,
  () => {
    if (selectType.value !== "checkbox") {
      return false
    }
    rowSelectedKeys.value = initSelectedKeys.value as string[]

    if (initSelectedKeys.value.length) {
      // 初始选中值
      // tableRef.value
    } else {
      tableRef.value?.clearSelection()
    }
  },
  { immediate: true }
)

function handleSelectionChange(selection: any[]) {
  const keys = selection.map((row: any) => row.key)
  rowSelectedKeys.value = keys
  const { rowSelection } = properties
  const path = rowSelection?.selectedRowKeys?.path
  if (path) {
    setValue(path, keys)
  }
}

// 表头
const columns = computed(() => {
  const resCols = Array.isArray(properties.columns)
    ? properties.columns
    : (resolveValue(properties.columns) as []) || []
  return resCols.map((col) => {
    let fixed = undefined
    if (typeof col.fixed === "boolean") {
      fixed = col.fixed
    } else {
      fixed = col.fixed ? fixedEnum[col.fixed] : undefined
    }

    return {
      label: col.title,
      prop: col.dataIndex,
      align: col.align ? alignEnum[col.align] : "left",
      className: col.className,
      filters: col.filters,
      fixed: fixed,
      sortable: col.sort,
      width: col.width,
      minWidth: col.minWidth,
    }
  })
})

// 表体 -- 节点驱动
const tableData = computed(() => {
  return rows.value.node.map((item, index) => {
    const { properties: itemProps } = item
    const { children: cells } = itemProps
    const data = rows.value.data[index]
    const dataIsObj = Object.prototype.toString.call(data) === "[object Object]"

    const rowData: Record<string, any> = {
      [rowKey.value]: dataIsObj ? data[rowKey.value] : `row-${index}`,
    }
    columns.value.forEach((col, colIndex) => {
      const cell = cells[colIndex]
      if (cell) {
        rowData[col.prop] = cell
      }
    })

    return rowData
  })
})
</script>

<template>
  <div :id="id" :class="className">
    <ElTable
      ref="tableRef"
      :data="tableData"
      :row-key="rowKey"
      :highlight-current-row="selectType === 'radio'"
      :row-class-name="rowClassName"
      @selection-change="handleSelectionChange"
    >
      <ElTableColumn
        v-if="selectType === 'checkbox'"
        type="selection"
        width="55"
      />
      <ElTableColumn
        :class="col.className"
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align"
        :filters="col.filters"
        :fixed="col.fixed"
        :sortable="col.sortable"
      >
        <template #default="{ row }">
          <ComponentNode
            v-if="row[col.prop]"
            :node="row[col.prop]"
            :surface-id="surfaceId"
          />
        </template>
      </ElTableColumn>
    </ElTable>
    <div v-if="showPagination" class="flex w-full justify-end mt-4">
      <ElPagination
        background
        v-model:current-page="page"
        v-model:page-size="rowsPerPage"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="dataSource.length"
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>
