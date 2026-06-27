import { extractJson } from '../../utils/json_parser';
import { runChildSession } from "../run_child_session";
import { logAgentParsed } from "../../utils/debug-log"

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
    onSessionCreated } = ctx
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, lastPlanner, lastModules)
  console.log("----- 分诊Agent开始执行 ----- ");
  const startTime = Date.now();
  // 执行 Agent
  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot: true,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession
  })
  console.log("----- 分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 triage json
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) throw new Error("----- Triage JSON did not return valid JSON -----")
  const returnValue = {
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
