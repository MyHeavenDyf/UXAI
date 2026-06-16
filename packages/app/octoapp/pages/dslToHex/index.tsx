import { createEffect, createSignal, onCleanup, Show, Match, Switch } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMediaQuery } from "@solid-primitives/media"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { DslToHexSidebar } from "./sidebar"
import { Steps } from "./steps"

const STEPS = [
  { title: "描述扩展" },
  { title: "页面生成" },
  { title: "优化调整" },
]

const EXPAND_SYSTEM = `你是一个 UI 设计专家。用户会描述一个想要的页面，请将其扩展为详细的页面设计说明，涵盖：导航栏结构、主体内容区布局、各功能模块、侧边栏（如有）、底部信息等。输出中文，结构清晰。`

export default function DslToHexPage() {
  const isSmall = createMediaQuery("(max-width: 640px)")
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const projectDir = useProjectDir()

  const [sidebarWidth, setSidebarWidth] = createSignal(260)
  const [submitted, setSubmitted] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [currentStep, setCurrentStep] = createSignal(0)

  // step 1 state
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [expandedText, setExpandedText] = createSignal("")
  const [isStreaming, setIsStreaming] = createSignal(false)

  // listen to SSE events for streaming text
  createEffect(() => {
    const unsub = globalSDK.event.listen((e) => {
      const sid = sessionId()
      if (!sid) return
      const props = e.details.properties as Record<string, unknown> | undefined
      const eventSid = props?.sessionID as string | undefined
      if (eventSid !== sid) return

      if (e.details.type === "message.part.delta") {
        const field = props?.field as string | undefined
        const delta = props?.delta as string | undefined
        if (field === "text" && delta) setExpandedText((t) => t + delta)
      }

      if (e.details.type === "session.status") {
        const status = props?.status as { type: string } | undefined
        if (status?.type === "idle") setIsStreaming(false)
      }
    })
    onCleanup(unsub)
  })

  function handleSidebarResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(360, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    onCleanup(() => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    })
  }

  async function handleSubmit() {
    const text = draft().trim()
    if (!text) return

    setSubmitted(true)
    setCurrentStep(0)
    setExpandedText("")
    setIsStreaming(true)

    const dir = projectDir()
    if (!dir) { setIsStreaming(false); return }

    try {
      const client = globalSDK.createClient({ directory: dir })
      const result = await client.session.create({ directory: dir, agent: "octo_make" })
      const session = result.data as Session | undefined
      if (!session?.id) { setIsStreaming(false); return }
      setSessionId(session.id)

      const modelStr = globalSync.data.config.model
      const [providerID, modelID] = modelStr ? modelStr.split("/") : []
      const model = providerID && modelID ? { providerID, modelID } : undefined

      await client.session.prompt({
        sessionID: session.id,
        agent: "octo_make",
        system: EXPAND_SYSTEM,
        ...(model ? { model } : {}),
        parts: [{ type: "text", text }],
      })
    } catch (err) {
      console.error("[dslToHex] step1 prompt failed", err)
      setIsStreaming(false)
    }
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", "min-height": "0", overflow: "hidden", position: "relative" }}>
      <DslToHexSidebar width={sidebarWidth()} />

      {/* resize hot zone */}
      <div
        style={{
          position: "absolute", top: "0", bottom: "0",
          left: `${sidebarWidth() - 10}px`, width: "20px",
          cursor: "col-resize", "z-index": "10",
        }}
        onMouseDown={handleSidebarResize}
      />

      {/* main content */}
      <div style={{ flex: "1", "min-width": "0", display: "flex", "flex-direction": "column", overflow: "hidden", position: "relative" }}>

        {/* input dialog overlay */}
        <Show when={!submitted()}>
          <div style={{
            position: "absolute", inset: "0", "z-index": "20",
            display: "flex", "align-items": "center", "justify-content": "center",
            background: "rgba(255,255,255,0.7)",
            "backdrop-filter": "blur(4px)",
          }}>
            <div style={{
              width: "480px", "max-width": "calc(100% - 48px)",
              background: "#fff",
              "border-radius": "16px",
              "box-shadow": "0 8px 40px rgba(0,0,0,0.12)",
              padding: "32px",
              display: "flex",
              "flex-direction": "column",
              gap: "16px",
            }}>
              <div>
                <div style={{ "font-size": "18px", "font-weight": "600", color: "rgba(0,0,0,0.9)", "margin-bottom": "6px" }}>
                  描述你想要的页面
                </div>
                <div style={{ "font-size": "13px", color: "rgba(0,0,0,0.45)" }}>
                  请描述页面的功能、风格和内容，AI 将为你生成完整页面
                </div>
              </div>
              <textarea
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if ((e.key === "Enter" || e.code === "Enter") && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSubmit()
                  }
                }}
                placeholder="例如：一个现代风格的个人博客首页，包含导航栏、文章列表、侧边栏和页脚…"
                rows={5}
                style={{
                  width: "100%",
                  resize: "none",
                  "border-radius": "10px",
                  border: "1px solid rgba(0,0,0,0.12)",
                  padding: "12px 14px",
                  "font-size": "14px",
                  "line-height": "22px",
                  color: "rgba(0,0,0,0.85)",
                  outline: "none",
                  "font-family": "inherit",
                  "box-sizing": "border-box",
                }}
              />
              <div style={{ display: "flex", "justify-content": "flex-end", "align-items": "center", gap: "8px" }}>
                <span style={{ "font-size": "12px", color: "rgba(0,0,0,0.3)" }}>⌘ Enter 提交</span>
                <button
                  type="button"
                  disabled={!draft().trim()}
                  onClick={() => void handleSubmit()}
                  style={{
                    height: "36px",
                    padding: "0 20px",
                    "border-radius": "8px",
                    background: draft().trim() ? "#0A59F7" : "rgba(0,0,0,0.06)",
                    color: draft().trim() ? "#fff" : "rgba(0,0,0,0.25)",
                    "font-size": "14px",
                    "font-weight": "500",
                    border: "none",
                    cursor: draft().trim() ? "pointer" : "not-allowed",
                    transition: "all 150ms ease",
                  }}
                >
                  开始生成
                </button>
              </div>
            </div>
          </div>
        </Show>

        {/* steps bar */}
        <div style={{
          "flex-shrink": "0",
          padding: isSmall() ? "16px 20px" : "16px 32px",
          width: isSmall() ? "100%" : "50%",
          "margin-left": "auto",
          "margin-right": "auto",
          "box-sizing": "border-box",
        }}>
          <Steps
            current={currentStep()}
            direction={isSmall() ? "vertical" : "horizontal"}
            items={STEPS}
          />
        </div>

        {/* step content */}
        <div style={{ flex: "1", "min-height": "0", overflow: "hidden" }}>
          <Switch>
            <Match when={currentStep() === 0}>
              <div style={{
                padding: "24px 32px",
                height: "100%",
                "box-sizing": "border-box",
                overflow: "auto",
              }}>
                <Show when={expandedText() || isStreaming()} fallback={
                  <div style={{ color: "rgba(0,0,0,0.3)", "font-size": "14px" }}>等待输入…</div>
                }>
                  <div style={{
                    "font-size": "14px",
                    "line-height": "26px",
                    color: "rgba(0,0,0,0.75)",
                    "white-space": "pre-wrap",
                    "max-width": "720px",
                  }}>
                    {expandedText()}
                    <Show when={isStreaming()}>
                      <span style={{
                        display: "inline-block",
                        width: "2px", height: "16px",
                        background: "#0A59F7",
                        "margin-left": "2px",
                        "vertical-align": "middle",
                        animation: "blink 1s step-end infinite",
                      }} />
                      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
                    </Show>
                  </div>
                </Show>
              </div>
            </Match>
            <Match when={currentStep() === 1}>
              <iframe src="about:blank" style={{ width: "100%", height: "100%", border: "none" }} />
            </Match>
            <Match when={currentStep() === 2}>
              <iframe src="about:blank" style={{ width: "100%", height: "100%", border: "none" }} />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}
