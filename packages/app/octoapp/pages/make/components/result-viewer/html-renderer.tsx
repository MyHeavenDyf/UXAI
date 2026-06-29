import { createMemo, createSignal, createEffect, on, onMount, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { buildSrcdoc, annotateElementsWithIds } from "../../utils/srcdoc-builder"
import { getArtifactServeUrl, getArtifactRelativePath, pathToLocalUrl, isElectronDesktop } from "../../utils/artifact-file-api"
import { PreviewOverlay } from "../preview-overlay"
import { InspectPanel } from "./inspect-panel"
import { ManualEditPanel, emptyManualEditDraft, type ManualEditDraft } from "./manual-edit-panel"
import { DrawOverlay } from "./draw-overlay"
import type { ManualEditTarget, ManualEditPatch, ManualEditStyles } from "../../edit-mode/source-patches"
import { readManualEditFields, readManualEditAttributes, readManualEditOuterHtml, inspectorManualEditStyles, applyManualEditPatch, emptyManualEditStyles, MANUAL_EDIT_STYLE_PROPS } from "../../edit-mode/source-patches"
import { showToast } from "@opencode-ai/ui/toast"
import { tracker } from "@/utils/tracker"
import "./inspect-panel.css"
import "./manual-edit-panel.css"

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
  onDrawActiveChange?: (active: boolean) => void
  inspectPanel?: boolean
  onInspectTarget?: (target: InspectTarget | null) => void
  onSaveOverrides?: (overrides: Array<{ elementId: string; prop: string; value: string }>) => void
  onContentChange?: (content: string) => void
  refreshKey?: number
  filePath?: string
  sessionId?: string
  sdkUrl?: string
  sdkDirectory?: string
  onSaveFile?: (content: string) => Promise<void>
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
      props.onContentChange?.(wrapHtmlContent(state.html, props.content))
      return true
    }
    return false
  }
  
  // Redo: go forward in history
  function redo(): boolean {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++
      const state = historyStack[historyIndex]
      props.onContentChange?.(wrapHtmlContent(state.html, props.content))
      return true
    }
    return false
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
      // ★ Remove data-od-id attributes before saving (clean output)
      const cleanSource = result.source.replace(/ data-od-id="[^"]*"/g, '')
      props.onContentChange?.(wrapHtmlContent(cleanSource, props.content))
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
      annotateElements: true,
    }) + (key > 0 ? `<script data-refresh-key="${key}"></script>` : "")
  })

  const shouldUseLocalUrl = createMemo(() => {
    return isElectronDesktop() && props.filePath
  })

  const localUrl = createMemo(() => {
    if (!shouldUseLocalUrl()) return undefined
    return pathToLocalUrl(props.filePath!)
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
            // Remove data-od-id and save
            const cleanSource = result.source.replace(/ data-od-id="[^"]*"/g, '')
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
      // Clear inspect target when inspecting mode is turned off
      if (!props.inspecting) {
        setInspectTarget(null)
        props.onInspectTarget?.(null)
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
      style={{ overflow: "auto", background: isResponsive() ? "var(--octo-shell-bg, #F3F6FB)" : "white", position: "relative", ...containerStyle() }}
    >
      {props.mode === "preview" ? (
        <DrawOverlay
          active={props.drawing ?? false}
          onActiveChange={props.onDrawActiveChange}
          sendDisabled={false}
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
                srcdoc={shouldUseLocalUrl() || shouldUseServeUrl() ? undefined : srcdoc()}
                sandbox="allow-scripts"
                style={{
                  width: `${VIEWPORT_DIMS[props.viewport!].width}px`,
                  height: `${VIEWPORT_DIMS[props.viewport!].height}px`,
                  border: "none",
                }}
              />
            </div>
          ) : (
            <div style={{ "min-width": "800px", height: "100%" }}>
              <iframe
                ref={iframeRef}
                src={shouldUseLocalUrl() ? localUrl() : (shouldUseServeUrl() ? serveUrl() : undefined)}
                srcdoc={shouldUseLocalUrl() || shouldUseServeUrl() ? undefined : srcdoc()}
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
                        // Step 4: Clean IDs and save
                        const cleanHtml = doc.documentElement.outerHTML.replace(/ data-od-id="[^"]*"/g, '')
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
                busy={false}
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
                  // Store to pending (waiting for Save button)
                  const mergedStyles = { ...editDraft().styles, ...styles }
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
                const cleanSource = result.source.replace(/ data-od-id="[^"]*"/g, '')
                const updatedContent = wrapHtmlContent(cleanSource, props.content)
                props.onContentChange?.(updatedContent)
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
                   const ok = await flushManualEditStyleSave()
                   if (ok) {
                    tracker.interaction({ module: "design", name: "save-edit-changes" })
                     setEditTarget(null)
                     manualEditPendingStyle = null
                     manualEditPendingText = null
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
}}
onFloatingPositionChange={setEditPanelPosition}
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
