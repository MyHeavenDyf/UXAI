import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"

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
}

async function waitForAssistant(sdk: ModuleModifyContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
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

function extractA2UIJson(text: string): Record<string, unknown> | null {
  const clean = text.replace(/\ufeff/g, "").replace(/\u200b/g, "").trim()
  const match = clean.match(/(\{[\s\S]*\})/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
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
  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: ctx.parentSessionId,
    agent: "proto_module_modify",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create module_modify session")

  const promptText = buildModifyPrompt(ctx.input)
  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_module_modify",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  const moduleJson = extractA2UIJson(raw)

  if (!moduleJson) throw new Error("module_modify did not return valid JSON")

  const rootElementId = ctx.input.originModules.element_id as string
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
