import { createRoot, createEffect } from "solid-js"
import { getDesktopApi } from "../utils/desktop-api"

/**
 * 反应式监听主 agent 的 request_pattern tool call。
 * 检测到后调用 callback。返回 dispose 函数。
 */
export function watchRequestPattern(
  sync: any,
  sid: string,
  onRequestPattern: (userRequirement: string) => void,
): () => void {
  const handled = new Set<string>()
  return createRoot((dispose) => {
    createEffect(() => {
      const messages = (sync?.data?.message?.[sid] ?? []) as any[]
      const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant")
      if (!lastAssistant || handled.has(lastAssistant.id)) return
      const parts = (sync?.data?.part?.[lastAssistant.id] ?? []) as any[]
      const toolCall = parts.find((p: any) =>
        p.type === "tool" && (p.tool === "request_pattern" || p.name === "request_pattern"),
      )
      if (!toolCall) return
      handled.add(lastAssistant.id)
      const state = (toolCall as any).state as Record<string, unknown> | undefined
      const input = state?.input as Record<string, unknown> | undefined
      const userRequirement = (input?.userRequirement as string) ?? ""
      onRequestPattern(userRequirement)
    })
    return dispose
  })
}

/**
 * 反应式监听主 agent 的生成回合完成。
 * 检测到新 assistant 消息完成 → 提取 JSON（文件优先 / 文本 fallback）→ callback。
 */
export function watchGenerationComplete(
  sync: any,
  sid: string,
  knownMsgIds: Set<string>,
  pageJsonPath: string,
  onComplete: (pageJson: any) => void,
): () => void {
  let done = false

  return createRoot((dispose) => {
    // 异步提取：读文件 → fallback 文本 → callback → dispose
    const extract = async () => {
      let pageJson: any = null

      // 方式1：读文件（agent 调了 write）
      const api = getDesktopApi()
      if (api?.readFileBuffer) {
        for (let r = 0; r < 5; r++) {
          try {
            const buf = await api.readFileBuffer(pageJsonPath)
            if (buf) {
              pageJson = JSON.parse(new TextDecoder().decode(buf as ArrayBuffer))
              console.log("[watchGenerationComplete] read from file:", pageJsonPath)
              break
            }
          } catch { /* file not ready */ }
          await new Promise((rr) => setTimeout(rr, 500))
        }
      }

      // 方式2：fallback 从文本提取
      if (!pageJson) {
        const messages = (sync?.data?.message?.[sid] ?? []) as any[]
        const newAssistant = [...messages].reverse().find(
          (m: any) => m.role === "assistant" && !knownMsgIds.has(m.id),
        )
        if (newAssistant) {
          const parts = (sync?.data?.part?.[newAssistant.id] ?? []) as any[]
          const textParts = parts.filter((p: any) => p.type === "text").map((p: any) => p.text || "").join("")
          const cleaned = textParts.replace(/```json\s*/g, "").replace(/```/g, "").trim()
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            try {
              pageJson = JSON.parse(jsonMatch[0])
              console.log("[watchGenerationComplete] extracted from text (fallback)")
            } catch { /* invalid JSON */ }
          }
        }
      }

      onComplete(pageJson)
      dispose()
    }

    // 反应式检测：新 assistant 消息完成
    createEffect(() => {
      if (done) return
      const messages = (sync?.data?.message?.[sid] ?? []) as any[]
      const newAssistant = [...messages].reverse().find(
        (m: any) => m.role === "assistant" && !knownMsgIds.has(m.id),
      )
      if (!newAssistant) return
      const parts = (sync?.data?.part?.[newAssistant.id] ?? []) as any[]

      // DEBUG: 打印每一步状态
      const toolParts = parts.filter((p: any) => p.type === "tool")
      const textParts = parts.filter((p: any) => p.type === "text")
      console.log("[watchGen] newAssistant:", newAssistant.id, "parts:", parts.length,
        "tools:", toolParts.map((p: any) => `${p.tool || p.name}:${p.state?.status}`).join(","),
        "texts:", textParts.length)

      const hasText = textParts.length > 0
      const writeDone = toolParts.some(
        (p: any) => (p.tool === "write" || p.name === "write") && p.state?.status === "completed",
      )
      const anyToolPending = toolParts.some((p: any) => p.state?.status === "pending")
      const sessionStatus = sync?.data?.session_status?.[sid]
      console.log("[watchGen] hasText:", hasText, "writeDone:", writeDone, "anyToolPending:", anyToolPending,
        "sessionStatus:", sessionStatus?.type, JSON.stringify(sessionStatus))

      // 宽松完成判定：有文本输出 且 没有 pending 工具；或者 session 变 idle
      const sessionIdle = sessionStatus?.type === "idle" || sessionStatus?.type === "completed"
      const isComplete = (!anyToolPending && hasText) || writeDone || sessionIdle
      if (!isComplete) return
      done = true
      console.log("[watchGen] COMPLETE detected, extracting...")
      void extract()
    })

    // 超时 120s
    setTimeout(() => {
      if (!done) {
        done = true
        console.warn("[watchGenerationComplete] timed out (120s)")
        onComplete(null)
        dispose()
      }
    }, 120000)

    return dispose
  })
}
