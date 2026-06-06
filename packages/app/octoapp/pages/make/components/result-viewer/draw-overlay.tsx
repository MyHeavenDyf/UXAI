import { createSignal, createEffect, Show, onMount, onCleanup, type JSX } from "solid-js"

interface Point { x: number; y: number }
interface Stroke { points: Point[] }
interface NormalizedRect { x: number; y: number; width: number; height: number }
type MarkTool = 'box' | 'pen'

export const ANNOTATION_EVENT = 'octo:annotation'

export interface AnnotationEventDetail {
  file: File | null
  note: string
  action: 'queue' | 'send'
  ack?: (result: { ok: boolean; message?: string }) => void
}

interface Props {
  children: JSX.Element
  active?: boolean
  onActiveChange?: (active: boolean) => void
  sendDisabled?: boolean
}

const STROKE_COLOR = '#ff3b30'
const STROKE_WIDTH = 4

export function DrawOverlay(props: Props): JSX.Element {
  let wrapRef: HTMLDivElement | undefined
  let canvasRef: HTMLCanvasElement | undefined
  
  const [note, setNote] = createSignal('')
  const [markTool, setMarkTool] = createSignal<MarkTool>('box')
  const [hasInk, setHasInk] = createSignal(false)
  const [hasBox, setHasBox] = createSignal(false)
  const [undoCount, setUndoCount] = createSignal(0)
  const [redoCount, setRedoCount] = createSignal(0)
  const [pendingAction, setPendingAction] = createSignal<'queue' | 'send' | null>(null)
  const [captureWarning, setCaptureWarning] = createSignal<{
    action: 'queue' | 'send'
    message: string
  } | null>(null)
  
  let strokesRef: Stroke[] = []
  let undoneStrokesRef: Stroke[] = []
  let drawingRef: Stroke | null = null
  let selectionBoxRef: NormalizedRect | null = null
  let boxDraftRef: { start: Point; current: Point } | null = null
  let composingRef = false
  
  const sending = () => pendingAction() !== null

  function redraw() {
    const cvs = canvasRef
    if (!cvs) return
    if (typeof window.CanvasRenderingContext2D === 'undefined') return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cvs.width, cvs.height)
    ctx.strokeStyle = STROKE_COLOR
    const dpr = window.devicePixelRatio || 1
    ctx.lineWidth = STROKE_WIDTH * dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const all = drawingRef ? [...strokesRef, drawingRef] : strokesRef
    const box = boxDraftRef
      ? normalizedRectFromPoints(boxDraftRef.start, boxDraftRef.current)
      : selectionBoxRef
    if (box) drawNormalizedBox(ctx, box, cvs.width, cvs.height)
    for (const s of all) {
      const first = s.points[0]
      if (!first) continue
      ctx.beginPath()
      ctx.moveTo(first.x * cvs.width, first.y * cvs.height)
      for (let i = 1; i < s.points.length; i++) {
        const p = s.points[i]
        if (p) ctx.lineTo(p.x * cvs.width, p.y * cvs.height)
      }
      ctx.stroke()
    }
  }

  // Canvas resize logic - runs when canvas becomes available
  createEffect(() => {
    const show = showCanvas()
    if (!show) return
    
    const checkRefs = () => {
      const wrap = wrapRef
      const cvs = canvasRef
      if (!wrap || !cvs) {
        requestAnimationFrame(checkRefs)
        return
      }
      
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      
      cvs.width = Math.max(1, Math.floor(rect.width * dpr))
      cvs.height = Math.max(1, Math.floor(rect.height * dpr))
      cvs.style.width = `${rect.width}px`
      cvs.style.height = `${rect.height}px`
      redraw()
      
      if (typeof ResizeObserver !== 'undefined') {
        const resize = () => {
          const rect = wrap.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          cvs.width = Math.max(1, Math.floor(rect.width * dpr))
          cvs.height = Math.max(1, Math.floor(rect.height * dpr))
          cvs.style.width = `${rect.width}px`
          cvs.style.height = `${rect.height}px`
          redraw()
        }
        const ro = new ResizeObserver(resize)
        ro.observe(wrap)
        onCleanup(() => ro.disconnect())
      }
    }
    
    checkRefs()
  })

  createEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        props.onActiveChange?.(false)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoStroke()
        else undoStroke()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  function syncHistoryState() {
    setHasInk(strokesRef.length > 0)
    setHasBox(Boolean(selectionBoxRef))
    setUndoCount(strokesRef.length)
    setRedoCount(undoneStrokesRef.length)
  }

  function pointFromEvent(e: MouseEvent | PointerEvent): Point {
    const cvs = canvasRef!
    const rect = cvs.getBoundingClientRect()
    const x = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
    const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    }
  }

  function activePreviewIframe(): HTMLIFrameElement | null {
    return (
      wrapRef?.querySelector<HTMLIFrameElement>('iframe[data-od-active="true"]') ?? 
      wrapRef?.querySelector<HTMLIFrameElement>('iframe')
    ) ?? null
  }

  function snapshotHostIframe(): HTMLIFrameElement | null {
    return (
      wrapRef?.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]') ?? 
      activePreviewIframe()
    )
  }

  function canTryDirectFrameScroll(iframe: HTMLIFrameElement): boolean {
    const sandbox = iframe.getAttribute('sandbox')
    return sandbox === null || /\ballow-same-origin\b/.test(sandbox)
  }

  function postFrameScrollBy(win: Window, left: number, top: number): boolean {
    try {
      win.postMessage({ type: 'od:preview-scroll-by', left, top }, '*')
      return true
    } catch {
      return false
    }
  }

  function scrollPreviewIframeBy(iframe: HTMLIFrameElement, left: number, top: number): boolean {
    const win = iframe.contentWindow
    if (!win) return false

    if (canTryDirectFrameScroll(iframe)) {
      try {
        const scrollBy = win.scrollBy
        if (typeof scrollBy === 'function') {
          win.scrollBy({ left, top, behavior: 'auto' })
          return true
        }
      } catch {
        // Sandboxed / cross-origin frames throw on Window property reads.
      }
    }

    return postFrameScrollBy(win, left, top)
  }

  function onPointerDown(e: MouseEvent & { pointerId?: number }) {
    if (!props.active || sending()) return
    if (e.pointerId) (e.target as Element).setPointerCapture?.(e.pointerId)
    const point = pointFromEvent(e)
    if (markTool() === 'box') {
      boxDraftRef = { start: point, current: point }
      selectionBoxRef = null
      syncHistoryState()
      redraw()
      return
    }
    drawingRef = { points: [point] }
    redraw()
  }

  function onPointerMove(e: MouseEvent) {
    if (!props.active || sending()) return
    if (boxDraftRef) {
      boxDraftRef.current = pointFromEvent(e)
      redraw()
      return
    }
    if (!drawingRef) return
    drawingRef.points.push(pointFromEvent(e))
    redraw()
  }

  function onPointerUp(e: MouseEvent) {
    if (!props.active || sending()) return
    if (boxDraftRef) {
      boxDraftRef.current = pointFromEvent(e)
      const next = normalizedRectFromPoints(boxDraftRef.start, boxDraftRef.current)
      boxDraftRef = null
      selectionBoxRef = next.width >= 0.006 && next.height >= 0.006 ? next : null
      syncHistoryState()
      redraw()
      return
    }
    if (!drawingRef) return
    if (drawingRef.points.length > 1) {
      strokesRef.push(drawingRef)
      undoneStrokesRef = []
      syncHistoryState()
    }
    drawingRef = null
    redraw()
  }

  function onCanvasWheel(e: WheelEvent) {
    if (!props.active || sending()) return
    const iframe = activePreviewIframe()
    if (!iframe) return
    if (scrollPreviewIframeBy(iframe, e.deltaX, e.deltaY)) {
      e.preventDefault()
    }
  }

  function clearInk() {
    strokesRef = []
    undoneStrokesRef = []
    drawingRef = null
    selectionBoxRef = null
    boxDraftRef = null
    syncHistoryState()
    redraw()
  }

  function undoStroke() {
    if (sending()) return
    if (selectionBoxRef || boxDraftRef) {
      selectionBoxRef = null
      boxDraftRef = null
      syncHistoryState()
      redraw()
      return
    }
    const stroke = strokesRef.pop()
    if (!stroke) return
    undoneStrokesRef.push(stroke)
    drawingRef = null
    syncHistoryState()
    redraw()
  }

  function redoStroke() {
    if (sending()) return
    const stroke = undoneStrokesRef.pop()
    if (!stroke) return
    strokesRef.push(stroke)
    drawingRef = null
    syncHistoryState()
    redraw()
  }

  function closeOverlay() {
    // Clear all drawing state before closing
    clearInk()
    props.onActiveChange?.(false)
  }

  // Clear state when overlay becomes inactive
  createEffect(() => {
    if (props.active) return
    strokesRef = []
    undoneStrokesRef = []
    drawingRef = null
    selectionBoxRef = null
    boxDraftRef = null
    setHasInk(false)
    setHasBox(false)
    setUndoCount(0)
    setRedoCount(0)
  })

  // Clear state on mount
  onMount(() => {
    clearInk()
  })

  async function requestSnapshot(): Promise<{ dataUrl: string; w: number; h: number } | null> {
    const iframe = snapshotHostIframe()
    if (!iframe) return null
    const timeouts = [1500, 3000, 6000]
    for (const timeout of timeouts) {
      const snapshot = await requestPreviewSnapshot(iframe, timeout)
      if (snapshot) return snapshot
    }
    return null
  }

  async function requestPreviewSnapshot(
    iframe: HTMLIFrameElement,
    timeout: number
  ): Promise<{ dataUrl: string; w: number; h: number } | null> {
    const id = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
    
    console.log('[Draw] Requesting snapshot from iframe')
    iframe.contentWindow?.postMessage({ type: 'od:snapshot', id }, '*')

    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          console.error('[Draw] Snapshot timeout after', timeout, 'ms')
          settled = true
          resolve(null)
        }
      }, timeout)

      const handleMessage = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return
        const d = e.data
        
        if (d?.type === 'od:snapshot:result' && d?.id === id) {
          console.log('[Draw] Received snapshot result:', {
            hasError: !!d?.error,
            error: d?.error,
            hasDataUrl: !!d?.dataUrl,
            fallback: !!d?.fallback,
            w: d?.w,
            h: d?.h
          })
          
          if (settled) return
          
          if (d?.error) {
            console.error('[Draw] Snapshot error from iframe:', d.error)
            settled = true
            clearTimeout(timer)
            resolve(null)
            return
          }
          
          if (d?.fallback && d?.w && d?.h) {
            console.log('[Draw] Snapshot fallback: drawing only')
            settled = true
            clearTimeout(timer)
            resolve({ dataUrl: '', w: d.w, h: d.h })
          } else if (d?.dataUrl && d?.w && d?.h) {
            console.log('[Draw] Snapshot success')
            settled = true
            clearTimeout(timer)
            resolve({ dataUrl: d.dataUrl, w: d.w, h: d.h })
          } else {
            console.error('[Draw] Snapshot missing dataUrl or dimensions')
            settled = true
            clearTimeout(timer)
            resolve(null)
          }
        }
      }

      window.addEventListener('message', handleMessage)
      setTimeout(() => window.removeEventListener('message', handleMessage), timeout)
    })
  }

  async function compositeWithBackground(snap: { dataUrl: string; w: number; h: number }): Promise<Blob | null> {
    const iframe = activePreviewIframe()
    if (!iframe) return null
    const rect = iframe.getBoundingClientRect()
    const out = document.createElement('canvas')
    out.width = snap.w
    out.height = snap.h
    const ctx = out.getContext('2d')
    if (!ctx) return null

    // Fill with white background if no snapshot (fallback mode)
    if (!snap.dataUrl) {
      console.log('[Draw] No background snapshot, using white background')
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, snap.w, snap.h)
    } else {
      // Draw iframe snapshot
      const bg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = snap.dataUrl
      })
      if (!bg) return null
      ctx.drawImage(bg, 0, 0, snap.w, snap.h)
    }

    const sx = snap.w / Math.max(1, rect.width)
    const sy = snap.h / Math.max(1, rect.height)
    if (selectionBoxRef) drawNormalizedBox(ctx, selectionBoxRef, snap.w, snap.h)

    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH * Math.max(sx, sy)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const s of strokesRef) {
      const first = s.points[0]
      if (!first) continue
      ctx.beginPath()
      ctx.moveTo(first.x * snap.w, first.y * snap.h)
      for (let i = 1; i < s.points.length; i++) {
        const p = s.points[i]
        if (p) ctx.lineTo(p.x * snap.w, p.y * snap.h)
      }
      ctx.stroke()
    }

    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'))
  }

  async function send(action: 'queue' | 'send') {
    const shouldCapture = hasInk() || hasBox()
    const canSubmit = shouldCapture || Boolean(note().trim())
    
    console.log('[Draw] send:', {
      action,
      shouldCapture,
      hasInk: hasInk(),
      hasBox: hasBox(),
      noteLength: note().trim().length
    })
    
    if (sending() || !canSubmit) return
    if (action === 'send' && props.sendDisabled) return

    setCaptureWarning(null)
    setPendingAction(action)

    try {
      let file: File | null = null
      if (shouldCapture) {
        console.log('[Draw] Attempting screenshot...')
        let blob: Blob | null = null
        const snap = await requestSnapshot()
        console.log('[Draw] Snapshot result:', snap ? { w: snap.w, h: snap.h } : null)
        if (snap) blob = await compositeWithBackground(snap)
        if (!blob) {
          console.error('[Draw] Screenshot failed')
          setCaptureWarning({
            action,
            message: 'Failed to capture screenshot',
          })
          return
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        file = new File([blob], `drawing-${ts}.png`, { type: 'image/png' })
      }

      const result = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        let settled = false
        const finish = (next: { ok: boolean; message?: string }) => {
          if (settled) return
          settled = true
          resolve(next)
        }

        window.setTimeout(() => {
          finish({ ok: false, message: 'Annotation timeout' })
        }, 60000)

        const detail: AnnotationEventDetail = {
          file,
          note: note().trim(),
          action,
          ack: finish,
        }

        window.dispatchEvent(new CustomEvent(ANNOTATION_EVENT, { detail }))
      })

      if (!result.ok) {
        setCaptureWarning({
          action,
          message: result.message || 'Annotation failed',
        })
        return
      }

      clearInk()
      setCaptureWarning(null)
      setNote('')
    } finally {
      setPendingAction(null)
    }
  }

  const overlayPointer = () => props.active ? 'auto' : 'none'
  const showCanvas = () => props.active || hasInk() || hasBox()
  const canSubmit = () => hasInk() || hasBox() || Boolean(note().trim())
  const canSend = () => canSubmit() && !props.sendDisabled
  const canUndo = () => (undoCount() > 0 || hasBox()) && !sending()
  const canRedo = () => redoCount() > 0 && !sending()

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      }}
    >
      {props.children}
      <Show when={showCanvas()}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onCanvasWheel}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            'pointer-events': overlayPointer(),
            cursor: props.active ? 'crosshair' : 'default',
          }}
        />
      </Show>
      <Show when={props.active}>
        <Show when={captureWarning()}>
          {(warning) => (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: '82px',
                transform: 'translateX(-50%)',
                display: 'flex',
                'align-items': 'center',
                'max-width': 'min(420px, calc(100% - 32px))',
                padding: '8px 12px',
                'border-radius': '999px',
                background: 'rgba(20,20,20,0.92)',
                color: '#fff',
                'box-shadow': '0 6px 24px rgba(0,0,0,0.18)',
                'backdrop-filter': 'blur(8px)',
                'z-index': 11,
                'pointer-events': 'none',
                'font-size': '13px',
                'line-height': '1.35',
              }}
            >
              <span>{warning().message}</span>
            </div>
          )}
        </Show>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '16px',
            transform: 'translateX(-50%)',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '6px 8px',
            background: 'rgba(20,20,20,0.92)',
            color: '#fff',
            'border-radius': '999px',
            'box-shadow': '0 6px 24px rgba(0,0,0,0.18)',
            'backdrop-filter': 'blur(8px)',
            'z-index': 10,
            'pointer-events': 'auto',
            'font-size': '13px',
          }}
        >
          <button
            type="button"
            onClick={closeOverlay}
            disabled={sending()}
            aria-label="Close"
            title="Close"
            style={{
              border: 'none',
              'border-radius': '999px',
              width: '28px',
              height: '28px',
              padding: 0,
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
          <div
            style={{
              display: 'inline-flex',
              'align-items': 'center',
              gap: '4px',
              padding: '3px',
              'border-radius': '999px',
              background: 'rgba(255,255,255,0.08)',
            }}
          >
            <button
              type="button"
              onClick={() => setMarkTool('box')}
              disabled={sending()}
              aria-label="Box select"
              title="Box select"
              style={{
                border: 'none',
                'border-radius': '999px',
                width: '34px',
                height: '30px',
                padding: 0,
                display: 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center',
                background: markTool() === 'box' ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: '#fff',
                'font-size': '12px',
                'font-weight': markTool() === 'box' ? '650' : '500',
                cursor: 'pointer',
              }}
            >
              ▢
            </button>
            <button
              type="button"
              onClick={() => setMarkTool('pen')}
              disabled={sending()}
              aria-label="Pen"
              title="Pen"
              style={{
                border: 'none',
                'border-radius': '999px',
                width: '34px',
                height: '30px',
                padding: 0,
                display: 'inline-flex',
                'align-items': 'center',
                'justify-content': 'center',
                background: markTool() === 'pen' ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: '#fff',
                'font-size': '12px',
                'font-weight': markTool() === 'pen' ? '650' : '500',
                cursor: 'pointer',
              }}
            >
              ✎
            </button>
          </div>
          <button
            type="button"
            onClick={undoStroke}
            disabled={!canUndo()}
            style={{
              border: '1px solid rgba(255,255,255,0.18)',
              'border-radius': '999px',
              width: '28px',
              height: '28px',
              padding: 0,
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'rgba(255,255,255,0.06)',
              color: 'inherit',
              opacity: canUndo() ? '1' : '0.36',
              cursor: canUndo() ? 'pointer' : 'not-allowed',
            }}
            aria-label="Undo"
            title="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redoStroke}
            disabled={!canRedo()}
            style={{
              border: '1px solid rgba(255,255,255,0.18)',
              'border-radius': '999px',
              width: '28px',
              height: '28px',
              padding: 0,
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'rgba(255,255,255,0.06)',
              color: 'inherit',
              opacity: canRedo() ? '1' : '0.36',
              cursor: canRedo() ? 'pointer' : 'not-allowed',
            }}
            aria-label="Redo"
            title="Redo"
          >
            ↷
          </button>
          <input
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            disabled={sending()}
            placeholder="Annotation note"
            style={{
              background: 'rgba(218, 97, 56, 0.18)',
              border: '1px solid rgba(248, 150, 104, 0.82)',
              'border-radius': '999px',
              outline: 'none',
              'box-shadow': '0 0 0 3px rgba(218, 97, 56, 0.22)',
              color: 'inherit',
              width: '280px',
              padding: '4px 8px',
              'font-size': '13px',
            }}
            onCompositionStart={() => { composingRef = true }}
            onCompositionEnd={() => { composingRef = false }}
            onKeyDown={(e) => {
              if (composingRef) return
              if (e.key === 'Enter') {
                e.preventDefault()
                send('send')
              }
            }}
          />
          <button
            type="button"
            onClick={() => send('queue')}
            disabled={sending() || !canSubmit()}
            aria-label={pendingAction() === 'queue' ? 'Queueing...' : 'Queue'}
            title={pendingAction() === 'queue' ? 'Queueing...' : 'Queue'}
            style={{
              border: '1px solid rgba(255,255,255,0.2)',
              'border-radius': '999px',
              width: '36px',
              height: '36px',
              padding: 0,
              'font-size': '13px',
              cursor: sending() ? 'wait' : (canSubmit() ? 'pointer' : 'not-allowed'),
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'transparent',
              color: 'inherit',
              opacity: canSubmit() ? '1' : '0.4',
            }}
          >
            {pendingAction() === 'queue' ? '...' : '☰'}
          </button>
          <button
            type="button"
            onClick={() => send('send')}
            disabled={sending() || !canSend()}
            aria-label={pendingAction() === 'send' ? 'Sending...' : 'Send'}
            title={pendingAction() === 'send' ? 'Sending...' : 'Send'}
            style={{
              border: 'none',
              'border-radius': '999px',
              width: '36px',
              height: '36px',
              padding: 0,
              'font-size': '13px',
              cursor: sending() ? 'wait' : (canSend() ? 'pointer' : 'not-allowed'),
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              background: 'var(--accent)',
              color: '#fff',
              opacity: canSend() ? '1' : '0.4',
            }}
          >
            {pendingAction() === 'send' ? '...' : '→'}
          </button>
        </div>
      </Show>
    </div>
  )
}

function normalizedRectFromPoints(a: Point, b: Point): NormalizedRect {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x, b.x)
  const bottom = Math.max(a.y, b.y)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function drawNormalizedBox(ctx: CanvasRenderingContext2D, box: NormalizedRect, width: number, height: number) {
  const left = box.x * width
  const top = box.y * height
  const boxWidth = Math.max(1, box.width * width)
  const boxHeight = Math.max(1, box.height * height)
  ctx.save()
  ctx.fillStyle = 'rgba(255, 59, 48, 0.10)'
  ctx.strokeStyle = STROKE_COLOR
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.002))
  ctx.setLineDash([10, 6])
  ctx.fillRect(left, top, boxWidth, boxHeight)
  ctx.strokeRect(left, top, boxWidth, boxHeight)
  ctx.restore()
}