import { createSignal, For, Show } from "solid-js"

export interface Annotation {
  id: string
  elementId: string
  author: string
  authorInitial: string
  text: string
  attachments: string[]
  createdAt: number
}

export interface AnnotationTarget {
  elementId: string
  elementRect: { top: number; left: number; width: number; height: number }
}

interface AnnotationPopupProps {
  target: AnnotationTarget
  author: string
  annotations: Annotation[]
  onSend: (text: string, attachments: string[]) => void
  onClose: () => void
}

export function AnnotationPopup(props: AnnotationPopupProps) {
  const [text, setText] = createSignal("")
  const [attachments, setAttachments] = createSignal<string[]>([])
  let fileInputRef: HTMLInputElement | undefined

  const authorInitial = props.author.charAt(0).toUpperCase() || "U"

  function handleSend() {
    const trimmed = text().trim()
    if (!trimmed && attachments().length === 0) return
    props.onSend(trimmed, attachments())
    setText("")
    setAttachments([])
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement
    if (input.files) {
      const names = Array.from(input.files).map((f) => f.name)
      setAttachments([...attachments(), ...names])
    }
    input.value = ""
  }

  function removeAttachment(index: number) {
    setAttachments(attachments().filter((_, i) => i !== index))
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* 紫色圆形头像 — 定位在元素右上角 */}
      <div
        class="annotation-badge"
        style={{
          top: props.target.elementRect.top - 12 + "px",
          left: props.target.elementRect.left + props.target.elementRect.width - 12 + "px",
        }}
        title={props.author}
      >
        {authorInitial}
      </div>

      {/* 高亮框 — 标注目标元素 */}
      <div
        class="annotation-highlight"
        style={{
          top: props.target.elementRect.top + "px",
          left: props.target.elementRect.left + "px",
          width: props.target.elementRect.width + "px",
          height: props.target.elementRect.height + "px",
        }}
      />

      {/* 标注弹框 — 紧跟在紫色头像右侧 */}
      <div
        class="annotation-popup"
        style={{
          top: props.target.elementRect.top - 20 + "px",
          left: props.target.elementRect.left + props.target.elementRect.width + 20 + "px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 已有标注列表 */}
        <Show when={props.annotations.length > 0}>
          <div class="annotation-list">
            <For each={props.annotations}>
              {(ann) => (
                <div class="annotation-item">
                  <div class="annotation-item-avatar">{ann.authorInitial}</div>
                  <div class="annotation-item-content">
                    <div class="annotation-item-author">{ann.author}</div>
                    <Show when={ann.text}>
                      <div class="annotation-item-text">{ann.text}</div>
                    </Show>
                    <Show when={ann.attachments.length > 0}>
                      <div class="annotation-item-attachments">
                        <For each={ann.attachments}>
                          {(file) => <span class="annotation-attachment-tag">{file}</span>}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* 输入区域 */}
        <div class="annotation-input-area">
          <div class="annotation-input-content">
            <textarea
              class="annotation-textarea"
              placeholder="添加标注评论..."
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              rows={3}
            />
          </div>
          <Show when={attachments().length > 0}>
            <div class="annotation-pending-files">
              <For each={attachments()}>
                {(file, i) => (
                  <span class="annotation-attachment-tag">
                    {file}
                    <button class="annotation-attachment-remove" onClick={() => removeAttachment(i())}>
                      x
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>
          {/* 底部操作栏 — 右对齐 */}
          <div class="annotation-actions">
            <input
              ref={(el) => { fileInputRef = el }}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
            <button class="annotation-upload-btn" title="上传文件" onClick={() => fileInputRef?.click()}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button class="annotation-send-btn" title="发送" onClick={handleSend}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3L22 12L3 21L9 12Z" />
                <line x1="9" y1="12" x2="22" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
