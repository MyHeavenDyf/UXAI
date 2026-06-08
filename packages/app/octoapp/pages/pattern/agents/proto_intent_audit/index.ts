import type { Session, Part } from "@opencode-ai/sdk/v2/client"
import type { SDK } from "@/context/sdk"

export type ProtoIntentAuditInput = {
  userRequest: string
  blueprint: string
}

export type ProtoIntentAuditOutput = {
  isPass: boolean
  feedback: string
}

export type ProtoIntentAuditContext = {
  sdk: { client: SDK["client"] }
  directory: string
  modelKey: { providerID: string; modelID: string }
  parentSessionId: string
  input: ProtoIntentAuditInput
  abortSignal: AbortSignal
}

async function waitForAssistant(sdk: ProtoIntentAuditContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
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

export async function runProtoIntentAudit(ctx: ProtoIntentAuditContext): Promise<ProtoIntentAuditOutput> {
  const childResult = await ctx.sdk.client.session.create({
    directory: ctx.directory,
    parentID: ctx.parentSessionId,
    agent: "proto_intent_audit",
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error("failed to create proto_intent_audit session")

  const promptText = [
    `[用户的原始需求:] ==================================`,
    ctx.input.userRequest,
    ``,
    `[需要评审的蓝图:] ==================================`,
    ctx.input.blueprint,
    ``,
    `请开始审计，若发现任何不一致，请指出。`,
  ].join("\n")

  await ctx.sdk.client.session.promptAsync({
    sessionID: childSession.id,
    agent: "proto_intent_audit",
    ...(ctx.modelKey ? { model: ctx.modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  const raw = await waitForAssistant(ctx.sdk, childSession.id, ctx.abortSignal)
  const parsed = extractJson(raw)

  return {
    isPass: (parsed?.is_pass as boolean) ?? true,
    feedback: (parsed?.feedback as string) ?? "解析失败，默认放行",
  }
}
