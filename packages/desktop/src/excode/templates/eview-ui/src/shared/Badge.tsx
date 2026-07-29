/**
 * Badge 公共组件（eview-ui shared）
 *
 * eview-ui 无 Badge 组件，此处手动实现对齐 eview-react Badge 接口（md/eview-react/Badge.md）。
 * 映射层（api/config/mappings/eview-react/Badge.ts 工厂，eview-ui 复用）产出的 props：
 * content / max / status / badgeStyle / dot / offset / showZero / className / children。
 *
 * import: import Badge from '@/shared/Badge'
 */

import React from 'react'

type BadgeStatus = 'default' | 'success' | 'error' | 'warning' | 'off'

export interface BadgeProps {
  /** 徽标内容：number / string / ReactNode；为 null/undefined/'' 时不显示 */
  content?: React.ReactNode | number
  /** 最大值，超过显示 {max}+（仅 content 为数字时有效），默认 99 */
  max?: number
  /** 不展示数字，只显示小红点 */
  dot?: boolean
  /** 状态点模式（配合 text 显示状态点及文本） */
  status?: BadgeStatus
  /** 状态点文本（设置 status 后有效） */
  text?: React.ReactNode
  /** 徽标偏移量 [水平, 垂直] */
  offset?: [number, number]
  /** 数值为 0 时是否展示 */
  showZero?: boolean
  /** 徽标自定义样式 */
  badgeStyle?: React.CSSProperties
  /** 徽标自定义类名 */
  badgeClassName?: string
  className?: string
  style?: React.CSSProperties
  id?: string
  /** 包裹的目标元素 */
  children?: React.ReactNode
}

const STATUS_COLOR: Record<BadgeStatus, string> = {
  default: '#8a8a8a',
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14',
  off: '#d9d9d9',
}

export default function Badge(props: BadgeProps) {
  const {
    content, max = 99, dot, status, text, offset, showZero,
    badgeStyle, badgeClassName, className, style, id, children,
  } = props

  // ─── 状态点模式：dot + text ───
  if (status) {
    return (
      <span
        id={id}
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}
      >
        <span
          className={badgeClassName}
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: STATUS_COLOR[status] ?? STATUS_COLOR.default,
            ...badgeStyle,
          }}
        />
        {text != null && <span>{text}</span>}
      </span>
    )
  }

  // ─── 数字 / 内容徽标 ───
  const isNum = typeof content === 'number'
  let display: React.ReactNode = null
  if (dot) {
    display = '' // 只显示红点
  } else if (content == null || content === '') {
    display = null
  } else if (isNum) {
    if (content === 0 && !showZero) {
      display = null
    } else if (content > max) {
      display = `${max}+`
    } else {
      display = content
    }
  } else {
    display = content
  }

  const showBadge = dot || display != null

  const badgeCss: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    transform: 'translate(50%, -50%)',
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 8,
    background: '#ff4d4f',
    color: '#fff',
    fontSize: 10,
    lineHeight: '16px',
    textAlign: 'center',
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    ...(dot ? { width: 6, height: 6, minWidth: 0, padding: 0, borderRadius: '50%' } : {}),
    ...(offset ? { top: offset[1], right: offset[0] } : {}),
    ...badgeStyle,
  }

  return (
    <span
      id={id}
      className={className}
      style={{ position: 'relative', display: 'inline-block', ...style }}
    >
      {children}
      {showBadge && (
        <sup className={badgeClassName} style={badgeCss}>
          {dot ? '' : display}
        </sup>
      )}
    </span>
  )
}
