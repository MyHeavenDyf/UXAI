import { createMemo, createSignal, createEffect, on, onMount, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { buildSrcdoc, annotateElementsWithIds } from "../../utils/srcdoc-builder"
import { cleanBridgeContent } from "../../utils/bridge-cleaner"
import { getArtifactServeUrl, getArtifactRelativePath, pathToLocalUrl, isElectronDesktop, extractCommentFilePath } from "../../utils/artifact-file-api"
import { directoryHeader } from "@/utils/headers"
import { getDesktopApi } from "../../lib/electron-api"
import { PreviewOverlay } from "../preview-overlay"
import { InspectPanel } from "./inspect-panel"
import { ManualEditPanel, emptyManualEditDraft, type ManualEditDraft } from "./manual-edit-panel"
import { DrawOverlay } from "./draw-overlay"
import { CommentHoverTooltip } from "./comment-hover-tooltip"
import { CommentPopover, type FileComment } from "./comment-popover"
import { ArchiveDialog, type ArchiveConfirmData } from "@/components/dialog-archive"
import { DialogArchiveSuccess } from "@/components/dialog-archive-success"
import { createArchiveZip, capturePageScreenshot, transformCommentsForArchive, buildArchivePath, createDeliverable, uploadCover, uploadVersion, getArchiveBaseUrl, getNextAvailableFileName } from "../../utils/archive-utils"
import type { ManualEditTarget, ManualEditPatch, ManualEditStyles } from "../../edit-mode/source-patches"
import { readManualEditFields, readManualEditAttributes, readManualEditOuterHtml, inspectorManualEditStyles, applyManualEditPatch, emptyManualEditStyles, MANUAL_EDIT_STYLE_PROPS } from "../../edit-mode/source-patches"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"
import { TaskStore } from "@/context/task"
import "./inspect-panel.css"
import "./manual-edit-panel.css"

// Helper: Extract artifact filename from absolute or relative path
function getArtifactFilename(filePath: string | undefined): string {
  if (!filePath) return ''
  // Handle both Windows (D:\path\file.html) and Unix (/path/file.html) paths
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || ''
}

// Helper: Get commenter info from localStorage.userInfo
function getCommenterInfo(): { commenterName: string; commenterAccount: string; commenterAvatar: string } {
  try {
    const userInfoStr = localStorage.getItem("userInfo")
    if (!userInfoStr) {
      return { commenterName: "用户名", commenterAccount: "", commenterAvatar: "" }
    }
    const obj = JSON.parse(userInfoStr)
    const nickName = obj.nickName || "用户名"
    const account = obj.account || ""
    const avatarUrl = account
      ? `https://octo.hdesign.huawei.com/w3lab/rest/yellowpage/face/${account.replace(/^[a-zA-Z]/, '')}/120?ts=${Date.now()}`
      : ""
    return { commenterName: nickName, commenterAccount: account, commenterAvatar: avatarUrl }
  } catch {
    return { commenterName: "用户名", commenterAccount: "", commenterAvatar: "" }
  }
}

// History management for Undo/Redo
interface HistoryState {
  html: string
  description: string
}

const MAX_HISTORY = 50

// ★ Cache annotated HTML (ensure element IDs match between iframe and flush)
const [annotatedHtmlCache, setAnnotatedHtmlCache] = createSignal<string>("")

export type InspectTarget = {
  elementId: string | null
  tag: string
  selector: string
  text: string
  position: { x: number; y: number; width: number; height: number }
  style: Record<string, string>
  htmlHint: string
}

export type PaletteId = "coral" | "electric" | "acid-forest" | "risograph" | "mono-noir"

export type ViewportPreset = "desktop" | "tablet" | "mobile"

export const PALETTE_PRESETS: { id: PaletteId; label: string; colors: string[] }[] = [
  { id: "coral", label: "Coral", colors: ["#ff5a3c", "#ff7a5c", "#fde2d6"] },
  { id: "electric", label: "Electric", colors: ["#7c3aed", "#a855f7", "#e9d5ff"] },
  { id: "acid-forest", label: "Acid Forest", colors: ["#16a34a", "#22c55e", "#bbf7d0"] },
  { id: "risograph", label: "Risograph", colors: ["#e11d48", "#2563eb", "#fde68a"] },
  { id: "mono-noir", label: "Mono Noir", colors: ["#0a0a0a", "#262626", "#e5e5e5"] },
]

const VIEWPORT_DIMS: Record<ViewportPreset, { width: number | null; height: number | null }> = {
  desktop: { width: null, height: null },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
}

function extractHtmlContent(text: string): string {
  const re = /```html\s*\n([\s\S]*?)\n?```/i
  const m = text.match(re)
  if (m) return m[1].trim()
  if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) return text.trim()
  return text.trim()
}

function wrapHtmlContent(html: string, originalText: string): string {
  const re = /```html\s*\n([\s\S]*?)\n?```/i
  const m = originalText.match(re)
  if (m && m.index !== undefined) {
    const before = originalText.slice(0, m.index)
    const after = originalText.slice(m.index + m[0].length)
    return `${before}\`\`\`html\n${html}\n\`\`\`${after}`
  }
  return html
}

function effectiveScale(
  preset: ViewportPreset,
  canvasW: number,
  canvasH: number,
): number {
  const dims = VIEWPORT_DIMS[preset]
  if (!dims.width || !dims.height) return 1
  const pad = 48
  const availW = Math.max(1, canvasW - pad)
  const availH = Math.max(1, canvasH - pad)
  return Math.min(1, availW / dims.width, availH / dims.height)
}

