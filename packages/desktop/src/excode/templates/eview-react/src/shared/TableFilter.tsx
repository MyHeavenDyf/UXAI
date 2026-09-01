/**
 * TableFilter 公共组件（eview-react shared）
 *
 * import: import TableFilter from '@/shared/TableFilter'
 */

import React, { useState, useCallback } from 'react'
import Button from '@nce/eview-react/Button'
import Divider from '@nce/eview-react/Divider'
import Checkbox from '@nce/eview-react/Checkbox'
import './TableFilter.less'

export interface TableFilterOption {
  text: string
  value: string
}

export interface TableFilterProps {
  /** 过滤选项列表，每项 { text, value }，必填 */
  data: TableFilterOption[]
  /** 选中值变化回调，参数为当前选中的 value 数组 */
  onFilter?: (value: string[]) => void
}

export default function TableFilter(props: TableFilterProps) {
  const { data, onFilter } = props

  const [checkedValue, setCheckedValue] = useState<Set<string>>(new Set())

  const handleChange = useCallback((value: string, checked: boolean) => {
    const newSet = new Set([...checkedValue])
    if (checked) {
      newSet.add(value)
    } else {
      newSet.delete(value)
    }
    setCheckedValue(newSet)
  }, [checkedValue])

  const reset = useCallback(() => {
    setCheckedValue(new Set())
  }, [])

  if (!data.length) return null

  return (
    <div className="ev-custom-table-filter-wrapper">
      <div className="checkbox-wrapper">
        {data.map((item) => (
          <div className="checkbox-item-wrapper" key={item.value}>
            <Checkbox
              value={item.value}
              label={item.text}
              checked={checkedValue.has(item.value)}
              onChange={handleChange}
            />
          </div>
        ))}
      </div>
      <Divider style={{ margin: 'unset' }} />
      <div className="button-wrapper">
        <Button
          style={{ padding: 'unset', minWidth: 'unset' }}
          disabled={checkedValue.size === 0}
          status="text"
          onClick={reset}
        >
          重置
        </Button>
        <Button
          style={{ padding: '0 var(--space-3x)', minWidth: 'unset' }}
          status="text"
          onClick={() => onFilter?.([...checkedValue])}
        >
          筛选
        </Button>
      </div>
    </div>
  )
}
