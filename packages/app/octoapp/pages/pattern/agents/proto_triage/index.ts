import { runChildSession } from "../run-child-session"

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
  sdk: { client: any }
  directory: string
  modelKey: { providerID: string; modelID: string }
  userRequest: string
  genuiJson: Record<string, unknown> | null
  layoutPlanner: Record<string, unknown> | null
  moduleResults: Record<string, unknown> | null
  sessionId?: string
  abortSignal: AbortSignal
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

  const promptText = buildTriagePrompt(ctx)
  const raw = await runChildSession({
    client: ctx.sdk.client,
    directory: ctx.directory,
    parentSessionID: ctx.sessionId ?? "",
    agent: "proto_triage",
    modelKey: ctx.modelKey,
    prompt: promptText,
  })

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