export function HtmlRenderer(props: {
  content: string
  mode: "preview" | "edit"
  viewport?: ViewportPreset
  palette?: PaletteId | null
  inspecting?: boolean
  editing?: boolean
  drawing?: boolean
  commenting?: boolean
  archiving?: boolean
  onDrawActiveChange?: (active: boolean) => void
  onResetArchiving?: () => void
  inspectPanel?: boolean
  onInspectTarget?: (target: InspectTarget | null) => void
  onSaveOverrides?: (overrides: Array<{ elementId: string; prop: string; value: string }>) => void
  onContentChange?: (content: string) => Promise<void>
  refreshKey?: number
  filePath?: string
  commentFilePath?: string
  sessionId?: string
  sdkUrl?: string
  sdkDirectory?: string
  onSaveFile?: (content: string) => Promise<void>
  onRefreshNeeded?: () => void
  tabTitle?: string
}): JSX.Element {
  let iframeRef: HTMLIFrameElement | undefined
  const [inspectTarget, setInspectTarget] = createSignal<InspectTarget | null>(null)
  const [hoveringInspectPanel, setHoveringInspectPanel] = createSignal(false)
  const [savedOverrides, setSavedOverrides] = createSignal<Array<{ elementId: string; prop: string; value: string }>>([])
  const [editTarget, setEditTarget] = createSignal<ManualEditTarget | null>(null)
  const [editDraft, setEditDraft] = createSignal<ManualEditDraft>(emptyManualEditDraft(props.content))
  const [editStyleVersion, setEditStyleVersion] = createSignal(0)
  const [editPanelPosition, setEditPanelPosition] = createSignal<{ left: number; top: number } | null>(null)
  const [inspectPanelPosition, setInspectPanelPosition] = createSignal<{ left: number; top: number } | null>(null)
  const [commentHoverTarget, setCommentHoverTarget] = createSignal<{
    elementId: string | null
    tag: string
    selector: string
    text: string
    position: { x: number; y: number; w: number; h: number }
    htmlHint: string
    label: string
    note?: string
    pinPosition?: { left: number; top: number; width: number; height: number }
    commenterAvatar?: string
    commenterName?: string
    createdAt?: number
    commentId?: string
    showOverlap?: boolean
  } | null>(null)
  const [commentTarget, setCommentTarget] = createSignal<{
    elementId: string | null
    tag: string
    selector: string
    contentSignature?: string
    nativeId?: string
    text: string
    position: { x: number; y: number; w: number; h: number }
    htmlHint: string
    label: string
    hoverPoint?: { x: number; y: number }
    pinPosition?: { left: number; top: number; width: number; height: number }
  } | null>(null)
  const [editingComment, setEditingComment] = createSignal<FileComment | null>(null)
  const [savedComments, setSavedComments] = createSignal<FileComment[]>([])
  const [commentReadOnly, setCommentReadOnly] = createSignal(false)
  const sortedComments = createMemo(() => {
    const all = savedComments()
    return [...all].sort((a, b) => a.createdAt - b.createdAt)
  })
  const currentCommentIndex = createMemo(() => {
    const comment = editingComment()
    if (!comment) return -1
    return sortedComments().findIndex(c => c.id === comment.id)
  })
  const [commentPanelPosition, setCommentPanelPosition] = createSignal<{ left: number; top: number } | null>(null)
  const [externalClickSignal, setExternalClickSignal] = createSignal(0)
  const [archiveDialogOpen, setArchiveDialogOpen] = createSignal(false)
  const [archiveSuccessOpen, setArchiveSuccessOpen] = createSignal(false)
  const [archiveSuccessPath, setArchiveSuccessPath] = createSignal("")
  const [archiveSuccessUniqueId, setArchiveSuccessUniqueId] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  
  // Pending style storage for Cancel/Save logic
  let manualEditPendingStyle: { id: string; styles: ManualEditStyles; label: string } | null = null
  
  // Pending text storage for Cancel/Save logic (tracks text/href changes)
  let manualEditPendingText: { id: string; text: string; href: string } | null = null
  
  // History management for Undo/Redo
  let historyStack: HistoryState[] = []
  let historyIndex = -1
  let historyInitialized = false
  
  // Initialize history with current content
  function initHistory(html: string) {
    if (historyInitialized) return
    historyStack = [{ html, description: "Initial state" }]
    historyIndex = 0
    historyInitialized = true
  }
  
  // Push new state to history
  function pushHistory(html: string, description: string) {
    // Truncate future history if we're not at the end
    if (historyIndex < historyStack.length - 1) {
      historyStack = historyStack.slice(0, historyIndex + 1)
    }
    // Add new state
    historyStack.push({ html, description })
    // Limit history size
    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift()
    } else {
      historyIndex++
    }
  }
  
  // Undo: go back in history
  function undo(): boolean {
    if (historyIndex > 0) {
      historyIndex--
      const state = historyStack[historyIndex]
      void props.onContentChange?.(wrapHtmlContent(state.html, props.content))
      return true
    }
    return false
  }
  
  // Redo: go forward in history
  function redo(): boolean {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++
      const state = historyStack[historyIndex]
      void props.onContentChange?.(wrapHtmlContent(state.html, props.content))
      return true
    }
    return false
}
  
  // Sync archiving prop with dialog state
  createEffect(() => {
    setArchiveDialogOpen(props.archiving ?? false)
  })
  
  // Handle archive confirm
  async function handleArchiveConfirm(data: ArchiveConfirmData): Promise<void> {
    const isLoggedIn = !!localStorage.getItem("uiplusToken")
    const fileName = getArtifactFilename(props.filePath).replace(/\.html?$/i, "")
    const taskId = `archive-${Date.now()}`
    
    // 创建任务
    TaskStore.add([{
      key: taskId,
      taskId,
      type: "archive",
      serviceType: "octo_archive",
      name: fileName,
      size: 0,
      status: "in_progress",
      hasProgress: false,
      canCancel: false,
      createdAt: Date.now(),
    }])
    
    tracker.interaction({ 
      module: "design", 
      name: "confirm-archive", 
      extend: JSON.stringify({ 
        isLoggedIn,
        isOverwrite: data.isOverwrite,
        spaceType: data.spaceType 
      }) 
    })
    
    const overlay = document.querySelector('.archive-dialog-overlay') as HTMLElement | null
    const collisionOverlay = document.querySelector('.archive-collision-overlay') as HTMLElement | null
    
    try {
      if (!iframeRef) {
        TaskStore.error([{ key: taskId, status: "error" }])
        showToast({ title: "归档失败", description: "无法获取页面内容" })
        return
      }
      
      if (overlay) {
        overlay.style.display = 'none'
      }
      if (collisionOverlay) {
        collisionOverlay.style.display = 'none'
      }
      
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      const screenshotBlob = await capturePageScreenshot(iframeRef)
      
      if (overlay) {
        overlay.style.display = ''
      }
      
      const comments = savedComments()
      const htmlContent = extractHtmlContent(props.content)
      
      const zipBlob = await createArchiveZip({
        comments,
        screenshotBlob,
        htmlContent,
        htmlFileName: getArtifactFilename(props.filePath),
        htmlFilePath: props.filePath || "",
        sessionId: props.sessionId || "",
        projectDir: props.sdkDirectory || ""
      })
      
      if (isLoggedIn) {
        let uploadResult: { success: boolean }
        let uniqueId: string = ""
        
        if (data.isOverwrite && data.existingDeliverableId && data.existingDocId) {
          await uploadCover(data.existingDeliverableId, screenshotBlob)
          uploadResult = await uploadVersion(data.existingDocId, zipBlob)
          uniqueId = data.existingDocId
        } else {
          const existingNames = data.existingDeliverables.map(d => d.fileName)
          const newFileName = getNextAvailableFileName(fileName, existingNames)
          const newDeliverable = await createDeliverable(data.teamId, newFileName)
          await uploadCover(newDeliverable.deliverableId, screenshotBlob)
          uploadResult = await uploadVersion(newDeliverable.uniqueId, zipBlob)
          uniqueId = newDeliverable.uniqueId
        }
        
        if (!uploadResult.success) {
          throw new Error("归档上传失败")
        }
        
        TaskStore.finish([{ key: taskId, status: "completed" }])
        
        const pathStr = buildArchivePath({
          spaceType: data.spaceType,
          productName: data.productName,
          versionDeliveryName: data.versionDeliveryName,
          folderName: data.folderName
        })
        setArchiveSuccessPath(pathStr)
        setArchiveSuccessUniqueId(uniqueId)
        setArchiveSuccessOpen(true)
        showToast({ title: "归档成功" })
      } else {
        const zipFileName = `${fileName}-archive.zip`
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement("a")
        a.href = url
        a.download = zipFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        TaskStore.finish([{ key: taskId, status: "completed" }])
        showToast({ title: "归档完成", description: "ZIP文件已下载" })
      }
    } catch (err) {
      if (overlay) {
        overlay.style.display = ''
      }
      if (collisionOverlay) {
        collisionOverlay.style.display = ''
      }
      console.error("[Archive] Failed:", err)
      TaskStore.error([{ key: taskId, status: "error" }])
      showToast({ title: "归档失败", description: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }
  
// ★ Cache annotated HTML when content changes (ensure element IDs match)
createEffect(on(() => props.content, () => {
  const html = extractHtmlContent(props.content)
  const annotated = annotateElementsWithIds(html)
  setAnnotatedHtmlCache(annotated)
}))
  
// Initialize floating position on first edit
createEffect(() => {
    if (props.editing && editTarget() && !editPanelPosition()) {
      // Calculate initial position (right side with padding)
      const canvasWidth = iframeRef?.parentElement?.getBoundingClientRect()?.width || 800
      const panelWidth = 340
      const padding = 12
      setEditPanelPosition({
        left: Math.max(padding, canvasWidth - panelWidth - padding),
        top: padding
      })
    }
  })

// Initialize floating position on first inspect
createEffect(() => {
  if (props.inspectPanel && inspectTarget() && !inspectPanelPosition()) {
    const canvasWidth = iframeRef?.parentElement?.getBoundingClientRect()?.width || 800
    const panelWidth = 320
    const padding = 12
    setInspectPanelPosition({
      left: Math.max(padding, canvasWidth - panelWidth - padding),
      top: padding
    })
  }
})

// Initialize floating position on first comment
createEffect(() => {
  if (props.commenting && commentTarget() && !commentPanelPosition()) {
    const canvasWidth = iframeRef?.parentElement?.getBoundingClientRect()?.width || 800
    const panelWidth = 340
    const padding = 12
    setCommentPanelPosition({
      left: Math.max(padding, canvasWidth - panelWidth - padding),
      top: padding
    })
  }
})

// Load comments when file path or session ID changes
createEffect(() => {
  if (!props.filePath || !props.sessionId) return
  
  const loadComments = async () => {
    if (!props.sdkUrl || !props.sdkDirectory || !props.sessionId) return
    
    try {
      const commentFilePath = props.commentFilePath || extractCommentFilePath(props.filePath || '', props.sessionId || '')
      const res = await fetch(`${props.sdkUrl}/comment/file?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(commentFilePath)}`, {
        headers: { ...directoryHeader(props.sdkDirectory) }
      })
      if (!res.ok) {
        if (res.status === 404) {
          setSavedComments([])
          return
        }
        throw new Error(`Load comments failed: ${res.status}`)
      }
      
      const data = await res.json()
      const comments: FileComment[] = data.comments || []
      setSavedComments(comments)
      
      iframeRef?.contentWindow?.postMessage(
        { type: "od:comment-saved-pins", comments },
        "*"
      )
    } catch (err) {
      console.error('[Comment] Load failed:', err)
    }
  }
  
  loadComments()
})
  
  // Flush pending styles to HTML (Save button) - uses iframe snapshot for ID match
  async function flushManualEditStyleSave(): Promise<boolean> {
    const pending = manualEditPendingStyle
    const target = editTarget()
    const draft = editDraft()
    
    if (!target) return true
    
    // ★ Get HTML snapshot from iframe (guaranteed ID match)
    const html = await getIframeSnapshot()
    
    // Apply all patches (styles + text/href if changed)
    let result: { ok: boolean; source: string; error?: string } = { ok: true, source: html }
    let hasChanges = false
    let description = "Edit styles"
    
    // Apply styles if pending
    if (pending && pending.styles) {
      result = applyManualEditPatch(result.source, {
        id: target.id,
        kind: 'set-style',
        styles: pending.styles
      })
      manualEditPendingStyle = null
      hasChanges = true
      description = `Edit ${pending.label || target.label} styles`
    }
    
    // Apply text content if pending (for text/mixed elements)
    const pendingText = manualEditPendingText
    if (result.ok && pendingText && pendingText.id === target.id && (target.kind === 'text' || target.kind === 'mixed')) {
      result = applyManualEditPatch(result.source, {
        id: target.id,
        kind: 'set-text',
        value: pendingText.text
      })
      manualEditPendingText = null
      hasChanges = true
      description = `Edit ${target.label} text`
    }
    
    // Apply link if pending (for link elements)
    if (result.ok && pendingText && pendingText.id === target.id && target.kind === 'link') {
      result = applyManualEditPatch(result.source, {
        id: target.id,
        kind: 'set-link',
        text: pendingText.text || '',
        href: pendingText.href || ''
      })
      manualEditPendingText = null
      hasChanges = true
      description = `Edit ${target.label} link`
    }
    
    if (result.ok) {
      const cleanSource = cleanBridgeContent(result.source)
      await props.onContentChange?.(wrapHtmlContent(cleanSource, props.content))
      if (hasChanges) {
        pushHistory(cleanSource, description)
      }
      return true
    }
    
    console.error('[Edit] Flush failed:', result.error)
    return false
  }
  
  // Get HTML snapshot from iframe (Promise wrapper for async usage)
  function getIframeSnapshot(): Promise<string> {
    return new Promise((resolve) => {
      const iframe = iframeRef
      if (!iframe?.contentWindow) {
        resolve("")
        return
      }
      
      const handleSnapshot = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return
        const d = e.data
        if (d && d.type === "od:html-snapshot") {
          window.removeEventListener("message", handleSnapshot)
          resolve(d.html)
        }
      }
      
      window.addEventListener("message", handleSnapshot)
      iframe.contentWindow.postMessage({ type: "od:get-html-snapshot" }, "*")
      
      // Timeout fallback
      setTimeout(() => {
        window.removeEventListener("message", handleSnapshot)
        resolve("")
      }, 500)
    })
  }
  
  // Cancel pending changes (reset iframe to original)
  function cancelManualEditStyleDraft() {
    const pendingStyle = manualEditPendingStyle
    const pendingText = manualEditPendingText
    const target = editTarget()
    
    manualEditPendingStyle = null
    manualEditPendingText = null
    
    if (!target) return
    
    // Reset styles in iframe
    if (pendingStyle) {
      const html = extractHtmlContent(props.content)
      const sourceStyles = inspectorManualEditStyles(target, html)
      
      const resetStyles: Partial<ManualEditStyles> = {}
      MANUAL_EDIT_STYLE_PROPS.forEach(key => {
        resetStyles[key] = sourceStyles[key] ?? ''
      })
      
      iframeRef?.contentWindow?.postMessage(
        { type: "od:edit-preview-style", id: pendingStyle.id, styles: resetStyles, version: 999 },
        "*"
      )
    }
    
    // Reset draft text to original
    if (pendingText) {
      const html = extractHtmlContent(props.content)
      const fields = readManualEditFields(html, target.id)
      setEditDraft(prev => ({
        ...prev,
        text: fields.text ?? target.fields.text ?? target.text ?? '',
        href: fields.href ?? target.fields.href ?? '',
      }))
    }
  }
  
  // Reapply saved overrides after iframe loads
  createEffect(() => {
    const iframe = iframeRef
    const overrides = savedOverrides()
    if (!iframe || overrides.length === 0) return
    
    const reapplyOverrides = () => {
      overrides.forEach((override: { elementId: string; prop: string; value: string }) => {
        iframe.contentWindow?.postMessage(
          { type: "od:inspect-set", elementId: override.elementId, prop: override.prop, value: override.value },
          "*"
        )
      })
    }
    
    reapplyOverrides()
    iframe.addEventListener("load", reapplyOverrides)
    onCleanup(() => iframe.removeEventListener("load", reapplyOverrides))
  })
  
  // Keyboard shortcuts (Undo/Redo always available, Escape only in edit mode)
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z: Undo (global - always available when history exists)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const ok = undo()
        if (ok) {
          console.log('[Edit] Undo successful - history index:', historyIndex)
        } else {
          console.log('[Edit] Undo failed - no history available')
        }
        return
      }
      
      // Ctrl+Y or Ctrl+Shift+Z: Redo (global - always available when future history exists)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        const ok = redo()
        if (ok) {
          console.log('[Edit] Redo successful - history index:', historyIndex)
        } else {
          console.log('[Edit] Redo failed - no future history available')
        }
        return
      }
      
      // Escape: Exit edit mode (only when editing AND editTarget is set)
      if (props.editing && editTarget() && e.key === 'Escape') {
        e.preventDefault()
        void (async () => {
          const ok = await flushManualEditStyleSave()
          if (ok) {
            setEditTarget(null)
            manualEditPendingStyle = null
          }
        })()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown))
  })
  
  // Initialize history on mount (before any keyboard events)
  onMount(() => {
    initHistory(extractHtmlContent(props.content))
  })

  const srcdoc = createMemo(() => {
    const html = extractHtmlContent(props.content)
    const key = props.refreshKey ?? 0
    return buildSrcdoc(html, {
      focusGuard: true,
      palette: !!props.palette,
      initialPalette: props.palette ?? null,
      picker: true,
      inspectBridge: true,
      editBridge: true,
      snapshotBridge: true,
      commentBridge: true,
      annotateElements: true,
    }) + (key > 0 ? `<script data-refresh-key="${key}"></script>` : "")
  })

  const shouldUseLocalUrl = createMemo(() => {
    return isElectronDesktop() && props.filePath
  })

  const localUrl = createMemo(() => {
    if (!shouldUseLocalUrl()) return undefined
    const key = props.refreshKey ?? 0
    return `${pathToLocalUrl(props.filePath!)}?v=${key}`
  })

  const shouldUseServeUrl = createMemo(() => {
    if (isElectronDesktop()) return false  // Electron 环境优先使用 local://
    if (!props.filePath || !props.sessionId || !props.sdkUrl) return false
    const artifactInfo = getArtifactRelativePath(props.filePath)
    if (!artifactInfo) return false
    return artifactInfo.sessionId === props.sessionId
  })

  const serveUrl = createMemo(() => {
    if (!shouldUseServeUrl()) return undefined
    if (!props.sdkDirectory) return undefined
    const artifactInfo = getArtifactRelativePath(props.filePath!)
    if (!artifactInfo) return undefined
    return getArtifactServeUrl(props.sdkUrl!, props.sdkDirectory, props.sessionId!, artifactInfo.relativePath)
  })

  const [serveKey, setServeKey] = createSignal(0)

  createEffect(on(() => props.mode, async (mode) => {
    // Electron 环境不需要自动保存（local:// 直接读取文件）
    if (isElectronDesktop()) return
    if (!props.content?.trim()) return
    if (mode === "preview" && shouldUseServeUrl() && props.onSaveFile) {
      try {
        await props.onSaveFile(props.content)
        setServeKey(k => k + 1)
      } catch (err) {
        console.error("[HtmlRenderer] Failed to save file before preview:", err)
        showToast({ title: "保存失败", description: "无法保存文件到磁盘" })
      }
    }
  }))

  // Send palette change via postMessage (avoids full re-render)
  const sendPalette = (id: PaletteId | null) => {
    iframeRef?.contentWindow?.postMessage({ type: "od:palette", palette: id }, "*")
  }

  // Sync palette on prop change
  createEffect(() => {
    if (props.mode === "preview" && iframeRef) {
      sendPalette(props.palette ?? null)
    }
  })

  // Listen to inspect messages from iframe
  createEffect(() => {
    const iframe = iframeRef
    if (!iframe || !props.inspecting) return

    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return
      const d = e.data
      if (!d || typeof d !== "object") return

      if (d.type === "od:inspect-target" && d.clicked === true) {
        const target: InspectTarget = {
          elementId: d.elementId || null,
          tag: d.tag,
          selector: d.selector,
          text: d.text,
          position: d.position,
          style: d.style,
          htmlHint: d.htmlHint,
        }
        setInspectTarget(target)
        props.onInspectTarget?.(target)
      }

      if (d.type === "od:inspect-leave") {
        // Don't clear target while inspecting mode is active
        // User can click elsewhere to select new element or click Close button
        // This prevents panel from closing when mouse moves between iframe and panel
      }
    }

    window.addEventListener("message", handleMessage)
    onCleanup(() => window.removeEventListener("message", handleMessage))
  })

