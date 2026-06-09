import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"

export interface TriageModifyItem {
  section_id: string
  element_id: string
  action: string
}

export interface TriageResult {
  routing: "regenerate" | "modify"
  delete: string[]
  add: string[]
  modify: TriageModifyItem[]
  updated_intent: Record<string, unknown>
  reason: string
}

export type TriageContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  userRequest: string
  genuiJson: Record<string, unknown> | null
  layoutPlanner: Record<string, unknown> | null
  moduleResults: Record<string, unknown> | null
  abortSignal: AbortSignal
}

async function waitForAssistant(sdk: TriageContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 2000))
    if (signal.aborted) throw new Error("aborted")
    try {
      const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 10 })
      const items = res.data as Array<{ info: { role: string; time: { completed?: number }; id: string }; parts: Part[] }> | undefined
      if (!items) continue
      for (let i = items.length - 1; i >= 0; i--) {
        const msg = items[i].info
        if (msg.role !== "assistant") continue
        if (msg.time.completed == null) continue
        for (let j = items[i].parts.length - 1; j >= 0; j--) {
          // @ts-ignore
          if (items[i].parts[j].type === "text" && items[i].parts[j].text)
          // @ts-ignore
            return items[i].parts[j].text
        }
      }
    } catch {}
  }
  throw new Error("aborted")
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
    const raw = match ? match[1] : text
    const parsed = JSON.parse(raw.trim())
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {}
  return null
}

function buildTriagePrompt(ctx: TriageContext): string {
  return [
    `[用户修改请求]: ${ctx.userRequest}`,
    ``,
    `[当前的顶层布局结构]: ${JSON.stringify(ctx.layoutPlanner ?? {})}`,
    ``,
    `[当前的每个独立模块结构]: ${JSON.stringify(ctx.moduleResults ?? {})}`,
    ``,
  ].join("\n")
}

function buildRegenerateResult(): TriageResult {
  return {
    routing: "regenerate",
    delete: [],
    add: [],
    modify: [],
    updated_intent: {},
    reason: "首次执行GEN_UI",
  }
}

export async function runProtoTriage(ctx: TriageContext): Promise<TriageResult> {
  if (!ctx.genuiJson) return buildRegenerateResult()

  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: "",
    agent: "proto_triage",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create triage session")

  const promptText = buildTriagePrompt(ctx)
  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_triage",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  const parsed = extractJson(raw)

  if (!parsed) return { ...buildRegenerateResult(), reason: "解析失败，兜底进入重生成" }

  return {
    routing: (parsed.routing as "regenerate" | "modify") ?? "regenerate",
    delete: (parsed.delete as string[]) ?? [],
    add: (parsed.add as string[]) ?? [],
    modify: ((parsed.modify as TriageModifyItem[]) ?? []).map((m) => ({
      section_id: m.section_id ?? "",
      element_id: m.element_id ?? "",
      action: m.action ?? "",
    })),
    updated_intent: (parsed.updated_intent as Record<string, unknown>) ?? {},
    reason: (parsed.reason as string) ?? "",
  }
}
