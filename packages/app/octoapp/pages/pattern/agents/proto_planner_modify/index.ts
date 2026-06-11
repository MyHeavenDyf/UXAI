import type { SDK } from "@/context/sdk"
import { runChildSession } from "../run-child-session"

export interface PlannerModifySlot {
  section_id: string
  element_id: string
  id_prefix: string
  operation: "create" | "modify" | "none"
}

export interface PlannerModifyElement {
  id: string
  component: string
  props: Record<string, unknown>
  children: string[]
}

export interface PlannerModifyOutput {
  rootId: string
  elements: PlannerModifyElement[]
  slots: PlannerModifySlot[]
}

export type PlannerModifyInput = {
  intentReason: string
  intentDelete: string[]
  intentAdd: string[]
  intentModify: Array<{ section_id: string; element_id: string; action: string }>
  intentPage: Record<string, unknown>
  layoutPlanner: Record<string, unknown>
}

export type PlannerModifyContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: PlannerModifyInput
  abortSignal: AbortSignal
  sync?: any
  onSessionCreated?: (childSessionID: string) => void
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

function cleanSlots(layoutPlanner: Record<string, unknown>): Record<string, unknown> {
  const slots = (layoutPlanner.slots as Array<Record<string, unknown>>) ?? []
  return {
    ...layoutPlanner,
    slots: slots.map((s) => ({ ...s, operation: "none" })),
  }
}

function buildModifyPrompt(input: PlannerModifyInput): string {
  const cleanLayout = cleanSlots(input.layoutPlanner)
  return [
    `请根据以下内容，修改外壳布局并指定下一步细化模块：`,
    ``,
    `【Explicit Modification Directives】: ========================`,
    `- 总体需求: ${input.intentReason}`,
    `- 需要删除的模块: ${JSON.stringify(input.intentDelete)}`,
    `- 需要新增的模块: ${JSON.stringify(input.intentAdd)}`,
    `- 需要修改的模块: ${JSON.stringify(input.intentModify)}`,
    ``,
    `【Page Blueprint】: ========================`,
    JSON.stringify(input.intentPage),
    ``,
    `【Original Macro-Layout JSON & Intent-to-Container Mappings】: ========================`,
    JSON.stringify(cleanLayout),
    ``,
  ].join("\n")
}

export async function runProtoPlannerModify(ctx: PlannerModifyContext): Promise<{
  output: PlannerModifyOutput
  removedSectionIds: string[]
}> {
  const promptText = buildModifyPrompt(ctx.input)
  const raw = await runChildSession({
    client: ctx.sdk.client,
    directory: ctx.directory,
    parentSessionID: ctx.parentSessionId,
    agent: "proto_planner_modify",
    modelKey: ctx.modelKey,
    prompt: promptText,
    sync: ctx.sync,
    onSessionCreated: ctx.onSessionCreated,
  })

  console.log("[proto_planner_modify] raw (first 300 chars):", raw.slice(0, 300))
  const parsed = extractJson(raw)
  if (!parsed) throw new Error("proto_planner_modify did not return valid JSON\nraw: " + raw.slice(0, 500))

  const output: PlannerModifyOutput = {
    rootId: (parsed.rootId as string) ?? "",
    elements: (parsed.elements as PlannerModifyElement[]) ?? [],
    slots: ((parsed.slots as PlannerModifySlot[]) ?? []).map((s) => ({
      section_id: s.section_id ?? "",
      element_id: s.element_id ?? "",
      id_prefix: s.id_prefix ?? "",
      operation: (s.operation as "create" | "modify" | "none") ?? "none",
    })),
  }

  const newSectionIds = new Set(output.slots.map((s) => s.section_id))
  const oldSlots = (ctx.input.layoutPlanner.slots as Array<Record<string, unknown>>) ?? []
  const removedSectionIds = oldSlots.map((s) => s.section_id as string).filter((id) => !newSectionIds.has(id))

  return { output, removedSectionIds }
}