// Listen to edit messages from iframe
createEffect(() => {
  const iframe = iframeRef
  if (!iframe || !props.editing) return

  const handleMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== "object") return

    // ★ Handle in-place text edit commit
    if (d.type === "od-edit-text-commit") {
      const id = String(d.id)
      const value = String(d.value)
      
      // ★ Use iframe snapshot for ID match
      void (async () => {
        const html = await getIframeSnapshot()
        
        // Apply text patch
        const result = applyManualEditPatch(html, {
          id: id,
          kind: 'set-text',
          value: value
        })
        
        if (result.ok) {
          const cleanSource = cleanBridgeContent(result.source)
          props.onContentChange?.(wrapHtmlContent(cleanSource, props.content))
          pushHistory(cleanSource, `Edit text in-place`)
          console.log("[Edit] In-place text edit saved:", id, value.slice(0, 50))
        } else {
          console.error("[Edit] In-place text edit failed:", result.error)
        }
      })()
      return
    }

    // ★ Handle focus transfer request from in-place editing
    if (d.type === "od:edit-focus-transfer") {
      // Move focus to outer document (enable HTML undo/redo)
      iframeRef?.blur()
      window.focus()
      console.log('[Edit] Focus transferred to parent window')
      return
    }

    if (d.type === "od:edit-selected") {
      const target: ManualEditTarget = d.target
      
      // Save previous element's pending changes before switching
      const prevId = editTarget()?.id
      if (prevId && prevId !== target.id) {
        if (manualEditPendingStyle?.id === prevId || manualEditPendingText?.id === prevId) {
          const flushOk = flushManualEditStyleSave()
          if (!flushOk) {
            console.error("[Edit] Failed to flush pending changes before switch")
            return
          }
        }
      }
      
      setEditTarget(target)
      manualEditPendingStyle = null
      manualEditPendingText = null
      
      // Initialize draft from target + source
      const html = extractHtmlContent(props.content)
      const fields = readManualEditFields(html, target.id)
      setEditDraft({
        text: fields.text ?? target.fields.text ?? target.text,
        href: fields.href ?? target.fields.href ?? '',
        src: fields.src ?? target.fields.src ?? '',
        alt: fields.alt ?? target.fields.alt ?? '',
        styles: inspectorManualEditStyles(target, html),
        attributesText: JSON.stringify(readManualEditAttributes(html, target.id), null, 2),
        outerHtml: readManualEditOuterHtml(html, target.id) || target.outerHtml,
        fullSource: html,
      })
      
      // Send selected-target message to set persistent outline
      iframe.contentWindow?.postMessage(
        { type: "od:edit-selected-target", id: target.id },
        "*"
      )
    }
  }

  window.addEventListener("message", handleMessage)
  onCleanup(() => window.removeEventListener("message", handleMessage))
})

