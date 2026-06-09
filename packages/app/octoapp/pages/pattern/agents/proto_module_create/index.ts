import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"
import type { ProtoIntentOutput } from "../proto_intent"

export type ProtoModuleCreateInput = {
  intentDescription: ProtoIntentOutput
  layoutPlanner: Record<string, unknown>
  sectionId: string
  elementId: string
  idPrefix: string
}

export type ProtoModuleCreateOutput = {
  uiJson: Record<string, unknown>
  sectionId: string
  elementId: string
  idPrefix: string
}

export type ProtoModuleCreateContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: ProtoModuleCreateInput
  abortSignal: AbortSignal
}

async function waitForAssistant(sdk: ProtoModuleCreateContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 2000))
    if (signal.aborted) throw new Error("aborted")
    try {
      const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 20 })
      const items = res.data as Array<{ info: { role: string; time: { completed?: number } }; parts: Part[] }> | undefined
      if (!items) continue
      for (let i = items.length - 1; i >= 0; i--) {
        const msg = items[i].info
        if (msg.role !== "assistant") continue
        if (msg.time.completed == null) break
        for (let j = items[i].parts.length - 1; j >= 0; j--) {
          // @ts-ignore
          if (items[i].parts[j].type !== "text" || !items[i].parts[j].text) continue
          // @ts-ignore
          const json = extractA2UIJson(items[i].parts[j].text)
          if (json)
          // @ts-ignore
            return items[i].parts[j].text
        }
      }
    } catch { }
  }
  throw new Error("aborted")
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
          if (parsed.rootId && parsed.elements) return parsed as Record<string, unknown>
        } catch { }
        break
      }
    }
  }

  return null
}

function buildModuleCreatePrompt(input: ProtoModuleCreateInput): string {
  const { intentDescription, layoutPlanner, sectionId, elementId, idPrefix } = input
  const sections = intentDescription.sections
  const sectionDetail = intentDescription.sectionDetailList.find((s) => s.id === sectionId) ?? {}
  const elements = (layoutPlanner.elements as Array<Record<string, unknown>>) ?? []
  const slotElement = elements.find((e) => e.id === elementId) ?? {}

  return [
    `请为以下模块生成 A2UI JSON：`,
    ``,
    `【完整页面蓝图】: ========================`,
    `- 用户输入: ${intentDescription.userInput}`,
    `- 意图分析: ${intentDescription.intentAnalysis}`,
    `- 布局描述: ${intentDescription.layoutDescription}`,
    `- 页面结构: ${JSON.stringify(sections)}`,
    ``,
    `【模块顶层容器】: ========================`,
    `- Root ID: ${elementId}`,
    `- Root UI:`,
    JSON.stringify(slotElement),
    ``,
    `【需要被渲染的模块详细蓝图】: ========================`,
    JSON.stringify(sectionDetail),
    ``,
    `【需要被渲染模块的根节点】: ${elementId}`,
    `【模块内部元素id前缀】: ${idPrefix}`,
  ].join("\n")
}

export async function runProtoModuleCreate(ctx: ProtoModuleCreateContext): Promise<ProtoModuleCreateOutput> {
  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: ctx.parentSessionId,
    agent: "proto_module_create",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create proto_module_create session")

  const promptText = buildModuleCreatePrompt(ctx.input)
  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_module_create",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  console.log("[proto_module_create] raw (first 200 chars):", raw.slice(0, 200))
  const moduleJson = extractA2UIJson(raw)
  if (!moduleJson) throw new Error("proto_module_create did not return valid JSON")

  const rootElementId = ctx.input.elementId
  if (moduleJson.rootId !== rootElementId) {
    const elems = (moduleJson.elements as Array<{ id: string }>) ?? []
    const target = elems.find((e) => e.id === moduleJson.rootId)
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
