/**
 * Divider 公共组件（eview-ui shared）
 *
 * eview-ui 无 Divider 组件，此处手动实现对齐 eview-react Divider 接口（md/eview-react/Divider.md）。
 * 映射层（api/config/mappings/eview-react/Divider.ts 工厂，eview-ui 复用）产出的 props：
 * type / dashed / orientation / className / children。
 *
 * import: import Divider from '@/shared/Divider'
 */

import React from 'react'

export interface DividerProps {
  /** 分割线方向：horizontal / vertical，默认 horizontal */
  type?: 'horizontal' | 'vertical'
  /** 是否虚线 */
  dashed?: boolean
  /** 标题位置（仅 children 有内容时生效）：left / right / center */
  orientation?: 'left' | 'right' | 'center'
  className?: string
  style?: React.CSSProperties
  id?: string
  /** 分割线标题内容（设置后中间显示文字） */
  children?: React.ReactNode
}

export default function Divider(props: DividerProps) {
  const {
    type = 'horizontal',
    dashed,
    orientation = 'center',
    className,
    style,
    id,
    children,
  } = props

  const borderStyle = dashed ? 'dashed' : 'solid'
  const lineColor = '#e5e5e5'

  // ─── 垂直分割线（行内） ───
  if (type === 'vertical') {
    return (
      <span
        id={id}
        className={className}
        style={{
          display: 'inline-block',
          width: 0,
          height: '1em',
          margin: '0 8px',
          borderLeft: `1px ${borderStyle} ${lineColor}`,
          verticalAlign: 'middle',
          ...style,
        }}
      />
    )
  }

  // ─── 水平分割线 ───
  const hasText = children != null
  const lineStyle: React.CSSProperties = {
    flex: 1,
    borderTop: `1px ${borderStyle} ${lineColor}`,
  }
  const textStyle: React.CSSProperties = { padding: '0 12px', color: 'inherit' }

  return (
    <div
      id={id}
      className={className}
      style={{ display: 'flex', alignItems: 'center', margin: '12px 0', ...style }}
    >
      {(orientation === 'right' || orientation === 'center') && <span style={lineStyle} />}
      {hasText && <span style={textStyle}>{children}</span>}
      {(orientation === 'left' || orientation === 'center') && <span style={lineStyle} />}
    </div>
  )
}