// Listen to comment messages from iframe (always registered, not dependent on props.commenting)
createEffect(() => {
  const iframe = iframeRef
  if (!iframe) return

  const handleMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return
    const d = e.data
    if (!d || typeof d !== "object") return

    if (d.type === "od:comment-request-pins") {
      const comments = savedComments()
      iframeRef?.contentWindow?.postMessage(
        { type: "od:comment-saved-pins", comments },
        "*"
      )
    }

    if (d.type === "od:comment-pin-hover") {
      const commentId = d.commentId
      const comment = savedComments().find(c => c.id === commentId)
      if (comment) {
        setCommentHoverTarget({
          elementId: comment.elementId,
          tag: comment.elementId.split('-')[0] || 'div',
          selector: comment.selector,
          text: comment.text,
          position: comment.position,
          htmlHint: comment.htmlHint,
          label: comment.label,
          note: comment.note,
          pinPosition: d.position,
          commenterAvatar: comment.commenterAvatar,
          commenterName: comment.commenterName,
          createdAt: comment.createdAt,
          commentId: comment.id,
          showOverlap: d.showOverlap,
        })
      }
    }

    if (d.type === "od:comment-external-click") {
      setExternalClickSignal(prev => prev + 1)
    }

    if (d.type === "od:comment-target") {
      setCommentTarget({
        elementId: d.elementId || null,
        tag: d.tag,
        selector: d.selector,
        contentSignature: d.contentSignature || '',
        nativeId: d.nativeId,
        text: d.text,
        position: d.position,
        htmlHint: d.htmlHint,
        label: d.label,
        hoverPoint: d.hoverPoint,
      })
      setEditingComment(null)
      setCommentReadOnly(false)
      setCommentHoverTarget(null)
    }

    if (d.type === "od:comment-pin-click") {
      console.log('[DEBUG] pin-click received:', d)
      console.log('[DEBUG] pinPosition:', d.pinPosition)
      const commentId = d.commentId
      const comment = savedComments().find(c => c.id === commentId)
      if (comment) {
        setEditingComment(comment)
        setCommentReadOnly(true)
        const pinPos = d.pinPosition
        console.log('[DEBUG] calculated hoverPoint:', pinPos ? {
          x: pinPos.left + pinPos.width + 8,
          y: pinPos.top
        } : undefined)
        setCommentTarget({
          elementId: comment.elementId,
          tag: comment.elementId.split('-')[0] || 'div',
          selector: comment.selector,
          contentSignature: comment.contentSignature,
          nativeId: comment.nativeId,
          text: comment.text,
          position: comment.position,
          htmlHint: comment.htmlHint,
          label: comment.label,
          hoverPoint: pinPos ? {
            x: pinPos.left + pinPos.width + 8,
            y: pinPos.top
          } : undefined,
          pinPosition: pinPos,
        })
      }
    }
    
    if (d.type === "od:comment-pin-position") {
      const commentId = d.commentId
      const pinPos = d.pinPosition
      const comment = savedComments().find(c => c.id === commentId)
      if (comment && pinPos) {
        setEditingComment(comment)
        setCommentReadOnly(true)
        setCommentTarget({
          elementId: comment.elementId,
          tag: comment.elementId.split('-')[0] || 'div',
          selector: comment.selector,
          contentSignature: comment.contentSignature,
          nativeId: comment.nativeId,
          text: comment.text,
          position: comment.position,
          htmlHint: comment.htmlHint,
          label: comment.label,
          hoverPoint: {
            x: pinPos.left + pinPos.width + 8,
            y: pinPos.top
          },
          pinPosition: pinPos,
        })
      }
    }
  }

  window.addEventListener("message", handleMessage)
  onCleanup(() => window.removeEventListener("message", handleMessage))
})

  // Switch to previous/next pin in sorted order
  const switchToPrevPin = () => {
    const sorted = sortedComments()
    const idx = currentCommentIndex()
    if (idx <= 0) return
    const prevComment = sorted[idx - 1]
    iframeRef?.contentWindow?.postMessage({
      type: 'od:comment-set-active',
      elementId: prevComment.elementId,
      selector: prevComment.selector,
      contentSignature: prevComment.contentSignature,
      nativeId: prevComment.nativeId,
      position: prevComment.position,
      commentId: prevComment.id
    }, '*')
  }

  const switchToNextPin = () => {
    const sorted = sortedComments()
    const idx = currentCommentIndex()
    if (idx < 0 || idx >= sorted.length - 1) return
    const nextComment = sorted[idx + 1]
    iframeRef?.contentWindow?.postMessage({
      type: 'od:comment-set-active',
      elementId: nextComment.elementId,
      selector: nextComment.selector,
      contentSignature: nextComment.contentSignature,
      nativeId: nextComment.nativeId,
      position: nextComment.position,
      commentId: nextComment.id
    }, '*')
  }

  // Send edit-mode toggle to iframe
  createEffect(() => {
    if (iframeRef && props.mode === "preview") {
      iframeRef.contentWindow?.postMessage(
        { type: "od:edit-mode", enabled: !!props.editing },
        "*"
      )
      if (!props.editing) {
        setEditTarget(null)
      }
    }
  })

