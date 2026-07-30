/**
 * Tag 公共组件（eview-ui shared）
 *
 * eview-ui 无 Tag 组件，此处手动实现对齐 eview-react Tag 接口（md/eview-react/Tag.md）。
 * 映射层（api/config/mappings/eview-react/Tag.ts 工厂，eview-ui 复用）产出的 props：
 * color / fill / size / hasIcon / iconName / closable / className / children。
 *
 * 注意：映射把 `iconName` 设为 resolveIcon 产出的图标元素（@hui/icon-plus 组件节点），
 * 故此处 iconName 是 ReactNode（图标元素），非字符串标识。
 *
 * import: import Tag from '@/shared/Tag'
 */

import React from 'react'

type TagColor = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'caution' | string
type TagFill = 'solid' | 'outline'
type TagSize = 'small' | 'normal' | 'large'

export interface TagProps {
  /** 填充颜色：预设枚举或自定义颜色字符串（#HEX / 色名） */
  color?: TagColor
  /** 填充模式：solid 实心 / outline 镂空，默认 solid */
  fill?: TagFill
  /** 标签尺寸，默认 normal */
  size?: TagSize
  /** 圆角，默认 true */
  round?: boolean
  /** 是否可关闭 */
  closable?: boolean
  /** 是否含图标 */
  hasIcon?: boolean
  /** 图标元素（resolveIcon 产出的 @hui/icon-plus 节点，ReactNode） */
  iconName?: React.ReactNode
  /** 是否消息标签 */
  isMessageTag?: boolean
  className?: string
  style?: React.CSSProperties
  id?: string
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void
  onClose?: (e: React.MouseEvent) => void
}

const COLOR_MAP: Record<string, string> = {
  default: '#8a8a8a',
  primary: '#1677ff',
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  caution: '#fa8c16',
}

const SIZE_STYLE: Record<TagSize, { fontSize: number; padding: string }> = {
  small: { fontSize: 12, padding: '0 6px' },
  normal: { fontSize: 13, padding: '1px 8px' },
  large: { fontSize: 14, padding: '3px 10px' },
}

export default function Tag(props: TagProps) {
  const {
    color = 'default',
    fill = 'solid',
    size = 'normal',
    round = true,
    closable,
    hasIcon,
    iconName,
    className,
    style,
    id,
    children,
    onClick,
    onClose,
  } = props

  const c = COLOR_MAP[color] ?? color // 自定义颜色字符串（#HEX / 色名）原样使用
  const sz = SIZE_STYLE[size]
  const isOutline = fill === 'outline'

  const tagStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: sz.fontSize,
    padding: sz.padding,
    borderRadius: round ? 4 : 0,
    lineHeight: 1.5,
    cursor: onClick ? 'pointer' : 'default',
    whiteSpace: 'nowrap',
    ...(isOutline
      ? { color: c, background: 'transparent', border: `1px solid ${c}` }
      : { color: '#fff', background: c, border: `1px solid ${c}` }),
    ...style,
  }

  return (
    <span id={id} className={className} style={tagStyle} onClick={onClick}>
      {hasIcon && iconName != null && (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>{iconName}</span>
      )}
      {children != null && <span>{children}</span>}
      {closable && (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 2, cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            onClose?.(e)
          }}
        >
          ×
        </span>
      )}
    </span>
  )
}
