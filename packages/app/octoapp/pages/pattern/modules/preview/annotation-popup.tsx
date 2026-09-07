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
  avatar?: string
}

export interface AnnotationTarget {
  elementId: string
  elementRect: { top: number; left: number; width: number; height: number }
}

interface AnnotationPopupProps {
  target: AnnotationTarget
  author: string
  authorAvatar?: string
  annotations: Annotation[]
  active?: boolean
  onSend: (text: string, attachments: File[]) => void
  onClose: () => void
  onDelete?: () => void
  onEdit?: (id: string, text: string, attachments: File[]) => void
}

export function AnnotationPopup(props: AnnotationPopupProps) {
  const [text, setText] = createSignal("")
  const [attachments, setAttachments] = createSignal<File[]>([])
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [drag, setDrag] = createStore({ x: 0, y: 0 })
  let fileInputRef: HTMLInputElement | undefined

  const strokeColor = props.active ? "#0A59F7" : "rgba(0,0,0,0.1)"

  function handleSend() {
    const trimmed = text().trim()
    console.log("[AnnotationPopup] handleSend", { text: trimmed, attachmentsCount: attachments().length, onSendType: typeof props.onSend })
    if (!trimmed && attachments().length === 0) return
    try {
      props.onSend(trimmed, attachments())
    } catch (e) {
      console.error("[AnnotationPopup] onSend threw", e)
    }
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

  function handleEditSend() {
    const id = editingId()
    if (!id) return
    const trimmed = text().trim()
    if (!trimmed && attachments().length === 0) return
    props.onEdit?.(id, trimmed, attachments())
    setText("")
    setAttachments([])
    setEditingId(null)
  }

  function startEdit(ann: Annotation) {
    if (editingId() === ann.id) return
    setEditingId(ann.id)
    setText(ann.text)
    setAttachments([])
  }

  function formatTime(ts: number) {
    const d = new Date(ts)
    const pad = (n: number) => n.toString().padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
          </g>
        </svg>
        <img src={props.authorAvatar || "/AvatarUser.svg"} class="annotation-badge-avatar" />
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
        {/* 顶部操作栏 — 仅已有标注时显示 */}
        <Show when={props.annotations.length > 0}>
        <div class="annotation-toolbar">
          <div class="annotation-toolbar-left">
            <button class="annotation-nav-btn" disabled title="上一条">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button class="annotation-nav-btn" disabled title="下一条">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <div class="annotation-toolbar-right">
            <Show when={props.onDelete && props.annotations.length > 0}>
              <button class="annotation-toolbar-btn annotation-delete-btn" title="删除批注" onClick={() => props.onDelete?.()}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                  <path d="M9.96633 7.79333C10.0952 7.79333 10.2086 7.74444 10.3063 7.64667C10.3997 7.55333 10.4463 7.43555 10.4463 7.29333C10.4463 7.00889 10.5197 6.74 10.6663 6.48667C10.8086 6.23778 11.0041 6.04 11.253 5.89333C11.5063 5.75111 11.7774 5.68 12.0663 5.68C12.3508 5.68 12.6197 5.75111 12.873 5.89333C13.1219 6.04 13.3197 6.23778 13.4663 6.48667C13.6086 6.74 13.6797 7.00889 13.6797 7.29333C13.6797 7.43555 13.7286 7.55333 13.8263 7.64667C13.9197 7.74444 14.0352 7.79333 14.173 7.79333L17.9997 7.79333C18.1374 7.79333 18.2552 7.74444 18.353 7.64667C18.4463 7.55333 18.493 7.43555 18.493 7.29333C18.493 7.15555 18.4463 7.04 18.353 6.94667C18.2552 6.84889 18.1374 6.8 17.9997 6.8L14.6063 6.8C14.4997 6.20444 14.2063 5.70667 13.7263 5.30666C13.2463 4.90666 12.6863 4.70667 12.0463 4.70667C11.4197 4.70667 10.8686 4.90666 10.393 5.30666C9.91744 5.70667 9.62188 6.20444 9.50633 6.8L5.98633 6.8C5.84411 6.8 5.72633 6.84889 5.63299 6.94667C5.53522 7.04 5.48633 7.15555 5.48633 7.29333C5.48633 7.43555 5.53522 7.55333 5.63299 7.64667C5.72633 7.74444 5.84411 7.79333 5.98633 7.79333L9.96633 7.79333ZM13.233 16.0933C13.3708 16.0933 13.4886 16.0489 13.5863 15.96C13.6797 15.8711 13.733 15.7556 13.7463 15.6133L13.9063 10.7067C13.9152 10.5644 13.8686 10.4444 13.7663 10.3467C13.6641 10.2444 13.5441 10.1867 13.4063 10.1733C13.2774 10.1733 13.1663 10.22 13.073 10.3133C12.9752 10.4022 12.9263 10.5156 12.9263 10.6533L12.733 15.5667C12.7241 15.7044 12.7708 15.8244 12.873 15.9267C12.9752 16.0289 13.0952 16.0844 13.233 16.0933ZM10.7863 16.0933C10.9241 16.0844 11.0441 16.0289 11.1463 15.9267C11.2441 15.8244 11.2886 15.7044 11.2797 15.5667L11.073 10.6533C11.073 10.5156 11.0263 10.4022 10.933 10.3133C10.8441 10.22 10.7241 10.1733 10.573 10.1733C10.4352 10.1867 10.3197 10.2444 10.2263 10.3467C10.1286 10.4444 10.0841 10.5644 10.093 10.7067L10.273 15.6133C10.2952 15.7556 10.3508 15.8711 10.4397 15.96C10.5286 16.0489 10.6441 16.0933 10.7863 16.0933ZM15.693 17.4733C15.6619 17.7178 15.5619 17.9178 15.393 18.0733C15.2197 18.2289 15.0174 18.3067 14.7863 18.3067L9.213 18.3067C8.98188 18.3067 8.77744 18.2289 8.59966 18.0733C8.42188 17.9178 8.32411 17.7178 8.30633 17.4733L7.613 8.67333L6.63966 8.67333L7.32633 17.5667C7.34855 17.9 7.44855 18.1956 7.62633 18.4533C7.79966 18.7156 8.02633 18.9222 8.30633 19.0733C8.58188 19.22 8.88411 19.2933 9.213 19.2933L14.7863 19.2933C15.1152 19.2933 15.4152 19.22 15.6863 19.0733C15.9574 18.9222 16.1819 18.7156 16.3597 18.4533C16.5374 18.1956 16.6419 17.9 16.673 17.5667L17.3463 8.67333L16.3663 8.67333L15.693 17.4733Z" fill="currentColor"/>
                </svg>
              </button>
            </Show>
            <button class="annotation-toolbar-btn annotation-close-btn" title="关闭" onClick={() => props.onClose()}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                <path d="M17.187 7.52a.48.48 0 0 0 .14-.36.48.48 0 0 0-.14-.347.52.52 0 0 0-.353-.16.52.52 0 0 0-.354.16L12 11.293l-4.48-4.48a.52.52 0 0 0-.353-.16.52.52 0 0 0-.367.16.48.48 0 0 0-.127.347c0 .133.043.253.127.36L11.294 12 6.8 16.467a.48.48 0 0 0-.127.367c0 .137.043.255.127.353a.52.52 0 0 0 .367.133.48.48 0 0 0 .353-.133L12 12.707l4.48 4.48a.48.48 0 0 0 .354.14.48.48 0 0 0 .353-.14.48.48 0 0 0 .14-.354.48.48 0 0 0-.14-.353L12.707 12l4.48-4.48Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
        </Show>
        {/* 已有标注列表 */}
        <Show when={props.annotations.length > 0}>
          <div class="annotation-list">
            <For each={props.annotations}>
              {(ann) => (
                <div class="annotation-item" onDblClick={(e) => { e.stopPropagation(); startEdit(ann) }}>
                  <img src={ann.avatar || "/AvatarUser.svg"} class="annotation-item-avatar" />
                  <div class="annotation-item-content">
                    <div class="annotation-item-author">
                      {ann.author}
                      <span class="annotation-item-time">{formatTime(ann.createdAt)}</span>
                    </div>
                    <Show when={editingId() === ann.id} fallback={
                      <>
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
                      </>
                    }>
                      <div class="annotation-edit-area">
                        <textarea
                          class="annotation-edit-textarea"
                          placeholder="编辑标注..."
                          value={text()}
                          onInput={(e) => setText(e.currentTarget.value)}
                          rows={3}
                          onClick={(e) => e.stopPropagation()}
                        />
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
                        <div class="annotation-actions annotation-edit-actions">
                          <input
                            ref={(el) => { fileInputRef = el }}
                            type="file"
                            multiple
                            style={{ display: "none" }}
                            onChange={handleFileSelect}
                          />
                          <button class="annotation-upload-btn" title="附件" onClick={() => fileInputRef?.click()}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="8" y1="13" x2="16" y2="13" />
                              <line x1="8" y1="17" x2="13" y2="17" />
                            </svg>
                          </button>
                          <button class="annotation-send-btn" title="发送" onClick={handleEditSend}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 3L22 12L3 21L9 12Z" />
                              <line x1="9" y1="12" x2="22" y2="12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* 输入区域 */}
        <Show when={props.annotations.length === 0}>
          <div class="annotation-input-area" classList={{ 'annotation-input-collapsed': text().trim().length === 0 && attachments().length === 0 }}>
            <div class="annotation-input-content">
              <textarea
                class="annotation-textarea"
                placeholder="添加标注..."
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
            <div class="annotation-actions">
              <input
                ref={(el) => { fileInputRef = el }}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              <button class="annotation-upload-btn" title="附件" onClick={() => fileInputRef?.click()}>
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
        </Show>
      </div>
    </>
  )
}
