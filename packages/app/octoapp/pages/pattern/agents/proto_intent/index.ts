import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"

export type ProtoIntentInput = {
  userRequest: string
  previousBlueprint?: Record<string, unknown>
  auditFeedback?: string
}

export type ProtoIntentOutput = {
  userInput: string
  intentAnalysis: string
  layoutDescription: string
  sections: Array<{ id: string; name: string; description: string }>
  sectionDetailList: Array<{
    id: string
    name: string
    intent: string
    function: string
    layout: string
    elements: string
    data: Record<string, unknown>
  }>
}

export type ProtoIntentContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: ProtoIntentInput
  abortSignal: AbortSignal
}

async function waitForAssistant(sdk: ProtoIntentContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
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
          if (items[i].parts[j].type === "text" && items[i].parts[j].text)
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

function buildIntentPrompt(input: ProtoIntentInput): string {
  if (input.auditFeedback && input.previousBlueprint) {
    return [
      `你上一次生成的蓝图未通过审核校验，请务必参考以下反馈进行迭代修复：`,
      `[用户的原始需求:] ==================================`,
      input.userRequest,
      ``,
      `[待修正界面蓝图:] ==================================`,
      JSON.stringify(input.previousBlueprint),
      ``,
      `[蓝图审核结果:] ==================================`,
      input.auditFeedback,
      ``,
      `请根据评审意见结论修正界面蓝图。`,
    ].join("\n")
  }
  return [
    `[用户需求:] ==================================`,
    input.userRequest,
    ``,
    `请开始意图扩展。`,
  ].join("\n")
}

export async function runProtoIntent(ctx: ProtoIntentContext): Promise<ProtoIntentOutput> {
  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: ctx.parentSessionId,
    agent: "proto_intent",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create proto_intent session")

  const promptText = buildIntentPrompt(ctx.input)
  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_intent",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  const parsed = extractJson(raw)
  if (!parsed) throw new Error("proto_intent did not return valid JSON")

  return {
    userInput: (parsed.userInput as string) ?? ctx.input.userRequest,
    intentAnalysis: (parsed.intentAnalysis as string) ?? "",
    layoutDescription: (parsed.layoutDescription as string) ?? "",
    sections: (parsed.sections as ProtoIntentOutput["sections"]) ?? [],
    sectionDetailList: (parsed.sectionDetailList as ProtoIntentOutput["sectionDetailList"]) ?? [],
  }
}
