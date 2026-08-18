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
  /** 当前场景已有的 type 清单（新 codegen 流；片C 从 mergedSceneConfig keys 取）。旧调用不传 */
  currentTypes?: string[]
  /** 是否已有场景（片C 传；旧调用由 lastSceneObjects.length 推断） */
  hasScene?: boolean
  /** 文件附件（图片等，传给 agent 的 prompt parts；供 triage 看图描述 attachment_description） */
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
}

// legacy item 类型 —— 旧 8-agent 孤儿文件（modify-scene-ai.ts）仍读 TriageResult.delete/add/modify，
// codegen 流不再产出这些（LLM 只输出 routing+types），wrapper 默认 []。Step 8 清理孤儿后可删。
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

export interface TriageTypes {
  create: string[]
  modify: string[]
}

export interface TriageResult {
  routing: "create" | "modify" | "chat"
  types: TriageTypes
  // legacy（孤儿兼容，codegen 流恒为空数组）
  delete: TriageDeleteItem[]
  add: TriageAddItem[]
  modify: TriageModifyItem[]
  reply: string
  reason: string
  attachment_description: string | null
}

export default async function scene_3d_triage(ctx: TriageInputContext): Promise<TriageResult> {
  const { sync, modelKey, rootSession, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(ctx)
  console.log("----- 3D 场景分诊Agent开始执行 ----- ")
  const startTime = Date.now()
  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot: true,
    onSessionCreated,
    agent: AGENT_NAME,
    client: ctx.sdk.client,
    prompt: humanMessage,
    directory: ctx.sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_TRIAGE_FORMAT.schema,
    fileParts: ctx.fileParts,
  })
  console.log("----- 3D 场景分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) {
    logAgentParsed(triageRes.childSessionId, { error: "Failed to parse JSON", raw: triageRes.text })
    agentThrow(AGENT_NAME, triageRes.childSessionId, "Scene Triage did not return valid JSON")
  }
  const rawTypes = (triageJson.types ?? {}) as { create?: unknown; modify?: unknown }
  const returnValue: TriageResult = {
    routing: (triageJson.routing as "create" | "modify" | "chat") ?? "create",
    types: {
      create: toStringArray(rawTypes.create),
      modify: toStringArray(rawTypes.modify),
    },
    // codegen 流 LLM 不再输出 delete/add/modify；留空数组供孤儿 modify-scene-ai.ts 不崩
    delete: [],
    add: [],
    modify: [],
    reply: (triageJson.reply as string) ?? "",
    reason: (triageJson.reason as string) ?? "",
    attachment_description: normalizeAttachmentDesc(triageJson.attachment_description),
  }
  logAgentParsed(triageRes.childSessionId, returnValue)
  return returnValue
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

function buildHumanMessage(ctx: TriageInputContext): string {
  const lines = [`[用户请求]: ${ctx.userInput}`, ``]
  if (ctx.hasScene === false) {
    lines.push(`[当前场景状态]: 无场景（首次生成）`)
  } else if (ctx.currentTypes && ctx.currentTypes.length > 0) {
    lines.push(`[当前场景已有 type 分组]: ${JSON.stringify(ctx.currentTypes)}`)
  } else if (ctx.lastPlanner || (ctx.lastSceneObjects && ctx.lastSceneObjects.length > 0)) {
    // 兼容旧 8-agent 调用（lastPlanner / lastSceneObjects）
    lines.push(`[当前场景布局]: ${JSON.stringify(ctx.lastPlanner)}`)
    lines.push(`[当前场景物体]: ${JSON.stringify(ctx.lastSceneObjects)}`)
  } else {
    lines.push(`[当前场景状态]: 无场景（首次生成）`)
  }
  return lines.join("\n")
}

function normalizeAttachmentDesc(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t === "null" || t === "无" || t === "无图片" || t === "无图像" || t === "N/A") return null
  return t
}