// Send inspect-mode toggle to iframe
  createEffect(() => {
    if (iframeRef && props.mode === "preview") {
      iframeRef.contentWindow?.postMessage(
        { type: "od:inspect-mode", enabled: !!props.inspecting },
        "*"
      )
      if (!props.inspecting) {
        setInspectTarget(null)
        props.onInspectTarget?.(null)
      }
    }
  })
  
  // Send comment-mode toggle to iframe
  createEffect(() => {
    if (iframeRef && props.mode === "preview") {
      iframeRef.contentWindow?.postMessage(
        { type: "od:comment-mode", enabled: !!props.commenting },
        "*"
      )
      // 评论模式开启时，主动发送评论数据
      if (props.commenting) {
        const comments = savedComments()
        iframeRef.contentWindow?.postMessage(
          { type: "od:comment-saved-pins", comments },
          "*"
        )
      }
      if (!props.commenting) {
        setCommentHoverTarget(null)
        setCommentTarget(null)
        setEditingComment(null)
        iframeRef.contentWindow?.postMessage({ type: 'od:comment-clear' }, '*')
      }
    }
  })
  
  // Re-send edit/inspect/palette mode after iframe reloads (fixes Undo/Redo outline issue)
  createEffect(() => {
    const iframe = iframeRef
    if (!iframe || props.mode !== "preview") return
    
    const handleLoad = () => {
      // Re-send edit mode if still editing
      if (props.editing) {
        iframe.contentWindow?.postMessage(
          { type: "od:edit-mode", enabled: true },
          "*"
        )
      }
      // Re-send inspect mode if still inspecting
      if (props.inspecting) {
        iframe.contentWindow?.postMessage(
          { type: "od:inspect-mode", enabled: true },
          "*"
        )
      }
      // Re-send comment mode if still commenting
      if (props.commenting) {
        iframe.contentWindow?.postMessage(
          { type: "od:comment-mode", enabled: true },
          "*"
        )
      }
      // Re-send palette if set
      if (props.palette) {
        iframe.contentWindow?.postMessage(
          { type: "od:palette", palette: props.palette },
          "*"
        )
      }
      // Re-send saved overrides
      const overrides = savedOverrides()
      if (overrides.length > 0) {
        overrides.forEach((override) => {
          iframe.contentWindow?.postMessage(
            { type: "od:inspect-set", elementId: override.elementId, prop: override.prop, value: override.value },
            "*"
          )
        })
      }
    }
    
    iframe.addEventListener("load", handleLoad)
    onCleanup(() => iframe.removeEventListener("load", handleLoad))
  })

  const [canvasSize, setCanvasSize] = createSignal({ w: 0, h: 0 })
  let containerRef: HTMLDivElement | undefined

  const observer = new ResizeObserver((entries) => {
    const e = entries[0]
    if (e) setCanvasSize({ w: e.contentRect.width, h: e.contentRect.height })
  })

  onMount(() => {
    if (containerRef) observer.observe(containerRef)
  })
  onCleanup(() => observer.disconnect())

  const isResponsive = () => {
    const vp = props.viewport ?? "desktop"
    return vp !== "desktop" && props.mode === "preview"
  }

  const containerStyle = createMemo(() => {
    if (!isResponsive()) return {}

    const vp = props.viewport!
    const dims = VIEWPORT_DIMS[vp]
    const { w, h } = canvasSize()
    const scale = effectiveScale(vp, w, h)
    const pad = 24

    return {
      "--octo-vp-width": `${dims.width}px`,
      "--octo-vp-height": `${dims.height}px`,
      "--octo-vp-scale": scale,
      "--octo-vp-offset-x": `${pad + Math.max(0, (w - pad * 2 - dims.width! * scale) / 2)}px`,
      "--octo-vp-offset-y": `${pad}px`,
    } as JSX.CSSProperties
  })

  const frameStyle = createMemo(() => {
    if (!isResponsive()) return {}
    const vp = props.viewport!
    const dims = VIEWPORT_DIMS[vp]
    return {
      width: `${dims.width}px`,
      height: `${dims.height}px`,
      transform: `scale(var(--octo-vp-scale, 1))`,
      "transform-origin": "0 0",
    } as JSX.CSSProperties
  })

