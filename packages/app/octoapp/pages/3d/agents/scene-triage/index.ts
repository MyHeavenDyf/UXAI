import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"

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

export interface TriageResult {
  routing: "regenerate" | "modify" | "chat"
  delete: string[]
  add: string[]
  modify: TriageModifyItem[]
  reply: string
  updated_intent: Record<string, unknown>
  reason: string
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
  })
  console.log("----- 3D 场景分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) {
    logAgentParsed(triageRes.childSessionId, { error: "Failed to parse JSON", raw: triageRes.text })
    throw new Error("----- Scene Triage did not return valid JSON -----")
  }
  const returnValue: TriageResult = {
    routing: (triageJson.routing as "regenerate" | "modify" | "chat") ?? "regenerate",
    delete: (triageJson.delete as string[]) ?? [],
    add: (triageJson.add as string[]) ?? [],
    modify: ((triageJson.modify as TriageModifyItem[]) ?? []).map((m) => ({
      section_id: m.section_id ?? "",
      element_id: m.element_id ?? "",
      action: m.action ?? "",
    })),
    reply: (triageJson.reply as string) ?? "",
    updated_intent: (triageJson.updated_intent as Record<string, unknown>) ?? {},
    reason: (triageJson.reason as string) ?? "",
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
