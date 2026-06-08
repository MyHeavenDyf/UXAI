import type { Message, Session } from "@opencode-ai/sdk/v2/client"

const AGENT_NAME = "proto_intent_audit"

type ProtoIntentAuditInput = {
  sdk: any
  sync: any
  modelKey: string
  rootSession: string
  userInput: string
  intentDescription: string
}

export default async function proto_intent_audit(input: ProtoIntentAuditInput) {
  const { sdk, sync, modelKey, rootSession, userInput, intentDescription } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, intentDescription)
  // 执行 Agent
  const auditResult = await runAgent(sdk, sync, modelKey, rootSession, humanMessage)
  // 转换成 audit json
  const intentJson = extractJsonFromText(auditResult)
  if (!intentJson) throw new Error("----- Intent Audit did not return valid JSON -----")
  return {
    "intent_audit_pass": intentJson.is_pass,
    "intent_audit_feedback": intentJson.feedback,
    "current_step": "intent_audit"
  };
}

// run OpenCode SDK
async function runAgent(sdk: any, sync: any, modelKey: string, rootSession: string, humanMessage: string): Promise<string> {
  // create new session
  const newSession = await sdk.client.session.create({
    directory: sdk.directory,
    parentID: rootSession,
    agent: AGENT_NAME,
  })
  const sessionData = newSession.data as Session | undefined
  if (!sessionData) throw new Error("----- Failed to create new session -----")

  // run session 
  await sdk.client.session.prompt({
    sessionID: sessionData.id,
    agent: AGENT_NAME,
    model: modelKey,
    parts: [{ type: "text", text: humanMessage }]
  })

  // get result
  let result = getLastAssistantText(sessionData.id, sync);
  if (!result) throw new Error("----- Intent Audit agent returned NULL -----")
  return result;
}

// 组装意图审查的输入文本
function buildHumanMessage(userInput: string, intentDescription: string){
  let humanMessage: string;
  humanMessage = `[用户的原始需求:] ==================================
  ${userInput}

  [需要评审的蓝图:] ==================================
  ${intentDescription}
  
  请开始审计，若发现未满足用户需求，请指出。`;
  return humanMessage;
}

// 获取最终结果数据
function getLastAssistantText(sessionId: string, sync:any): string | null {
  const messages = (sync.data.message[sessionId] ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    const parts = (sync.data.part[msg.id] ?? []) as Array<{ type: string; text?: string }>
    for (const p of [...parts].reverse()) {
      if (p.type === "text" && p.text) return p.text
    }
  }
  return null
}

// transfrom text to json
function extractJsonFromText(text: string): Record<string, unknown> | null {
  try {
    const raw = text.includes("```json") ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text : text;
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object") return parsed
  } catch {}
  return null
}