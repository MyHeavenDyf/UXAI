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

export function CommentPopover(props: {
  target: CommentPopoverTarget | null
  comment: FileComment | null
  iframeBounds?: { width: number; height: number }
  externalClickSignal?: number
  onSave: (note: string, attachments: CommentAttachment[], pendingFiles: File[]) => void
  onDelete?: () => void
  onClose: () => void
  onUploadAttachment?: (file: File) => void
  onDeleteAttachment?: (attachmentId: string) => void
}): JSX.Element {
  const [note, setNote] = createSignal(props.comment?.note || "")
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [externalClickCount, setExternalClickCount] = createSignal(0)
  const [isShaking, setIsShaking] = createSignal(false)
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([])
  const attachments = () => props.comment?.attachments || []

  if (!props.target) return null

  // 监听外部点击信号（来自 iframe 内部点击）
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

  // 监听父窗口 click 事件（检测点击评论框以外的区域）
  createEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      // 如果 target.parentElement 是 undefined，说明 DOM 元素被移除
      // 这种情况通常是内部按钮点击导致的 SolidJS 重新渲染
      // 应该忽略这次点击，不触发外部点击逻辑
      if (!target.parentElement) {
        return
      }
      
      // 检查点击目标是否是 iframe
      if (target.tagName === 'IFRAME') {
        return
      }
      
      // 使用 closest 查找评论框
      const popover = target.closest('.comment-popover')
      
      if (!popover) {
        // 点击不在评论框内部
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
    
    // 如果是编辑现有评论，直接上传
    if (props.comment) {
      for (const file of Array.from(files)) {
        props.onUploadAttachment?.(file)
      }
    } else {
      // 新评论，添加到 pendingFiles（待上传）
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
        <span class="comment-popover-label">{props.target.label}</span>
        <button class="comment-popover-close" onClick={(e) => { e.stopPropagation(); props.onClose() }}>×</button>
      </div>

      <div class="comment-popover-info">
        <div class="comment-popover-selector">{props.target.selector}</div>
      </div>

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

      <div class="comment-popover-attachments">
        <div class="comment-popover-attachments-header">
          <span>附件 ({attachments().length + pendingFiles().length})</span>
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
        </div>

        <Show when={pendingFiles().length > 0 || attachments().length > 0}>
          <div class="comment-popover-attachments-grid">
            {/* 显示待上传的文件 */}
            <For each={pendingFiles()}>
              {(file) => (
                <div class="comment-popover-attachment-item pending">
                  <div class="comment-popover-attachment-icon">
                    <IconFileOther size={24} />
                  </div>
                  <span class="comment-popover-attachment-name">
                    {truncateFilenameWithExt(file.name)}
                  </span>
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
                </div>
              )}
            </For>
            
            {/* 显示已上传的附件 */}
            <For each={attachments()}>
              {(att) => (
                <div class="comment-popover-attachment-item">
                  <div class="comment-popover-attachment-icon">
                    <IconFileOther size={24} />
                  </div>
                  <span class="comment-popover-attachment-name">
                    {truncateFilenameWithExt(att.filename)}
                  </span>
                  <button
                    class="comment-popover-attachment-delete"
                    onClick={(e) => { e.stopPropagation(); props.onDeleteAttachment?.(att.id) }}
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

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
          <button class="comment-btn-cancel" onClick={(e) => { e.stopPropagation(); props.onClose() }}>
            取消
          </button>
          <button class="comment-btn-save" onClick={handleSave}>
            保存
          </button>
        </Show>
      </div>
    </div>
  )
}