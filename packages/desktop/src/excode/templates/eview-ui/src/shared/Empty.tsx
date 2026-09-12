/**
 * Empty 公共组件（eview-ui shared）
 *
 * eview-ui 无 Empty 组件，此处手动实现对齐 eview-react Empty 接口（md/eview-react/Empty.md）。
 * 映射层（api/config/mappings/eview-react/Empty.ts 工厂，eview-ui 复用）产出的 props：
 * description / icon / imgSrc / className（type 不注入，走默认 fail）。
 *
 * 图标显示优先级：icon > imgSrc > 默认占位图（由 type 决定）。
 * 描述文本优先级：description > type 默认文本（fail→"暂无数据"，success→"数据为 0"）。
 *
 * import: import Empty from '@/shared/Empty'
 */

import React from 'react'

export interface EmptyProps {
  /** 描述文本，未设置时按 type 显示默认描述 */
  description?: React.ReactNode
  /** 自定义图标（优先级高于 imgSrc 与默认图标） */
  icon?: React.ReactNode
  /** 自定义图片 URL（优先级高于默认图标，低于 icon） */
  imgSrc?: string
  /** 预设空状态类型：fail 显示失败占位+"暂无数据"，success 显示成功占位+"数据为 0"，默认 fail */
  type?: 'success' | 'fail'
  className?: string
  style?: React.CSSProperties
  id?: string
}

// type → 默认描述文本
const DEFAULT_DESCRIPTION: Record<'success' | 'fail', string> = {
  fail: '暂无数据',
  success: '数据为 0',
}

// 默认占位图（type 区分）：简单内联 SVG，对齐 eview-react Empty 的"无数据/为零"语义
function DefaultImage({ type }: { type: 'success' | 'fail' }) {
  const stroke = type === 'success' ? 'var(--color-success, #52c41a)' : 'var(--color-text-disabled, #bfbfbf)'
  return (
    <svg width={64} height={41} viewBox="0 0 64 41" fill="none" aria-hidden>
      <ellipse cx={32} cy={33} rx={32} ry={8} fill={stroke} opacity={0.08} />
      <g stroke={stroke} strokeWidth={2} fill="none">
        <path d="M16 30V8a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v22" />
        <path d="M12 30h40" strokeLinecap="round" />
        <path d="M24 14h16M24 20h10" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function Empty(props: EmptyProps) {
  const {
    description,
    icon,
    imgSrc,
    type = 'fail',
    className,
    style,
    id,
  } = props

  // 图标优先级：icon > imgSrc > 默认占位图
  const imageNode = icon ?? (imgSrc ? <img src={imgSrc} alt="" /> : <DefaultImage type={type} />)
  const descNode = description ?? DEFAULT_DESCRIPTION[type]

  return (
    <div
      id={id}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '16px 0',
        color: 'var(--color-text-secondary, #8c8c8c)',
        fontSize: 14,
        ...style,
      }}
    >
      {imageNode}
      <span>{descNode}</span>
    </div>
  )
}
