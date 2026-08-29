/**
 * TableFilter 公共组件（eview-ui shared）
 *
 * import: import TableFilter from '@/shared/TableFilter'
 */

import React, { useState, useCallback } from 'react'
import Checkbox from '@cloudsop/eview-ui/Checkbox'
import TextButton from '@cloudsop/eview-ui/TextButton'
import Divider from './Divider'
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
    <div className="eui-custom-table-filter-wrapper">
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
        <TextButton
          disabled={checkedValue.size === 0}
          onClick={reset}
          text="重置"
        />
        <TextButton
          style={{ padding: '0 var(--space-3x)' }}
          onClick={() => onFilter?.([...checkedValue])}
          text="筛选"
        />
      </div>
    </div>
  )
}
