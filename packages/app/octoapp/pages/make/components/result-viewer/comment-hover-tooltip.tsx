import { JSX } from "solid-js"
import "./comment-hover-tooltip.css"

export interface CommentHoverTarget {
  elementId: string | null
  selector: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  note?: string
  pinPosition?: { left: number; top: number; width: number; height: number }
}

export function CommentHoverTooltip(props: {
  target: CommentHoverTarget | null
  iframeBounds: { width: number; height: number }
}): JSX.Element {
  if (!props.target) return null

  const tooltipWidth = 280
  const tooltipHeight = 150
  const padding = 10

  let left: number
  let top: number

  if (props.target.pinPosition) {
    const pinLeft = props.target.pinPosition.left
    const pinTop = props.target.pinPosition.top
    const pinWidth = props.target.pinPosition.width
    const pinHeight = props.target.pinPosition.height
    
    left = pinLeft + pinWidth / 2 - tooltipWidth / 2
    top = pinTop + pinHeight + padding
    
    if (left + tooltipWidth > props.iframeBounds.width) {
      left = props.iframeBounds.width - tooltipWidth - padding
    }
    if (left < padding) {
      left = padding
    }
    if (top + tooltipHeight > props.iframeBounds.height) {
      top = pinTop - tooltipHeight - padding
    }
  } else {
    left = props.target.position.x * props.iframeBounds.width + 20
    top = props.target.position.y * props.iframeBounds.height + 20
  }

  return (
    <div
      class="comment-hover-tooltip"
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
    >
      <div class="comment-hover-tooltip-label">{props.target.label}</div>
      <div class="comment-hover-tooltip-selector">{props.target.selector}</div>
      {props.target.text && (
        <div class="comment-hover-tooltip-text">"{props.target.text}"</div>
      )}
      {props.target.note && (
        <div class="comment-hover-tooltip-note">{props.target.note}</div>
      )}
    </div>
  )
}