return (
    <div
      ref={containerRef}
      class="h-full w-full"
      style={{ overflow: "hidden", background: isResponsive() ? "var(--octo-shell-bg, #F3F6FB)" : "white", position: "relative", ...containerStyle() }}
    >
      {props.mode === "preview" ? (
        <DrawOverlay
          active={props.drawing ?? false}
          onActiveChange={props.onDrawActiveChange}
          sendDisabled={false}
          tabContext={props.tabTitle ? { title: props.tabTitle, filePath: props.filePath } : undefined}
        >
          {isResponsive() ? (
            <div
              class="octo-viewport-frame"
              style={{
                ...frameStyle(),
                background: "white",
                "border-radius": "var(--octo-radius-lg, 8px)",
                "box-shadow": "var(--octo-shadow-md, 0 4px 16px rgba(0,0,0,0.08))",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <iframe
                ref={iframeRef}
                src={shouldUseLocalUrl() ? localUrl() : (shouldUseServeUrl() ? serveUrl() : undefined)}
                {...(!shouldUseLocalUrl() && !shouldUseServeUrl() ? { srcdoc: srcdoc() } : {})}
                sandbox="allow-scripts"
                style={{
                  width: `${VIEWPORT_DIMS[props.viewport!].width}px`,
                  height: `${VIEWPORT_DIMS[props.viewport!].height}px`,
                  border: "none",
                }}
              />
            </div>
          ) : (
            <div style={{ height: "100%", overflow: "auto" }}>
              <iframe
                ref={iframeRef}
                src={shouldUseLocalUrl() ? localUrl() : (shouldUseServeUrl() ? serveUrl() : undefined)}
                {...(!shouldUseLocalUrl() && !shouldUseServeUrl() ? { srcdoc: srcdoc() } : {})}
                sandbox="allow-scripts"
                class="w-full h-full border-0"
                style={{ "min-height": "200px" }}
              />
            </div>
          )}
          <Show when={props.inspecting}>
            <PreviewOverlay iframeRef={iframeRef} inspecting={!!props.inspecting} />
          </Show>
          <Show when={props.inspectPanel && inspectTarget()}>
            <InspectPanel
              target={inspectTarget()}
              iframeRef={iframeRef}
              onApplyStyle={(elementId, prop, value) => {
                iframeRef?.contentWindow?.postMessage(
                  { type: "od:inspect-set", elementId, prop, value },
                  "*"
                )
              }}
              onResetElement={(elementId) => {
                iframeRef?.contentWindow?.postMessage(
                  { type: "od:inspect-reset", elementId },
                  "*"
                )
              }}
              onSaveToContent={() => {
                // Step 1: Get HTML snapshot from iframe (guaranteed ID match)
                iframeRef?.contentWindow?.postMessage(
                  { type: "od:get-html-snapshot" },
                  "*"
                )
                const handleSnapshot = (e: MessageEvent) => {
                  if (e.source !== iframeRef?.contentWindow) return
                  const d = e.data
                  if (d && d.type === "od:html-snapshot") {
                    const html = d.html
                    // Step 2: Extract overrides from iframe
                    iframeRef?.contentWindow?.postMessage(
                      { type: "od:inspect-extract" },
                      "*"
                    )
                    const handleOverrides = (e2: MessageEvent) => {
                      if (e2.source !== iframeRef?.contentWindow) return
                      const d2 = e2.data
                      if (d2 && d2.type === "od:inspect-overrides") {
                        const overrides = d2.overrides
                        // Step 3: Apply overrides to snapshot (IDs match iframe)
                        const parser = new DOMParser()
                        const doc = parser.parseFromString(html, "text/html")
                        for (const { elementId, prop, value } of overrides) {
                          const el = doc.querySelector(`[data-od-id="${elementId}"]`)
                          if (el && el instanceof HTMLElement) {
                            el.style.setProperty(prop, value, "important")
                          }
                        }
                        const cleanHtml = cleanBridgeContent(doc.documentElement.outerHTML)
                        props.onContentChange?.(wrapHtmlContent(cleanHtml, props.content))
                        tracker.interaction({ module: "design", name: "save-inspect-changes" })
                        // Close inspect panel
                        setInspectTarget(null)
                        setSavedOverrides([])
                        window.removeEventListener("message", handleOverrides)
                      }
                    }
                    window.addEventListener("message", handleOverrides)
                    window.removeEventListener("message", handleSnapshot)
                  }
                }
                window.addEventListener("message", handleSnapshot)
              }}
              onClose={() => setInspectTarget(null)}
              floatingStyle={inspectPanelPosition() ?? undefined}
              onFloatingPositionChange={setInspectPanelPosition}
            />
          </Show>
          <Show when={props.editing && editTarget()}>
            <ManualEditPanel
                selectedTarget={editTarget()}
                draft={editDraft()}
                error={null}
                busy={saving()}
                floatingStyle={editPanelPosition() ?? undefined}
                onDraftChange={(newDraft) => {
                  const target = editTarget()
                  setEditDraft(newDraft)
                  
                  // Track text/href changes for pending save
                  if (target && (target.kind === 'text' || target.kind === 'link' || target.kind === 'mixed')) {
                    manualEditPendingText = {
                      id: target.id,
                      text: newDraft.text,
                      href: newDraft.href,
                    }
                  }
                }}
                onStyleChange={(id, styles, label) => {
                  const baseStyles = manualEditPendingStyle?.styles ?? editDraft().styles
                  const mergedStyles = { ...baseStyles, ...styles }
                  manualEditPendingStyle = { id, styles: mergedStyles, label }
                  
                  // Send preview to iframe
                  const version = editStyleVersion() + 1
                  setEditStyleVersion(version)
                  iframeRef?.contentWindow?.postMessage(
                    { type: "od:edit-preview-style", id, styles, version },
                    "*"
                  )
                }}
onApplyPatch={async (patch: ManualEditPatch, label: string) => {
              const html = await getIframeSnapshot()
              const result = applyManualEditPatch(html, patch)
              if (result.ok) {
                const cleanSource = cleanBridgeContent(result.source)
                const updatedContent = wrapHtmlContent(cleanSource, props.content)
                await props.onContentChange?.(updatedContent)
                props.onRefreshNeeded?.()
                pushHistory(cleanSource, label)
                if (patch.kind === 'remove-element') {
                  setEditTarget(null)
                }
              } else {
                console.error("[Edit] Patch failed:", result.error)
              }
            }}
                onPickImage={async (file: File): Promise<string | null> => {
                  // Convert file to dataUrl (simple implementation)
                  return new Promise((resolve) => {
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string
                      resolve(dataUrl)
                    }
                    reader.onerror = () => {
                      console.error('[Edit] Failed to read image file')
                      resolve(null)
                    }
                    reader.readAsDataURL(file)
                  })
                }}
onError={(message) => console.error("[Edit] Error:", message)}
onSaveDraft={async () => {
                    if (saving()) return
                    setSaving(true)
                    try {
                      const ok = await flushManualEditStyleSave()
                      if (ok) {
                        tracker.interaction({ module: "design", name: "save-edit-changes" })
                        setEditTarget(null)
                        manualEditPendingStyle = null
                        manualEditPendingText = null
                      } else {
                        showToast({ title: "保存失败", description: "无法保存样式修改，请重试" })
                      }
                    } finally {
                      setSaving(false)
                    }
                  }}
                onCancelDraft={() => {
                  cancelManualEditStyleDraft()
                  setEditTarget(null)
                  manualEditPendingStyle = null
                  manualEditPendingText = null
                  setEditDraft(emptyManualEditDraft(props.content))
                }}
onExit={async () => {
  if (saving()) return
  setSaving(true)
  try {
    const ok = await flushManualEditStyleSave()
    if (!ok) {
      showToast({ 
        title: "样式未保存", 
        description: "目标元素在HTML中不存在，修改已丢失" 
      })
    }
    setEditTarget(null)
    manualEditPendingStyle = null
    manualEditPendingText = null
  } finally {
    setSaving(false)
  }
}}
onFloatingPositionChange={setEditPanelPosition}
               />
             </Show>
<Show when={props.commenting && commentHoverTarget() && commentHoverTarget()!.commentId !== editingComment()?.id}>
                <CommentHoverTooltip
                  target={commentHoverTarget()!}
                  iframeBounds={iframeRef?.getBoundingClientRect() ? { width: iframeRef.getBoundingClientRect().width, height: iframeRef.getBoundingClientRect().height } : { width: 800, height: 600 }}
                  onClose={() => setCommentHoverTarget(null)}
                  onClick={() => {
                    const hoverTarget = commentHoverTarget()
                    const comment = savedComments().find(c => c.id === hoverTarget?.commentId)
                    if (comment && hoverTarget?.pinPosition) {
setEditingComment(comment)
                       setCommentReadOnly(true)
                       setCommentTarget({
                         elementId: comment.elementId,
                         tag: comment.elementId.split('-')[0] || 'div',
                         selector: comment.selector,
                         contentSignature: comment.contentSignature,
                         nativeId: comment.nativeId,
                         text: comment.text,
                         position: comment.position,
                         htmlHint: comment.htmlHint,
                         label: comment.label,
                         hoverPoint: {
                           x: hoverTarget.pinPosition.left + hoverTarget.pinPosition.width + 8,
                           y: hoverTarget.pinPosition.top
                         },
                         pinPosition: hoverTarget.pinPosition,
                       })
                      iframeRef?.contentWindow?.postMessage({
                        type: 'od:comment-set-active',
                        elementId: comment.elementId,
                        selector: comment.selector,
                        contentSignature: comment.contentSignature,
                        nativeId: comment.nativeId,
                        position: comment.position,
                        commentId: comment.id
                      }, '*')
                      setCommentHoverTarget(null)
                    }
                  }}
                />
              </Show>
<Show when={props.commenting && (commentTarget() || editingComment())}>
<CommentPopover
                   iframeBounds={iframeRef?.getBoundingClientRect() ? { width: iframeRef.getBoundingClientRect().width, height: iframeRef.getBoundingClientRect().height } : { width: 800, height: 600 }}
target={editingComment() ? {
                      elementId: editingComment()!.elementId,
                      selector: editingComment()!.selector,
                      contentSignature: editingComment()!.contentSignature,
                      nativeId: editingComment()!.nativeId,
                      label: editingComment()!.label,
                      text: editingComment()!.text,
                      position: editingComment()!.position,
                      htmlHint: editingComment()!.htmlHint,
                      hoverPoint: commentTarget()?.hoverPoint || (() => {
                        const bounds = iframeRef?.getBoundingClientRect()
                        return {
                          x: editingComment()!.position.x * (bounds?.width || 800),
                          y: editingComment()!.position.y * (bounds?.height || 600)
                        }
                      })(),
                      pinPosition: commentTarget()?.pinPosition,
                    } : {
                      elementId: commentTarget()!.elementId,
                      selector: commentTarget()!.selector,
                      contentSignature: commentTarget()!.contentSignature,
                      nativeId: commentTarget()!.nativeId,
                      label: commentTarget()!.label,
                      text: commentTarget()!.text,
                      position: commentTarget()!.position,
                      htmlHint: commentTarget()!.htmlHint,
                      hoverPoint: commentTarget()!.hoverPoint,
                      pinPosition: commentTarget()?.pinPosition,
                    }}
comment={editingComment()}
  externalClickSignal={externalClickSignal()}
  allComments={sortedComments()}
  readOnly={commentReadOnly()}
  onPrevPin={switchToPrevPin}
  onNextPin={switchToNextPin}
onSave={(note, attachments, pendingFiles) => {
                      const existing = editingComment()
                      const target = commentTarget()
                     
                      const commenterInfo = existing ? {
                        commenterName: existing.commenterName,
                        commenterAccount: existing.commenterAccount,
                        commenterAvatar: existing.commenterAvatar,
                      } : getCommenterInfo()

const comment: FileComment = {
                          id: existing?.id || `comment-${Date.now()}`,
                          filePath: props.filePath || '',
                          elementId: existing?.elementId || target?.elementId || '',
                          selector: existing?.selector || target?.selector || '',
                          contentSignature: existing?.contentSignature || target?.contentSignature || '',
                          nativeId: existing?.nativeId || target?.nativeId,
                          label: existing?.label || target?.label || '',
                          text: existing?.text || target?.text || '',
                          position: existing?.position || target?.position || { x: 0, y: 0, w: 0, h: 0 },
                          htmlHint: existing?.htmlHint || target?.htmlHint || '',
                          note,
                          attachments,
                          createdAt: existing?.createdAt || Date.now(),
                          updatedAt: Date.now(),
                          commenterName: commenterInfo.commenterName,
                          commenterAccount: commenterInfo.commenterAccount,
                          commenterAvatar: commenterInfo.commenterAvatar,
                        }
                    
                    // Save to backend API
                    if (!props.sdkUrl || !props.sdkDirectory) {
                      showToast({ title: "保存失败", description: "缺少 SDK 配置" })
                      return
                    }
                    
fetch(`${props.sdkUrl}/comment/file`, {
                        method: 'POST',
                        headers: { 
                          'Content-Type': 'application/json',
                          ...directoryHeader(props.sdkDirectory)
                        },
body: JSON.stringify({
                              sessionId: props.sessionId,
                              commentFilePath: props.commentFilePath || extractCommentFilePath(comment.filePath, props.sessionId || ''),
                              comment: {
                               id: comment.id,
                               filePath: comment.filePath,
                              elementId: comment.elementId,
                              selector: comment.selector,
                              contentSignature: comment.contentSignature,
                              nativeId: comment.nativeId,
                              label: comment.label,
                              text: comment.text,
                              position: comment.position,
                              htmlHint: comment.htmlHint,
                              note: comment.note,
                              attachments: comment.attachments || [],
                              createdAt: comment.createdAt,
                              updatedAt: comment.updatedAt,
                              commenterName: comment.commenterName,
                              commenterAccount: comment.commenterAccount,
                              commenterAvatar: comment.commenterAvatar,
                            }
                          })
                      })
                     .then(res => {
                       console.log('[Comment] First save response status:', res.status)
                      if (!res.ok) throw new Error(`Save comment failed: ${res.status}`)
                      return res.json()
                    })
                    .then(async data => {
                      if (!data.ok) throw new Error('Save comment failed')
                      
                      // Batch upload pending files
                      if (pendingFiles && pendingFiles.length > 0) {
                        const api = getDesktopApi()
                        if (!api?.getPathForFile) {
                          showToast({ title: "附件添加失败", description: "需要在 Electron 环境中运行" })
                        } else {
                          try {
                            const uploadPromises = pendingFiles.map(async file => {
                              const sourceFilePath = api.getPathForFile!(file)
                              
                              const uploadRes = await fetch(`${props.sdkUrl}/comment/file/attachment`, {
                                method: 'POST',
                                headers: { 
                                  'Content-Type': 'application/json',
                                  ...directoryHeader(props.sdkDirectory!)
                                },
                                body: JSON.stringify({
                                  sessionId: props.sessionId!,
                                  commentFilePath: extractCommentFilePath(comment.filePath, props.sessionId || ''),
                                  commentId: comment.id,
                                  sourceFilePath,
                                  filename: file.name,
                                  mime: file.type,
                                  size: file.size,
                                })
                              })
                              
                              if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`)
                              
                              const uploadData = await uploadRes.json()
                              if (!uploadData.ok || !uploadData.attachment) throw new Error('Upload failed')
                              
                              return uploadData.attachment
                            })
                            
                            const uploadedAttachments = await Promise.all(uploadPromises)
                            
                            console.log('[Comment] Uploaded attachments:', uploadedAttachments)
                            
                            // Update comment with all attachments
                            const allAttachments = [...(comment.attachments || []), ...uploadedAttachments]
                            
                            console.log('[Comment] All attachments for second save:', allAttachments)
                            
await fetch(`${props.sdkUrl}/comment/file`, {
                               method: 'POST',
                               headers: { 
                                 'Content-Type': 'application/json',
                                 ...directoryHeader(props.sdkDirectory!)
                               },
body: JSON.stringify({
                                  sessionId: props.sessionId,
                                  commentFilePath: props.commentFilePath || extractCommentFilePath(comment.filePath, props.sessionId || ''),
                                  comment: {
                                   ...comment,
                                   filePath: comment.filePath,
                                   attachments: allAttachments,
                                   updatedAt: Date.now(),
                                 }
                               })
                             })
                            .then(res => {
                              console.log('[Comment] Second save response status:', res.status)
                              if (!res.ok) throw new Error(`Second save failed: ${res.status}`)
                              return res.json()
                            })
                            .then(data => {
                              console.log('[Comment] Second save response data:', data)
                              if (!data.ok) throw new Error('Second save failed')
                            })
                            
                            showToast({ title: "评论已保存", description: `添加了 ${uploadedAttachments.length} 个附件` })
                          } catch (uploadErr) {
                            console.error('[Comment] Upload attachments error:', uploadErr)
                            showToast({ title: "附件添加失败", description: "评论已保存，但部分附件添加失败" })
                          }
                        }
                      } else {
                        showToast({ title: "评论已保存" })
                      }
                      
// Reload comments to get server-generated ID
                        fetch(`${props.sdkUrl}/comment/file?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(props.commentFilePath || extractCommentFilePath(comment.filePath, props.sessionId || ''))}`, {
                         headers: { ...directoryHeader(props.sdkDirectory!) }
                       })
                        .then(res => res.json())
 .then(serverData => {
                           const serverComments: FileComment[] = serverData.comments || []
                           setSavedComments(serverComments)
                           
                           iframeRef?.contentWindow?.postMessage(
                            { type: "od:comment-saved-pins", comments: serverComments },
                            "*"
                          )
                          
 setCommentTarget(null)
                           setEditingComment(null)
                           setExternalClickSignal(0)
                           iframeRef?.contentWindow?.postMessage({ type: 'od:comment-clear' }, '*')
                          tracker.interaction({ module: "design", name: "save-comment" })
                        })
                   })
                   .catch(err => {
                     console.error('[Comment] Save failed:', err)
                     showToast({ title: "保存失败", description: "无法保存评论到后端" })
                   })
                 }}
                 onDelete={() => {
                   const commentId = editingComment()?.id
                   if (!commentId) return
                   
                   if (!props.sdkUrl || !props.sdkDirectory) {
                     showToast({ title: "删除失败", description: "缺少 SDK 配置" })
                     return
                   }
                   
// Delete from backend API
                     fetch(`${props.sdkUrl}/comment/file?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(props.commentFilePath || extractCommentFilePath(props.filePath || '', props.sessionId || ''))}&commentId=${commentId}`, {
                      method: 'DELETE',
                      headers: { ...directoryHeader(props.sdkDirectory) }
                    })
                   .then(res => {
                     if (!res.ok) throw new Error(`Delete comment failed: ${res.status}`)
                     return res.json()
                   })
                   .then(data => {
                     if (!data.ok) throw new Error('Delete comment failed')
                     
                     setSavedComments(prev => prev.filter(c => c.id !== commentId))
                     iframeRef?.contentWindow?.postMessage(
                       { type: "od:comment-saved-pins", comments: savedComments() },
                       "*"
                     )
setCommentTarget(null)
                      setEditingComment(null)
                      iframeRef?.contentWindow?.postMessage({ type: 'od:comment-clear' }, '*')
                      showToast({ title: "标注已删除" })
                     tracker.interaction({ module: "design", name: "delete-comment" })
                   })
                   .catch(err => {
                     console.error('[Comment] Delete failed:', err)
                     showToast({ title: "删除失败", description: "无法删除评论" })
                   })
                 }}
onClose={() => {
                      setCommentTarget(null)
                      setEditingComment(null)
                      setExternalClickSignal(0)
                      setCommentHoverTarget(null)
                      iframeRef?.contentWindow?.postMessage({ type: 'od:comment-clear' }, '*')
                    }}
onUploadAttachment={(file) => {
                     const existingComment = editingComment()
                     
                     if (!existingComment) {
                       showToast({ title: "请先保存评论", description: "新评论需要先保存才能添加附件" })
                       return
                     }
                     
                     const api = getDesktopApi()
                     if (!api?.getPathForFile) {
                       showToast({ title: "不支持", description: "需要在 Electron 环境中运行" })
                       return
                     }
                     
                     const sourceFilePath = api.getPathForFile(file)
                     
                     fetch(`${props.sdkUrl}/comment/file/attachment`, {
                       method: 'POST',
                       headers: { 
                         'Content-Type': 'application/json',
                         ...directoryHeader(props.sdkDirectory!)
                       },
body: JSON.stringify({
                           sessionId: props.sessionId!,
                           commentFilePath: props.commentFilePath || extractCommentFilePath(props.filePath || '', props.sessionId || ''),
                           commentId: existingComment.id,
                          sourceFilePath,
                          filename: file.name,
                          mime: file.type,
                          size: file.size,
                        })
                     })
                     .then(res => {
                       if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
                       return res.json()
                     })
.then(data => {
                        if (!data.ok || !data.attachment) throw new Error('Upload failed')
                        
const updatedComment = {
                           ...existingComment,
                           attachments: [...(existingComment.attachments || []), data.attachment],
                           updatedAt: Date.now(),
                         }
                         
                         setEditingComment(updatedComment)
                         
                         fetch(`${props.sdkUrl}/comment/file`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json', ...directoryHeader(props.sdkDirectory!) },
                           body: JSON.stringify({
                             sessionId: props.sessionId,
                             commentFilePath: props.commentFilePath || extractCommentFilePath(updatedComment.filePath, props.sessionId || ''),
                             comment: updatedComment
                           })
                         })
                         .then(res => {
                           if (!res.ok) throw new Error(`Auto-save failed: ${res.status}`)
                           return res.json()
                         })
                         .then(saveData => {
                           if (!saveData.ok) throw new Error('Auto-save failed')
                           
                           fetch(`${props.sdkUrl}/comment/file?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(props.commentFilePath || extractCommentFilePath(updatedComment.filePath, props.sessionId || ''))}`, {
                            headers: { ...directoryHeader(props.sdkDirectory!) }
                          })
                          .then(res => res.json())
                          .then(serverData => {
                            const serverComments: FileComment[] = serverData.comments || []
                            setSavedComments(serverComments)
                            
                            iframeRef?.contentWindow?.postMessage(
                              { type: "od:comment-saved-pins", comments: serverComments },
                              "*"
                            )
                            
                            showToast({ title: "附件添加成功", description: file.name })
                          })
                          .catch(reloadErr => {
                            console.error('[Comment] Reload error:', reloadErr)
                            showToast({ title: "附件添加成功（数据同步失败）", description: reloadErr.message })
                          })
                        })
                        .catch(saveErr => {
                          console.error('[Comment] Auto-save error:', saveErr)
                          showToast({ title: "附件添加成功（评论同步失败）", description: saveErr.message })
                        })
                      })
                     .catch(err => {
                       console.error('[Comment] Upload error:', err)
                       showToast({ title: "附件添加失败", description: err.message })
                     })
                   }}
onDeleteAttachment={(attachmentId) => {
                     const existingComment = editingComment()
                     
console.log('[Comment] Delete attachment request:', {
                        attachmentId,
                        sessionId: props.sessionId,
                        filePath: getArtifactFilename(props.filePath),
                        commentId: existingComment?.id,
                        existingComment: existingComment,
                      })
                      
                      if (!existingComment) {
                        showToast({ title: "删除失败", description: "评论不存在" })
                        return
}
                      
                       fetch(`${props.sdkUrl}/comment/file/attachment/${attachmentId}?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(extractCommentFilePath(props.filePath || '', props.sessionId || ''))}&commentId=${existingComment.id}`, {
                        method: 'DELETE',
                        headers: { ...directoryHeader(props.sdkDirectory!) }
                      })
                     .then(res => {
                       console.log('[Comment] Delete response status:', res.status)
                       if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
                       return res.json()
                     })
.then(data => {
                        console.log('[Comment] Delete response data:', data)
                        if (!data.ok) throw new Error('Delete failed')
                        
                        // Update editingComment's attachments
                        const currentAttachments = existingComment.attachments || []
                        const newAttachments = currentAttachments.filter(a => a.id !== attachmentId)
                        
                        const updatedComment = {
                          ...existingComment,
                          attachments: newAttachments,
                          updatedAt: Date.now(),
                        }
                        
                        setEditingComment(updatedComment)
                        
// Auto-save comment after attachment deletion
                         fetch(`${props.sdkUrl}/comment/file`, {
                           method: 'POST',
                           headers: { 
                             'Content-Type': 'application/json',
                             ...directoryHeader(props.sdkDirectory!)
                           },
                           body: JSON.stringify({
                             sessionId: props.sessionId,
                             commentFilePath: props.commentFilePath || extractCommentFilePath(updatedComment.filePath, props.sessionId || ''),
                             comment: {
                               ...updatedComment,
                               filePath: getArtifactFilename(updatedComment.filePath),
                             }
                           })
                         })
                        .then(res => {
                          if (!res.ok) throw new Error(`Auto-save failed: ${res.status}`)
                          return res.json()
                        })
.then(saveData => {
                           if (!saveData.ok) throw new Error('Auto-save failed')
                           console.log('[Comment] Auto-save after delete success')
                           
fetch(`${props.sdkUrl}/comment/file?sessionId=${props.sessionId}&commentFilePath=${encodeURIComponent(props.commentFilePath || extractCommentFilePath(updatedComment.filePath, props.sessionId || ''))}`, {
                              headers: { ...directoryHeader(props.sdkDirectory!) }
                            })
                           .then(res => res.json())
                           .then(serverData => {
                             const serverComments: FileComment[] = serverData.comments || []
                             setSavedComments(serverComments)
                             
                             iframeRef?.contentWindow?.postMessage(
                               { type: "od:comment-saved-pins", comments: serverComments },
                               "*"
                             )
                             
                             showToast({ title: "附件删除成功" })
                           })
                           .catch(reloadErr => {
                             console.error('[Comment] Reload error:', reloadErr)
                             showToast({ title: "附件删除成功（数据同步失败）", description: reloadErr.message })
                           })
                         })
                        .catch(saveErr => {
                          console.error('[Comment] Auto-save error:', saveErr)
                          showToast({ title: "附件删除成功（评论同步失败）", description: saveErr.message })
                        })
                      })
                     .catch(err => {
                       console.error('[Comment] Delete error:', err)
                       showToast({ title: "附件删除失败", description: err.message })
                     })
}}
                />
              </Show>
              <Show when={archiveDialogOpen()}>
                <ArchiveDialog
                  open={archiveDialogOpen()}
                  onClose={() => setArchiveDialogOpen(false)}
                  onResetArchiving={props.onResetArchiving}
                  onConfirm={handleArchiveConfirm}
                  sessionId={props.sessionId || ""}
                  filePath={props.filePath || ""}
                  tabTitle={getArtifactFilename(props.filePath)}
                />
              </Show>
              <Show when={archiveSuccessOpen()}>
                <DialogArchiveSuccess
                  open={archiveSuccessOpen()}
                  onClose={() => setArchiveSuccessOpen(false)}
                  archivePath={archiveSuccessPath()}
                  shareLink={`${getArchiveBaseUrl()}/developerPreview/designAgent/index.html?uniqueId=${archiveSuccessUniqueId()}`}
                  onViewClick={() => {
                    const url = `${getArchiveBaseUrl()}/developerPreview/designAgent/index.html?uniqueId=${archiveSuccessUniqueId()}`
                    getDesktopApi()?.openLink?.(url)
                  }}
                />
              </Show>
          </DrawOverlay>
       ) : (
        <textarea
          value={extractHtmlContent(props.content)}
          onInput={(e) => props.onContentChange?.(e.currentTarget.value)}
          class="w-full h-full resize-none p-4 text-sm font-mono outline-none"
          style={{
            background: "rgba(243,244,246,1)",
            color: "var(--octo-text-primary)",
            "tab-size": 2,
          }}
          spellcheck={false}
        />
      )}
    </div>
  )
}
