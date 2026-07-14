import { JSX, createSignal, createMemo, createEffect, on, onCleanup, Show, For } from "solid-js"
import { truncateFilenameWithExt, formatFileSize } from "../../utils/truncate-filename"
import { IconFileOther } from "../../icons/file-type-icons"
import "./comment-popover.css"

export interface CommentAttachment {
  id: string
  filename: string
  mime: string
  size: number
  filePath: string
  uploadedAt: number
}

export interface FileComment {
  id: string
  filePath: string
  elementId: string
  selector: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  note: string
  attachments?: CommentAttachment[]
  createdAt: number
  updatedAt: number
  hoverPoint?: { x: number; y: number }
  commenterName?: string
  commenterAccount?: string
  commenterAvatar?: string
}

export interface CommentPopoverTarget {
  elementId: string | null
  selector: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  hoverPoint?: { x: number; y: number }
}

function formatCommentTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

export function CommentPopover(props: {
  target: CommentPopoverTarget | null
  comment: FileComment | null
  iframeBounds?: { width: number; height: number }
  externalClickSignal?: number
  allComments?: FileComment[]
  readOnly?: boolean
  onSave: (note: string, attachments: CommentAttachment[], pendingFiles: File[]) => void
  onDelete?: () => void
  onClose: () => void
  onUploadAttachment?: (file: File) => void
  onDeleteAttachment?: (attachmentId: string) => void
  onPrevPin?: () => void
  onNextPin?: () => void
}): JSX.Element {
  const [note, setNote] = createSignal(props.comment?.note || "")
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [externalClickCount, setExternalClickCount] = createSignal(0)
  const [isShaking, setIsShaking] = createSignal(false)
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([])
  const attachments = () => props.comment?.attachments || []

  if (!props.target) return null

  const sortedComments = createMemo(() => {
    const all = props.allComments || []
    return [...all].sort((a, b) => a.createdAt - b.createdAt)
  })

  const currentIndex = createMemo(() => {
    if (!props.comment) return -1
    return sortedComments().findIndex(c => c.id === props.comment?.id)
  })

  const canGoPrev = createMemo(() => currentIndex() > 0)
  const canGoNext = createMemo(() => currentIndex() >= 0 && currentIndex() < sortedComments().length - 1)

  const commenterName = () => props.comment?.commenterName || "用户名"
  const commenterAvatar = () => props.comment?.commenterAvatar || ""
  const commentTime = () => props.comment?.createdAt ? formatCommentTime(props.comment.createdAt) : ""

  createEffect(on(
    () => props.externalClickSignal,
    () => {
      const currentCount = externalClickCount()
      const currentNote = note().trim()
      
      if (props.externalClickSignal && props.externalClickSignal > 0) {
        if (currentNote) {
          if (currentCount === 0) {
            setIsShaking(true)
            setExternalClickCount(1)
            setTimeout(() => setIsShaking(false), 500)
          } else {
            props.onClose()
          }
        } else {
          props.onClose()
        }
      }
    }
  ))

  createEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      if (!target.parentElement) return
      
      if (target.tagName === 'IFRAME') return
      
      if (target.closest('.comment-popover-attachment-delete')) return
      
      const popover = target.closest('.comment-popover')
      
      if (!popover) {
        if (note().trim()) {
          if (externalClickCount() === 0) {
            setIsShaking(true)
            setExternalClickCount(1)
            setTimeout(() => setIsShaking(false), 500)
          } else {
            props.onClose()
          }
        } else {
          props.onClose()
        }
      }
    }
    
    document.addEventListener('click', handleClick)
    onCleanup(() => document.removeEventListener('click', handleClick))
  })

  const handleFileInput = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return
    
    if (props.comment) {
      for (const file of Array.from(files)) {
        props.onUploadAttachment?.(file)
      }
    } else {
      setPendingFiles(prev => [...prev, ...Array.from(files)])
    }
    
    input.value = ""
  }

  const handleSave = (e: MouseEvent) => {
    e.stopPropagation()
    props.onSave(note(), attachments(), pendingFiles())
    props.onClose()
  }

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete()) {
      setConfirmDelete(true)
      return
    }
    props.onDelete?.()
    props.onClose()
  }

  const iframeWidth = props.iframeBounds?.width || 800
  const iframeHeight = props.iframeBounds?.height || 600

  const left = createMemo(() => props.target!.hoverPoint?.x || props.target!.position.x * iframeWidth + 20)
  const top = createMemo(() => props.target!.hoverPoint?.y || props.target!.position.y * iframeHeight + 20)

  return (
    <div class={`comment-popover ${isShaking() ? 'comment-popover-shake' : ''}`} style={{ left: `${left()}px`, top: `${top()}px` }}>
      <div class="comment-popover-header">
        <Show when={props.readOnly && sortedComments().length > 1} fallback={
          <span class="comment-popover-label">{props.target.label}</span>
        }>
          <div class="comment-popover-switcher">
            <button
              type="button"
              class="comment-popover-switcher-btn"
              classList={{ "comment-popover-switcher-btn-disabled": !canGoPrev() }}
              disabled={!canGoPrev()}
              onClick={(e) => { e.stopPropagation(); if (canGoPrev()) props.onPrevPin?.() }}
              title="上一条评论"
            >
              ‹
            </button>
            <span class="comment-popover-switcher-label">
              {currentIndex() + 1}/{sortedComments().length}
            </span>
            <button
              type="button"
              class="comment-popover-switcher-btn"
              classList={{ "comment-popover-switcher-btn-disabled": !canGoNext() }}
              disabled={!canGoNext()}
              onClick={(e) => { e.stopPropagation(); if (canGoNext()) props.onNextPin?.() }}
              title="下一条评论"
            >
              ›
            </button>
          </div>
        </Show>
        <button class="comment-popover-close" onClick={(e) => { e.stopPropagation(); props.onClose() }}>×</button>
      </div>

      <div class="comment-popover-info">
        <div class="comment-popover-selector">{props.target.selector}</div>
      </div>

      <Show when={props.readOnly}>
        <div class="comment-popover-author">
          <div class="comment-popover-avatar">
            <Show when={commenterAvatar()} fallback={
              <span class="comment-popover-avatar-default">{commenterName().charAt(0)}</span>
            }>
              <img src={commenterAvatar()} alt={commenterName()} />
            </Show>
          </div>
          <span class="comment-popover-author-name">{commenterName()}</span>
          <span class="comment-popover-author-time">{commentTime()}</span>
        </div>
      </Show>

      <Show when={props.readOnly}>
        <Show when={note()}>
          <div class="comment-popover-note-readonly">{note()}</div>
        </Show>
      </Show>

      <Show when={!props.readOnly}>
        <textarea
          class="comment-popover-note"
          value={note()}
          onInput={(e) => {
            setNote(e.currentTarget.value)
            setExternalClickCount(0)
          }}
          placeholder="添加评论..."
          rows={3}
        />
      </Show>

      <div class="comment-popover-attachments">
        <div class="comment-popover-attachments-header">
          <span>附件 ({attachments().length + pendingFiles().length})</span>
          <Show when={!props.readOnly && props.comment}>
            <label class="comment-popover-attachment-add-btn">
              + 添加文件
              <input
                type="file"
                multiple
                accept="*/*"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
            </label>
          </Show>
        </div>

        <Show when={pendingFiles().length > 0 || attachments().length > 0}>
          <div class="comment-popover-attachments-grid">
            <For each={pendingFiles()}>
              {(file) => (
                <div class="comment-popover-attachment-item pending">
                  <div class="comment-popover-attachment-icon">
                    <IconFileOther size={24} />
                  </div>
                  <span class="comment-popover-attachment-name">
                    {truncateFilenameWithExt(file.name)}
                  </span>
                  <Show when={!props.readOnly}>
                    <button
                      class="comment-popover-attachment-delete"
                      onClick={(e) => { 
                        e.stopPropagation()
                        setPendingFiles(prev => prev.filter(f => f !== file))
                      }}
                      title="删除"
                    >
                      ×
                    </button>
                  </Show>
                </div>
              )}
            </For>
            
            <For each={attachments()}>
              {(att) => (
                <div class="comment-popover-attachment-item">
                  <div class="comment-popover-attachment-icon">
                    <IconFileOther size={24} />
                  </div>
                  <span class="comment-popover-attachment-name">
                    {truncateFilenameWithExt(att.filename)}
                  </span>
                  <Show when={!props.readOnly}>
                    <button
                      class="comment-popover-attachment-delete"
                      onClick={(e) => { e.stopPropagation(); props.onDeleteAttachment?.(att.id) }}
                      title="删除"
                    >
                      ×
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={props.readOnly && props.comment}>
        <div class="comment-popover-actions">
          <Show when={!confirmDelete()}>
            <button class="comment-btn-delete" onClick={handleDelete}>
              删除
            </button>
          </Show>
          <Show when={confirmDelete()}>
            <button class="comment-btn-confirm-delete" onClick={handleDelete}>
              确认删除
            </button>
            <button class="comment-btn-cancel-delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}>
              取消
            </button>
          </Show>
        </div>
      </Show>

      <Show when={!props.readOnly}>
        <div class="comment-popover-actions">
          <Show when={props.comment && !confirmDelete()}>
            <button class="comment-btn-delete" onClick={handleDelete}>
              删除
            </button>
          </Show>

          <Show when={confirmDelete()}>
            <button class="comment-btn-confirm-delete" onClick={handleDelete}>
              确认删除
            </button>
            <button class="comment-btn-cancel-delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}>
              取消
            </button>
          </Show>

          <Show when={!confirmDelete()}>
            <Show when={!props.comment}>
              <label class="comment-btn-add-file">
                + 添加文件
                <input
                  type="file"
                  multiple
                  accept="*/*"
                  onChange={handleFileInput}
                  style={{ display: "none" }}
                />
              </label>
            </Show>
            <Show when={props.comment}>
              <button class="comment-btn-cancel" onClick={(e) => { e.stopPropagation(); props.onClose() }}>
                取消
              </button>
            </Show>
            <button class="comment-btn-save" onClick={handleSave}>
              保存
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}