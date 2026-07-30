import { JSX, createSignal, createMemo, createEffect, on, onCleanup, Show, For } from "solid-js"
import { truncateFilenameForDisplay, formatFileSize } from "../../utils/truncate-filename"
import { getFileIcon } from "../../icons/file-type-icons"
import { IconSendDefault, IconSendActive, IconAnnotationAttach, IconCloseCancel, IconDeleteAnnotation } from "../../icons/annotation-icons"
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
  contentSignature?: string
  nativeId?: string
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
  tag?: string
  selector: string
  contentSignature?: string
  nativeId?: string
  label: string
  text: string
  position: { x: number; y: number; w: number; h: number }
  htmlHint: string
  hoverPoint?: { x: number; y: number }
  pinPosition?: { left: number; top: number; width: number; height: number }
}

export function formatCommentTime(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
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
  const [externalClickCount, setExternalClickCount] = createSignal(0)
  const [isShaking, setIsShaking] = createSignal(false)
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([])
  const [isEditing, setIsEditing] = createSignal(false)
  const [originalNote, setOriginalNote] = createSignal("")
  
  // 当 comment 变化时，重置所有状态
  createEffect(() => {
    setNote(props.comment?.note || "")
    setPendingFiles([])
    setIsEditing(false)
  })
  
  let newTextarea: HTMLTextAreaElement | undefined
  let editTextarea: HTMLTextAreaElement | undefined

  // 新建标注时自动 focus
  createEffect(() => {
    if (!props.comment && newTextarea) {
      newTextarea.focus()
    }
  })
  
  // 编辑标注时自动 focus
  createEffect(() => {
    if (isEditing() && editTextarea) {
      editTextarea.focus()
    }
  })
  
  const autoResizeTextarea = (el: HTMLTextAreaElement, max = 66) => {
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, max) + "px"
  }
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

  const hasContent = createMemo(() => Boolean(note().trim()) || pendingFiles().length > 0 || attachments().length > 0)

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
      if (target.closest('.comment-input-send-btn')) return
      if (target.closest('.comment-input-attach-btn')) return
      if (target.closest('.comment-popover-action-btn')) return
      if (target.closest('.comment-btn-confirm-delete')) return
      if (target.closest('.comment-btn-cancel-delete')) return
      if (target.closest('.comment-input-icon-btn')) return
      if (target.closest('.comment-input-file-x')) return
      
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

  createEffect(on(() => isEditing(), (editing) => {
    if (editing && editTextarea) autoResizeTextarea(editTextarea)
  }))

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

  const handleSend = (e: MouseEvent) => {
    e.stopPropagation()
    if (!hasContent()) return
    props.onSave(note(), attachments(), pendingFiles())
    props.onClose()
  }

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation()
    props.onDelete?.()
    props.onClose()
  }

  const handleNoteDoubleClick = (e: MouseEvent) => {
    e.stopPropagation()
    setOriginalNote(note())
    setPendingFiles([])
    setIsEditing(true)
  }

  const handleConfirmEdit = (e: MouseEvent) => {
    e.stopPropagation()
    props.onSave(note(), attachments(), pendingFiles())
    setIsEditing(false)
    setPendingFiles([])
  }

  const handleCancelEdit = () => {
    setNote(originalNote())
    setPendingFiles([])
    setIsEditing(false)
  }

  const iframeWidth = props.iframeBounds?.width || 800
  const iframeHeight = props.iframeBounds?.height || 600

  const hasFiles = createMemo(() => pendingFiles().length + attachments().length >= 2)

  const left = createMemo(() => {
    const pw = hasFiles() ? 468 : 320
    const pp = props.target!.pinPosition
    const hoverX = props.target!.hoverPoint?.x
    
    console.log('[DEBUG popover] hoverPoint:', props.target?.hoverPoint)
    console.log('[DEBUG popover] pinPosition:', pp)
    console.log('[DEBUG popover] popoverWidth:', pw)
    console.log('[DEBUG popover] iframeWidth:', iframeWidth)
    
    // 有 pinPosition（点击现有 pin）
    if (pp && hoverX !== undefined) {
      if (hoverX + pw > iframeWidth) {
        return pp.left - pw - 8
      }
      return hoverX
    }
    
    // 新建标注（只有 hoverPoint，没有 pinPosition）
    if (hoverX !== undefined) {
      if (hoverX + pw > iframeWidth) {
        return hoverX - pw - 8
      }
      return hoverX
    }
    
    // Fallback
    return props.target!.position.x * iframeWidth + 20
  })
  const top = createMemo(() => {
    const hoverY = props.target!.hoverPoint?.y
    const popoverHeight = 84
    
    if (hoverY !== undefined) {
      if (hoverY + popoverHeight > iframeHeight) {
        return hoverY - popoverHeight - 8
      }
      return hoverY
    }
    
    return props.target!.position.y * iframeHeight + 20
  })

  return (
    <div
      class={`comment-popover ${isShaking() ? 'comment-popover-shake' : ''} ${props.readOnly ? 'comment-detail-view' : ''}`}
      style={{ left: `${left()}px`, top: `${top()}px`, width: hasFiles() ? '468px' : '320px' }}
    >
      <Show when={props.readOnly}>
        <div class="comment-popover-header">
          <div class="comment-popover-switcher">
            <button
              type="button"
              class="comment-popover-switcher-btn"
              classList={{ "comment-popover-switcher-btn-disabled": !canGoPrev() }}
              disabled={!canGoPrev()}
              onClick={(e) => { e.stopPropagation(); if (canGoPrev()) props.onPrevPin?.() }}
              title="上一条评论"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" style={{ transform: "rotate(90deg)" }}>
                <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor"/>
              </svg>
            </button>
            <button
              type="button"
              class="comment-popover-switcher-btn"
              classList={{ "comment-popover-switcher-btn-disabled": !canGoNext() }}
              disabled={!canGoNext()}
              onClick={(e) => { e.stopPropagation(); if (canGoNext()) props.onNextPin?.() }}
              title="下一条评论"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" style={{ transform: "rotate(-90deg)" }}>
                <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
          <div class="comment-popover-header-right">
            <Show when={!isEditing()}>
              <button class="comment-popover-action-btn" onClick={handleDelete} title="删除">
                <IconDeleteAnnotation size={16} />
              </button>
              <button class="comment-popover-action-btn" onClick={(e) => { e.stopPropagation(); props.onClose() }} title="关闭">
                <IconCloseCancel size={16} />
              </button>
            </Show>
            <Show when={isEditing()}>
              <button class="comment-popover-action-btn" onClick={handleCancelEdit} title="取消编辑">
                <IconCloseCancel size={16} />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.readOnly}>
        <div class="comment-detail-content-wrapper">
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

          <Show when={!isEditing()}>
            <Show when={note()}>
              <div 
                class="comment-popover-note-readonly" 
                onDblClick={handleNoteDoubleClick}
              >
                {note()}
              </div>
            </Show>
          </Show>

          <Show when={isEditing()}>
            <div class="comment-input-field comment-input-field-with-content comment-edit-container">
              <textarea
                ref={editTextarea}
                class="comment-input-text"
                value={note()}
                onInput={(e) => {
                  setNote(e.currentTarget.value)
                  setExternalClickCount(0)
                  autoResizeTextarea(e.currentTarget)
                }}
                placeholder="请在此处添加备注"
                rows={1}
              />

              <Show when={attachments().length > 0}>
                <div class="comment-input-files comment-input-files-single">
                  <For each={attachments()}>
                    {(att) => {
                      const FileIcon = getFileIcon(att.filename.endsWith('.docx') || att.filename.endsWith('.doc') ? 'document' : 'binary', att.filename)
                      return (
                        <div class="comment-input-file comment-input-file-single">
                          <div class="comment-input-file-icon">
                            <FileIcon size={20} />
                          </div>
                          <span class="comment-input-file-name" title={att.filename}>
                            {truncateFilenameForDisplay(att.filename)}
                          </span>
                          <button
                            class="comment-input-file-x"
                            onClick={(e) => { e.stopPropagation(); props.onDeleteAttachment?.(att.id) }}
                          >
                            <IconCloseCancel size={10} />
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>

              <div class="comment-input-icons">
                <label class="comment-input-icon-btn" title="添加附件" style={{ display: "none" }}>
                  <IconAnnotationAttach size={16} />
                  <input
                    type="file"
                    multiple
                    accept="*/*"
                    onChange={handleFileInput}
                    style={{ display: "none" }}
                  />
                </label>
                <button
                  class="comment-input-icon-btn comment-input-send-btn"
                  classList={{ "comment-input-send-active": hasContent() }}
                  onClick={handleConfirmEdit}
                  disabled={!hasContent()}
                >
                  <Show when={hasContent()} fallback={<IconSendDefault size={16} />}>
                    <IconSendActive size={28} />
                  </Show>
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.readOnly && !isEditing()}>
        <Show when={attachments().length > 0}>
          <div class="comment-popover-attachments-readonly">
            <div class="comment-popover-attachments-grid">
              <For each={attachments()}>
                {(att) => {
                  const FileIcon = getFileIcon(att.filename.endsWith('.docx') || att.filename.endsWith('.doc') ? 'document' : 'binary', att.filename)
                  return (
                    <div class="comment-popover-attachment-item">
                      <div class="comment-popover-attachment-icon">
                        <FileIcon size={20} />
                      </div>
                      <span class="comment-popover-attachment-name">
                        {truncateFilenameForDisplay(att.filename)}
                      </span>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={!props.readOnly}>
        <div class="comment-input-field" classList={{ "comment-input-field-with-content": hasContent() }}>
          <textarea
            ref={newTextarea}
            class="comment-input-text"
            value={note()}
            onInput={(e) => {
              setNote(e.currentTarget.value)
              setExternalClickCount(0)
              autoResizeTextarea(e.currentTarget, 88)
            }}
            placeholder="请在此处添加备注"
            rows={1}
          />

          <Show when={pendingFiles().length > 0 || attachments().length > 0}>
            <div class="comment-input-files" classList={{ "comment-input-files-single": pendingFiles().length + attachments().length === 1 }}>
              <For each={pendingFiles()}>
                {(file) => {
                  const FileIcon = getFileIcon(file.name.endsWith('.docx') || file.name.endsWith('.doc') ? 'document' : 'binary', file.name)
                  return (
                    <div class="comment-input-file" classList={{ "comment-input-file-single": pendingFiles().length + attachments().length === 1 }}>
                      <div class="comment-input-file-icon">
                        <FileIcon size={20} />
                      </div>
                      <span class="comment-input-file-name" title={file.name}>
                        {truncateFilenameForDisplay(file.name)}
                      </span>
                      <button
                        class="comment-input-file-x"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPendingFiles(prev => prev.filter(f => f !== file))
                        }}
                      >
                        <IconCloseCancel size={10} />
                      </button>
                    </div>
                  )
                }}
              </For>

              <For each={attachments()}>
                {(att) => {
                  const FileIcon = getFileIcon(att.filename.endsWith('.docx') || att.filename.endsWith('.doc') ? 'document' : 'binary', att.filename)
                  return (
                    <div class="comment-input-file" classList={{ "comment-input-file-single": pendingFiles().length + attachments().length === 1 }}>
                      <div class="comment-input-file-icon">
                        <FileIcon size={20} />
                      </div>
                      <span class="comment-input-file-name" title={att.filename}>
                        {truncateFilenameForDisplay(att.filename)}
                      </span>
                      <button
                        class="comment-input-file-x"
                        onClick={(e) => { e.stopPropagation(); props.onDeleteAttachment?.(att.id) }}
                      >
                        <IconCloseCancel size={10} />
                      </button>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>

          <div class="comment-input-icons">
            <label class="comment-input-icon-btn" title="添加附件" style={{ display: "none" }}>
              <IconAnnotationAttach size={16} />
              <input
                type="file"
                multiple
                accept="*/*"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
            </label>
            <button
              class="comment-input-icon-btn comment-input-send-btn"
              classList={{ "comment-input-send-active": hasContent() }}
              onClick={handleSend}
              disabled={!hasContent()}
            >
              <Show when={hasContent()} fallback={<IconSendDefault size={16} />}>
                <IconSendActive size={28} />
              </Show>
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
