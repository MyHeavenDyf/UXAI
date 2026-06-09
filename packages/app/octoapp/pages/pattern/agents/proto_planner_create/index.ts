import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"

export type ProtoPlannerCreateInput = {
  blueprint: Record<string, unknown>
}

export interface PlannerSlot {
  section_id: string
  element_id: string
  id_prefix: string
}

export interface PlannerElement {
  id: string
  component: string
  props: Record<string, unknown>
  children: string[]
}

export type ProtoPlannerCreateOutput = {
  rootId: string
  elements: PlannerElement[]
  slots: PlannerSlot[]
}

export type ProtoPlannerCreateContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: ProtoPlannerCreateInput
  abortSignal: AbortSignal
}

async function waitForAssistant(sdk: ProtoPlannerCreateContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 2000))
    if (signal.aborted) throw new Error("aborted")
    try {
      const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 10 })
      const items = res.data as Array<{ info: { role: string; time: { completed?: number } }; parts: Part[] }> | undefined
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
  const clean = text.replace(/\ufeff/g, "").replace(/\u200b/g, "").trim()
  try {
    const match = clean.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
    const raw = match ? match[1] : clean
    const parsed = JSON.parse(raw.trim())
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {}
  const brace = clean.match(/(\{[\s\S]*\})/)
  if (!brace) return null
  try {
    const parsed = JSON.parse(brace[1])
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {}
  return null
}

export async function runProtoPlannerCreate(ctx: ProtoPlannerCreateContext): Promise<ProtoPlannerCreateOutput> {
  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: ctx.parentSessionId,
    agent: "proto_planner_create",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create proto_planner_create session")

  const promptText = [
    `请根据以下页面蓝图，设计外壳布局并指定下一步细化模块：`,
    ``,
    `【Page Blue_print】: =================================`,
    ``,
    JSON.stringify(ctx.input.blueprint),
    ``,
  ].join("\n")

  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_planner_create",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  const parsed = extractJson(raw)
  if (!parsed) throw new Error("proto_planner_create did not return valid JSON")

  return {
    rootId: (parsed.rootId as string) ?? "",
    elements: (parsed.elements as PlannerElement[]) ?? [],
    slots: ((parsed.slots as PlannerSlot[]) ?? []).map((s) => ({
      section_id: s.section_id ?? "",
      element_id: s.element_id ?? "",
      id_prefix: s.id_prefix ?? "",
    })),
  }
}
