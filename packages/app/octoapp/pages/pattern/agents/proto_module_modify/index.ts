import type { SDK } from "@/context/sdk"
import { runChildSession } from "../run-child-session"

export interface ModuleModifyInput {
  layoutPlanner: Record<string, unknown>
  idPrefix: string
  sectionId: string
  originModules: Record<string, unknown>
  modifications: Record<string, unknown>
}

export interface ModuleModifyResult {
  uiJson: Record<string, unknown>
  sectionId: string
  elementId: string
  idPrefix: string
}

export type ModuleModifyContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: ModuleModifyInput
  abortSignal: AbortSignal
  sync?: any
  onSessionCreated?: (childSessionID: string) => void
}

function extractA2UIJson(text: string): Record<string, unknown> | null {
  const clean = text.replace(/\ufeff/g, "").replace(/\u200b/g, "").trim()

  const codeBlockMatch = clean.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>
      if (parsed.rootId && parsed.elements) return parsed
    } catch { }
  }

  const starts: number[] = []
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") starts.push(i)
  }

  for (const start of starts) {
    let depth = 0
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === "{") depth++
      if (clean[i] === "}") depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(clean.slice(start, i + 1)) as Record<string, unknown>
          if (parsed.rootId && parsed.elements) return parsed
        } catch { }
        break
      }
    }
  }

  return null
}

function buildModifyPrompt(input: ModuleModifyInput): string {
  return [
    `[顶层布局和Slots]: ===============`,
    JSON.stringify(input.layoutPlanner),
    ``,
    `[模块内部元素id前缀]: ===============`,
    input.idPrefix,
    ``,
    `[当前正在修改模块section_id]: ===============`,
    input.sectionId,
    ``,
    `[UI JSON数据] ===============`,
    JSON.stringify(input.originModules),
    ``,
    `[修改意见] ===============`,
    JSON.stringify(input.modifications),
  ].join("\n")
}

export async function runModuleModify(ctx: ModuleModifyContext): Promise<ModuleModifyResult> {
  const promptText = buildModifyPrompt(ctx.input)
  const raw = await runChildSession({
    client: ctx.sdk.client,
    directory: ctx.directory,
    parentSessionID: ctx.parentSessionId,
    agent: "proto_module_modify",
    modelKey: ctx.modelKey,
    prompt: promptText,
    sync: ctx.sync,
    onSessionCreated: ctx.onSessionCreated,
  })

  console.log("[module_modify] raw (first 300 chars):", raw.slice(0, 300))
  const moduleJson = extractA2UIJson(raw)

  if (!moduleJson) throw new Error("module_modify did not return valid JSON")

  const rootElementId = ctx.input.originModules.rootId as string
  if (moduleJson.rootId !== rootElementId) {
    const target = (moduleJson.elements as Array<{ id: string }>)?.find((e) => e.id === moduleJson.rootId)
    if (target) {
      target.id = rootElementId
      moduleJson.rootId = rootElementId
    }
  }


  return {
    uiJson: moduleJson,
    sectionId: ctx.input.sectionId,
    elementId: rootElementId,
    idPrefix: ctx.input.idPrefix,
  }
}
