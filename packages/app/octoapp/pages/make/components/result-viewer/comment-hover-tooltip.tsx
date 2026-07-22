import { JSX } from "solid-js"
import "./comment-hover-tooltip.css"
import { formatCommentTime } from "./comment-popover"

export interface CommentHoverTarget {
  elementId: string | null
  selector: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  note?: string
  pinPosition?: { left: number; top: number; width: number; height: number }
  commenterAvatar?: string
  commenterName?: string
  createdAt?: number
  commentId?: string
}

export function CommentHoverTooltip(props: {
  target: CommentHoverTarget | null
  iframeBounds: { width: number; height: number }
  onClose?: () => void
  onClick?: () => void
}): JSX.Element {
  if (!props.target) return null

  const tooltipWidth = 320
  const tooltipMinHeight = 60

  let left: number
  let top: number

  const commenterName = props.target.commenterName || "用户"
  const commenterAvatar = props.target.commenterAvatar

  if (props.target.pinPosition) {
    const pinLeft = props.target.pinPosition.left
    const pinTop = props.target.pinPosition.top
    const pinHeight = props.target.pinPosition.height

    left = pinLeft
    top = pinTop + pinHeight

    if (left + tooltipWidth > props.iframeBounds.width) {
      left = props.iframeBounds.width - tooltipWidth - 8
    }
    if (left < 8) {
      left = 8
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
        transform: 'translateY(-100%)',
      }}
      onPointerLeave={() => {
        props.onClose?.()
      }}
      onClick={() => {
        props.onClick?.()
      }}
    >
      <div class="comment-hover-tooltip-author">
        <div class="comment-hover-tooltip-avatar">
          {commenterAvatar ? (
            <img src={commenterAvatar} alt={commenterName} />
          ) : (
            <span class="comment-hover-tooltip-avatar-default">{commenterName.charAt(0)}</span>
          )}
        </div>
        <span class="comment-hover-tooltip-name">{commenterName}</span>
        <span class="comment-hover-tooltip-time">{props.target.createdAt ? formatCommentTime(props.target.createdAt) : ""}</span>
      </div>
      {props.target.note && (
        <div class="comment-hover-tooltip-note">{props.target.note}</div>
      )}
    </div>
  )
}