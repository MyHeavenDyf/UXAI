import { createSignal, Show, onMount, createEffect, on, type JSX } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { ModelEditElement } from '../model-edit-items/types'
import type { MentionAttrs } from '../prosemirror-editor/schema'
import { ProseMirrorEditor } from '../prosemirror-editor'
import type { MentionSelection } from '../mention-popover'
import type { ArtifactFile } from '../../utils/artifact-file-api'
import type { SkillConfig } from '../skill-config-types'
import { sendTextToAgent, appendToMainComposer, submitMainComposer } from '../../utils/agent-events'
import { processMentions } from '../../utils/mention-processor'
import './model-edit-area-dialog.css'

type EditorRef = {
  getText: () => string
  getMentions: () => MentionAttrs[]
  clear: () => void
  insertText: (text: string) => void
  isAlive: () => boolean
  closeMention: () => void
}

const MASK_COLOR = 'rgba(0,0,0,0.3)'

export function ModelEditAreaDialog(props: {
  element: ModelEditElement | null
  iframeRect?: DOMRect
  filePath: string
  tabTitle: string
  disabled?: boolean
  sessionId?: string
  skillConfig?: SkillConfig
  artifactFiles?: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null
  productId?: number
  onDownloadProductAsset?: (file: import('../addon-menu/asset-library').AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
  onUpdateMentionPath?: (id: string, path: string) => void
  onClose: () => void
  onSubmitStart?: () => void
  onMentionActiveChange?: (active: boolean) => void
  closeMentionTrigger?: number
  promptCallback?: (filePath: string, selector: string) => string
}): JSX.Element {
  const [submitting, setSubmitting] = createSignal(false)
  const [mentionSelections, setMentionSelections] = createSignal<MentionSelection[]>([])
  const [dragPos, setDragPos] = createStore<{ left: number | null; top: number | null }>({ left: null, top: null })
  let editorRef: EditorRef | undefined
  let dialogRef: HTMLDivElement | undefined
  let parentRef: HTMLDivElement | undefined

  const [cRect, setCRect] = createSignal<DOMRect | null>(null)

  onMount(() => {
    if (parentRef) {
      setCRect(parentRef.getBoundingClientRect())
    }
  })

  createEffect(on(() => props.closeMentionTrigger, (n) => {
    if (n && n > 0) editorRef?.closeMention?.()
  }))

  const isDisabled = () => submitting() || !!props.disabled

  const containerRect = () => cRect()

  const elementPos = () => {
    const el = props.element
    const cRect = containerRect()
    if (!el || !cRect) return null
    const iframeRect = props.iframeRect
    if (!iframeRect) return null
    const offsetX = iframeRect.left - cRect.left
    const offsetY = iframeRect.top - cRect.top
    return {
      x: offsetX + el.rect.x,
      y: offsetY + el.rect.y,
      width: el.rect.width,
      height: el.rect.height,
    }
  }

  const dialogPosition = (): JSX.CSSProperties => {
    if (dragPos.left !== null && dragPos.top !== null) {
      return { left: `${dragPos.left}px`, top: `${dragPos.top}px` }
    }
    const rect = elementPos()
    const cRect = containerRect()
    if (!rect || !cRect) {
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    }
    const dialogWidth = 400
    const dialogHeight = 250
    const containerW = cRect.width
    const containerH = cRect.height

    let left = rect.x + rect.width / 2 - dialogWidth / 2
    left = Math.max(8, Math.min(left, containerW - dialogWidth - 8))

    let top = rect.y + rect.height + 16
    if (top + dialogHeight > containerH - 8) {
      top = Math.max(8, rect.y - dialogHeight - 16)
    }

    return { left: `${left}px`, top: `${top}px` }
  }

  const maskPieces = (): JSX.Element => {
    const rect = elementPos()
    const cRect = containerRect()
    if (!rect || !cRect) {
      return <div style={{ position: 'absolute', inset: 0, background: MASK_COLOR, 'z-index': 10, 'pointer-events': 'none' }} />
    }
    const cw = cRect.width
    const ch = cRect.height
    const ex = rect.x
    const ey = rect.y
    const ew = rect.width
    const eh = rect.height
    return (
      <>
        <div style={{ position: 'absolute', left: '0', top: '0', width: `${cw}px`, height: `${ey}px`, background: MASK_COLOR, 'z-index': 10, 'pointer-events': 'none' }} />
        <div style={{ position: 'absolute', left: '0', top: `${ey + eh}px`, width: `${cw}px`, height: `${ch - ey - eh}px`, background: MASK_COLOR, 'z-index': 10, 'pointer-events': 'none' }} />
        <div style={{ position: 'absolute', left: '0', top: `${ey}px`, width: `${ex}px`, height: `${eh}px`, background: MASK_COLOR, 'z-index': 10, 'pointer-events': 'none' }} />
        <div style={{ position: 'absolute', left: `${ex + ew}px`, top: `${ey}px`, width: `${cw - ex - ew}px`, height: `${eh}px`, background: MASK_COLOR, 'z-index': 10, 'pointer-events': 'none' }} />
        <div style={{ position: 'absolute', left: `${ex}px`, top: `${ey}px`, width: `${ew}px`, height: `${eh}px`, border: '2px solid #007bff', 'border-radius': '4px', background: 'rgba(0,123,255,0.1)', 'z-index': 10, 'pointer-events': 'none' }} />
      </>
    )
  }

  const startDrag = (e: MouseEvent) => {
    if (isDisabled() || !dialogRef) return
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startLeft = dialogRef.offsetLeft
    const startTop = dialogRef.offsetTop

    const move = (ev: MouseEvent) => {
      setDragPos({ left: startLeft + ev.clientX - startX, top: startTop + ev.clientY - startY })
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const buildPrefix = () => {
    if (props.promptCallback) {
      return props.promptCallback(props.filePath, props.element?.selector || '')
    }
    const lines: string[] = []
    if (props.filePath) lines.push(`[文件路径: ${props.filePath}]`)
    if (props.tabTitle) lines.push(`[页面: ${props.tabTitle}]`)
    if (props.element?.selector) lines.push(`[元素选择器: ${props.element.selector}]`)
    return lines.join('\n')
  }

  const buildFullText = () => {
    const text = editorRef?.getText?.() || ''
    const mentions = editorRef?.getMentions?.() || []
    const { processed } = processMentions(text, mentions)
    const prefix = buildPrefix()
    return prefix ? `${prefix}\n\n${processed}` : processed
  }

  const handleNext = () => {
    if (isDisabled()) return
    const text = editorRef?.getText?.() || ''
    if (!text.trim()) return
    const fullText = buildFullText()
    appendToMainComposer(fullText)
    editorRef?.clear?.()
    setMentionSelections([])
  }

  const handleConfirm = async () => {
    if (isDisabled()) return
    const fullText = buildFullText()
    appendToMainComposer(fullText)
    setSubmitting(true)
    props.onSubmitStart?.()
    submitMainComposer()
    setSubmitting(false)
  }

  return (
    <div ref={parentRef} style={{ position: 'absolute', inset: 0, 'pointer-events': 'none', cursor: isDisabled() ? 'wait' : 'default' }}>
      {maskPieces()}
      <div
        ref={dialogRef}
        class="model-edit-area-dialog"
        style={{ ...dialogPosition(), cursor: isDisabled() ? 'wait' : 'default' }}
      >
        <div class="model-edit-area-header" onMouseDown={startDrag}>
          <span>修改选中区域</span>
        </div>
        <div class="model-edit-area-body">
          <ProseMirrorEditor
            sessionId={props.sessionId || ''}
            skillConfig={props.skillConfig ?? {}}
            artifactFiles={props.artifactFiles ?? null}
            mentionSelections={mentionSelections()}
            setMentionSelections={setMentionSelections}
            disabled={isDisabled()}
            autofocus={true}
            placeholder="描述你想要的修改..."
            onSubmit={handleConfirm}
            onTriggerStateChange={(active) => props.onMentionActiveChange?.(active)}
            ref={(el: EditorRef) => { editorRef = el }}
            productId={props.productId}
            onDownloadProductAsset={props.onDownloadProductAsset}
            onUpdateMentionPath={props.onUpdateMentionPath}
          />
        </div>
        <div class="model-edit-area-footer">
          <button
            type="button"
            class="model-edit-area-btn subtle"
            disabled={isDisabled()}
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            type="button"
            class="model-edit-area-btn secondary"
            disabled={isDisabled()}
            onClick={handleNext}
          >
            下一项
          </button>
          <button
            type="button"
            class="model-edit-area-btn primary"
            disabled={isDisabled()}
            onClick={handleConfirm}
          >
            {submitting() ? '...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
