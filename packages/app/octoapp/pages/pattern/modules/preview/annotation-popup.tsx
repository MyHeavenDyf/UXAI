import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"

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
  active?: boolean
  onSend: (text: string, attachments: File[]) => void
  onClose: () => void
}

export function AnnotationPopup(props: AnnotationPopupProps) {
  const [text, setText] = createSignal("")
  const [attachments, setAttachments] = createSignal<File[]>([])
  const [drag, setDrag] = createStore({ x: 0, y: 0 })
  let fileInputRef: HTMLInputElement | undefined

  const authorInitial = props.author.charAt(0).toUpperCase() || "U"
  const strokeColor = props.active ? "#0A59F7" : "rgba(0,0,0,0.1)"

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
      setAttachments([...attachments(), ...Array.from(input.files)])
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
      {/* 标注图标 logo — 定位在元素右上角，内含紫色圆与首字母 */}
      <div
        class="annotation-badge"
        style={{
          top: props.target.elementRect.top - 28 + "px",
          left: props.target.elementRect.left + props.target.elementRect.width - 14 + "px",
        }}
        title={props.author}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" class="annotation-badge-icon">
          <g transform="rotate(45 12 12)">
            <path
              d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"
              fill="#ffffff"
              stroke={strokeColor}
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <circle cx="12" cy="10" r="7" fill="#7B1AFF" />
          </g>
          <text
            x="13.4"
            y="10.6"
            text-anchor="middle"
            dominant-baseline="central"
            fill="#ffffff"
            font-size="7"
            font-weight="700"
            font-family="inherit"
          >
            {authorInitial}
          </text>
        </svg>
      </div>

      {/* 高亮框 — 标注目标元素 */}
        <div
          class="annotation-highlight annotation-highlight-active"
          style={{
            top: props.target.elementRect.top + "px",
            left: props.target.elementRect.left + "px",
            width: props.target.elementRect.width + "px",
            height: props.target.elementRect.height + "px",
            border: '2px solid #007bff',
            background: 'rgba(0, 123, 255, 0.08)',
          }}
        />

      {/* 标注弹框 — 紧跟在标注图标右侧 */}
      <div
        class="annotation-popup"
        style={{
          top: props.target.elementRect.top - 28 + "px",
          left: props.target.elementRect.left + props.target.elementRect.width + 28 + "px",
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
                    {file.name}
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
            <button class="annotation-upload-btn" title="日志" onClick={() => fileInputRef?.click()}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
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
