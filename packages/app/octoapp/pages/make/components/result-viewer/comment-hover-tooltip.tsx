import { JSX, createEffect, onCleanup } from "solid-js"
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
  showOverlap?: boolean
}

export function CommentHoverTooltip(props: {
  target: CommentHoverTarget | null
  iframeBounds: { width: number; height: number }
  onClose?: () => void
  onClick?: () => void
}): JSX.Element {
  if (!props.target) return null

  const tooltipWidth = 320
  const commenterName = props.target.commenterName || "用户"
  const commenterAvatar = props.target.commenterAvatar

  let tooltipRef: HTMLDivElement | undefined
  let animationFrameId: number | undefined

  createEffect(() => {
    if (!tooltipRef || !props.target?.pinPosition) return

    animationFrameId = requestAnimationFrame(() => {
      if (!tooltipRef) return
      
      const tooltipHeight = tooltipRef.offsetHeight
      const pinLeft = props.target!.pinPosition!.left
      const pinTop = props.target!.pinPosition!.top
      const pinWidth = props.target!.pinPosition!.width
      const pinHeight = props.target!.pinPosition!.height

      const pinCenterX = pinLeft + pinWidth / 2
      const pinCenterY = pinTop + pinHeight / 2
      const isLeft = pinCenterX < props.iframeBounds.width / 2
      const isTop = pinCenterY < props.iframeBounds.height / 2

      let left: number
      let top: number
      let radiusClass: string

      if (isLeft && isTop) {
        left = pinLeft
        top = pinTop
        radiusClass = "radius-top-left"
      } else if (!isLeft && isTop) {
        left = pinLeft + pinWidth - tooltipWidth
        top = pinTop
        radiusClass = "radius-top-right"
      } else if (isLeft && !isTop) {
        left = pinLeft
        top = pinTop + pinHeight - tooltipHeight
        radiusClass = "radius-bottom-left"
      } else {
        left = pinLeft + pinWidth - tooltipWidth
        top = pinTop + pinHeight - tooltipHeight
        radiusClass = "radius-bottom-right"
      }

      left = Math.max(0, Math.min(left, props.iframeBounds.width - tooltipWidth))
      top = Math.max(0, Math.min(top, props.iframeBounds.height - tooltipHeight))

      tooltipRef.style.setProperty("--tooltip-x", `${left}px`)
      tooltipRef.style.setProperty("--tooltip-y", `${top}px`)
      tooltipRef.className = `comment-hover-tooltip visible ${radiusClass}`
    })
  })

  onCleanup(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }
  })

  return (
    <div
      ref={tooltipRef}
      class="comment-hover-tooltip"
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