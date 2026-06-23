import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { StepIndicator, type StepStatus } from "./step-indicator"
import type { StepPhase } from "./step-a-output"

const EDITOR_URL = "http://localhost:5175/preview#/editor"
const PREVIEW_URL = "http://localhost:4173/preview#/preview"

export type DslNodeChange = {
  nid: number
  changes: Record<string, string>
}

export function EditorIframe(props: {
  phase: StepPhase
  dslJson: string
  onDslNodeChange?: (change: DslNodeChange) => void
  onConfirmRender?: () => void
  onRenderDone?: () => void
}): JSX.Element {
  let iframeRef: HTMLIFrameElement | undefined
  const [iframeReady, setIframeReady] = createSignal(false)
  const [pendingJson, setPendingJson] = createSignal<string | null>(null)
  const [pendingRender, setPendingRender] = createSignal(false)

  const [dslLoadedOk, setDslLoadedOk] = createSignal<boolean | null>(null)
  const [dslLoadedError, setDslLoadedError] = createSignal<string | null>(null)
  const [renderLoadedOk, setRenderLoadedOk] = createSignal<boolean | null>(null)
  const [renderLoadedError, setRenderLoadedError] = createSignal<string | null>(null)

  const iframeSrc = createMemo(() =>
    props.phase.startsWith("c-") ? PREVIEW_URL : EDITOR_URL
  )

  const steps = createMemo(() => {
    const aStatus: StepStatus = "done"
    const bStatus: StepStatus =
      props.phase === "b-generating" ? "active" :
      props.phase === "b-done" || props.phase.startsWith("c-") ? "done" : "pending"
    const cStatus: StepStatus =
      props.phase === "c-generating" ? "active" :
      props.phase === "c-done" ? "done" : "pending"
    return [
      { label: "语义描述", status: aStatus },
      { label: "DSL生成", status: bStatus },
      { label: "预览渲染", status: cStatus },
    ]
  })

  function postMessage(type: string, payload?: unknown) {
    if (!iframeRef?.contentWindow) return
    iframeRef.contentWindow.postMessage({ type, payload }, "*")
  }

  function postDslJson(json: string) {
    if (!iframeRef?.contentWindow) {
      setPendingJson(json)
      return
    }
    try {
      const payload = JSON.parse(json)
      postMessage("NODE_DSL_JSON", payload)
      setPendingJson(null)
    } catch (e) {
      console.warn("[dslToHex] editor-iframe: postMessage parse failed:", e)
    }
  }

  function postDslClear() {
    if (!iframeRef?.contentWindow) return
    postMessage("NODE_DSL_CLEAR")
  }

  function postDslPipeline(json: string) {
    if (!iframeRef?.contentWindow) return
    try {
      const payload = JSON.parse(json)
      postMessage("NODE_DSL_PIPELINE", payload)
    } catch (e) {
      console.warn("[dslToHex] editor-iframe: pipeline postMessage parse failed:", e)
    }
  }

  // b-generating → clear iframe canvas + reset loaded state
  createEffect(on(
    () => props.phase === "b-generating",
    (isGenerating) => {
      if (isGenerating) {
        postDslClear()
        setDslLoadedOk(null)
        setDslLoadedError(null)
      }
    },
  ))

  // b-done → send DSL JSON for preview
  createEffect(on(
    () => props.phase === "b-done" ? props.dslJson : null,
    (json) => {
      if (!json) return
      setDslLoadedOk(null)
      setDslLoadedError(null)
      if (iframeReady()) postDslJson(json)
      else setPendingJson(json)
    },
  ))

  createEffect(on(iframeReady, (ready) => {
    if (!ready) return
    if (props.phase === "b-done") {
      const json = pendingJson()
      if (json) postDslJson(json)
      else if (props.dslJson) postDslJson(props.dslJson)
    }
    if (props.phase === "c-generating" && pendingRender()) {
      setPendingRender(false)
      if (props.dslJson) postDslPipeline(props.dslJson)
    }
  }))

  // c-generating → switch iframe src + send pipeline command after ready
  createEffect(on(
    () => props.phase === "c-generating",
    (isC) => {
      if (!isC) return
      setRenderLoadedOk(null)
      setRenderLoadedError(null)
      setIframeReady(false)
      const json = props.dslJson
      if (json && iframeReady()) postDslPipeline(json)
      else setPendingRender(true)
    },
  ))

  createEffect(() => {
    const iframe = iframeRef
    if (!iframe) return
    function handler(e: MessageEvent) {
      if (e.source !== iframe?.contentWindow) return
      const data = e.data
      if (data?.type === "DSL_NODE_UPDATED") {
        const { nid, changes } = data.payload ?? {}
        if (typeof nid === "number" && changes) {
          props.onDslNodeChange?.({ nid, changes })
        }
      }
      if (data?.type === "NODE_DSL_LOADED") {
        const payload = data.payload ?? {}
        if (payload.success) {
          if (props.phase === "b-done") setDslLoadedOk(true)
        } else {
          const err = payload.error ?? "unknown error"
          if (props.phase === "b-done") { setDslLoadedOk(false); setDslLoadedError(err) }
        }
      }
      if (data?.type === "PIPELINE_LOADED") {
        const payload = data.payload ?? {}
        if (payload.success) {
          if (props.phase === "c-generating") { setRenderLoadedOk(true); props.onRenderDone?.(); console.log("[dslToHex] PIPELINE_LOADED ok") }
        } else {
          const err = payload.error ?? "unknown error"
          if (props.phase === "c-generating") { setRenderLoadedOk(false); setRenderLoadedError(err); console.log("[dslToHex] PIPELINE_LOADED error:", err) }
        }
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const showConfirmBtn = createMemo(() =>
    props.phase === "b-done" && dslLoadedOk() === true
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: "#fff" }}>
      <StepIndicator steps={steps()} />

      <div
        class="flex items-center justify-between shrink-0"
        style={{ height: "40px", padding: "0 20px", "border-bottom": "1px solid rgba(0,0,0,0.06)" }}
      >
        <span style={{ "font-size": "14px", "font-weight": 600, color: "#191919" }}>
          {props.phase.startsWith("c-") ? "预览渲染" : "DSL 线框图"}
        </span>
        <button
          type="button"
          onClick={() => props.onConfirmRender?.()}
          style={{
            padding: "4px 12px",
            "border-radius": "4px",
            border: "none",
            background: "#3478F6",
            color: "#fff",
            "font-size": "12px",
            "font-weight": 500,
            visibility: showConfirmBtn() ? "visible" : "hidden",
          }}
        >
          确认渲染
        </button>
      </div>

      <Show when={props.phase === "b-done" && dslLoadedOk() === false}>
        <div class="shrink-0 flex items-center justify-center" style={{ padding: "8px 16px", background: "#FFF5F5", "border-bottom": "1px solid rgba(0,0,0,0.06)" }}>
          <span style={{ "font-size": "12px", color: "#E53E3E" }}>DSL 加载失败: {dslLoadedError()}</span>
        </div>
      </Show>

      <div class="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src={iframeSrc()}
          onload={() => setIframeReady(true)}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
          }}
        />
        <Show when={props.phase === "b-generating"}>
          <div class="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(255,255,255,0.92)", zIndex: 10 }}>
            <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: "octo-spin 1s linear infinite" }}>
              <circle cx="20" cy="20" r="16" fill="none" stroke="#3478F6" stroke-width="3" stroke-dasharray="80 30" stroke-linecap="round" />
            </svg>
            <span style={{ "font-size": "15px", "font-weight": 500, color: "#333", "margin-top": "16px" }}>正在生成线框图</span>
            <span style={{ "font-size": "13px", color: "#999", "margin-top": "4px" }}>AI 正在将语义描述转化为可视化布局</span>
          </div>
        </Show>
      </div>
    </div>
  )
}
