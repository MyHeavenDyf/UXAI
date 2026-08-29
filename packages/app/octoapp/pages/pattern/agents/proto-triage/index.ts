import { extractJson } from '../../utils/json-parser';
import { runChildSession } from "../run-child-session";
import { logAgentParsed } from "../../utils/debug-log"
import { TRIAGE_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "proto_triage"

export type TriageInputContext = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户输入
  userInput: string
  // 页面意图
  lastIntent: any,
  // 布局规划
  lastPlanner: any,
  // 模块JSON
  lastModules: any,
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
  // 是否在根 session 上运行（默认 true）
  isRoot?: boolean
  // 文件附件
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
}

export interface TriageModifyItem {
  section_id: string
  element_id: string
  action: string
}

export interface TriageDeleteItem {
  element_id: string
  action: string
}

export interface TriageAddItem {
  action: string
}

export interface TriageResult {
  routing: "regenerate" | "modify" | "chat"
  delete: TriageDeleteItem[]
  add: TriageAddItem[]
  modify: TriageModifyItem[]
  reply: string
  reason: string
  attachment_description: string | null
}

export default async function proto_triage(ctx: TriageInputContext): Promise<TriageResult> {
  const { 
    sdk, 
    sync, 
    modelKey, 
    rootSession, 
    userInput, 
    lastIntent,
    lastPlanner,
    lastModules,
    isRoot = true,
    fileParts,
    onSessionCreated } = ctx
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, lastPlanner, lastModules)
  console.log("----- 分诊Agent开始执行 ----- ");
  const startTime = Date.now();
  // 执行 Agent
  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    fileParts,
    schema: TRIAGE_FORMAT.schema,
  })
  console.log("----- 分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 triage json
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) {
    logAgentParsed(triageRes.childSessionId, { error: "Failed to parse JSON", raw: triageRes.text })
    agentThrow(AGENT_NAME, triageRes.childSessionId, "Triage JSON did not return valid JSON")
  }
  const returnValue = {
    routing: (triageJson.routing as "regenerate" | "modify" | "chat") ?? "regenerate",
    delete: ((triageJson.delete as TriageDeleteItem[]) ?? []).map((d) => ({
      element_id: d.element_id ?? "",
      action: d.action ?? "",
    })),
    add: ((triageJson.add as TriageAddItem[]) ?? []).map((a) => ({
      action: a.action ?? "",
    })),
    modify: ((triageJson.modify as TriageModifyItem[]) ?? []).map((m) => ({
      section_id: m.section_id ?? "",
      element_id: m.element_id ?? "",
      action: m.action ?? "",
    })),
    reply: (triageJson.reply as string) ?? "",
    reason: (triageJson.reason as string) ?? "",
    attachment_description: normalizeAttachmentDesc(triageJson.attachment_description),
  }
  if (returnValue.routing === "chat") {
    const sessionId = triageRes.childSessionId
    const messages = (sync?.data?.message?.[sessionId] ?? []) as Array<Record<string, unknown>>
    const lastAssistant = messages.findLast((m) => m.role === "assistant")
    if (lastAssistant) {
      const parts = (sync?.data?.part?.[lastAssistant.id as string] ?? []) as Array<Record<string, unknown>>
      const textPart = parts.find((p) => p.type === "text")
      if (textPart) {
        await sdk.client.part.update({
          sessionID: sessionId,
          messageID: lastAssistant.id as string,
          partID: textPart.id as string,
          part: { ...textPart, text: returnValue.reply },
        }).catch(() => {})
      }
    }
  }
  return returnValue
}

function buildHumanMessage(userInput:string, lastPlanner: any, lastModules: any): string {
  return [
    `[用户修改请求]: ${userInput}`,
    ``,
    `[当前的顶层布局结构]: ${JSON.stringify(lastPlanner)}`,
    ``,
    `[当前的每个独立模块结构]: ${JSON.stringify(lastModules)}`,
    ``,
  ].join("\n")
}

function normalizeAttachmentDesc(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t === "null" || t === "无" || t === "无图片" || t === "无图像" || t === "N/A") return null
  return t
}
