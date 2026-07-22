import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import { SCENE_TRIAGE_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "scene_3d_triage"

export type TriageInputContext = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  lastIntent: any
  lastPlanner: any
  lastSceneObjects: any
  onSessionCreated?: (childSessionID: string) => void
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

export default async function scene_3d_triage(ctx: TriageInputContext): Promise<TriageResult> {
  const { sdk, sync, modelKey, rootSession, userInput, lastIntent, lastPlanner, lastSceneObjects, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(userInput, lastPlanner, lastSceneObjects)
  console.log("----- 3D 场景分诊Agent开始执行 ----- ")
  const startTime = Date.now()
  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot: true,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_TRIAGE_FORMAT.schema,
  })
  console.log("----- 3D 场景分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) {
    logAgentParsed(triageRes.childSessionId, { error: "Failed to parse JSON", raw: triageRes.text })
    agentThrow(AGENT_NAME, triageRes.childSessionId, "Scene Triage did not return valid JSON")
  }
  const returnValue: TriageResult = {
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
  logAgentParsed(triageRes.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, lastPlanner: any, lastSceneObjects: any): string {
  return [
    `[用户修改请求]: ${userInput}`,
    ``,
    `[当前的顶层场景布局结构]: ${JSON.stringify(lastPlanner)}`,
    ``,
    `[当前的每个分区物体结构]: ${JSON.stringify(lastSceneObjects)}`,
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
