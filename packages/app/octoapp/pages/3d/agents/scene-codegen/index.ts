/**
 * scene_3d_codegen —— 3D codegen 3-agent 之「生成」
 * 读 plan JSON（[PLAN_JSON]）+ 用户请求（[USER_REQUEST]），modify 时附 [CURRENT_HANDLERS] /
 * [CURRENT_LIVE_DATA]，产 Markdown 代码块（## file: <path> + fenced code）：
 *   - handlers/<type>/<type>.ts（每 type 一份 ComponentHandler）
 *   - handlers/index.ts（全量，模板 5 + 本轮新增）
 *   - public/live-data.json（全量分组 TreeScene + camera/lights/scene）
 * 输出非 JSON，故 schema=undefined 跳过 validateSchema。host 用 parseCodeFiles 解析。
 */
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { SceneCreateInput } from "../../workflow/create-scene"
import type { PlanResult } from "../scene-plan"

const AGENT_NAME = "scene_3d_codegen"

export type SceneCodegenInput = SceneCreateInput & {
  /** plan 产物（types 选型 + camera/lights/scene） */
  plan: PlanResult
  /** 是否 modify（注入 [CURRENT_HANDLERS] / [CURRENT_LIVE_DATA]） */
  isModify: boolean
  /** modify 时当前全部 handler 源码（含 index.ts），create 时空字符串 */
  currentHandlers?: string
  /** modify 时当前 live-data.json 内容，create 时空字符串 */
  currentLiveData?: string
}

export interface SceneCodegenResult {
  /** codegen agent 的原始 Markdown 输出（## file: + fenced code），host 用 parseCodeFiles 解析 */
  text: string
  childSessionId: string
  error?: string
}

export default async function scene_3d_codegen(input: SceneCodegenInput): Promise<SceneCodegenResult> {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    onSessionCreated,
    userInput,
    plan,
    isModify,
    currentHandlers,
    currentLiveData,
  } = input
  const humanMessage = buildHumanMessage(userInput, plan, isModify, currentHandlers, currentLiveData)
  console.log("----- 3D 代码生成Agent开始执行 ----- ")
  const startTime = Date.now()
  const codegenRes = await runChildSession({
    sync,
    modelKey,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    // codegen 输出 Markdown 代码块（非 JSON），不传 schema 跳过 validateSchema
    schema: undefined,
    onSessionCreated,
    extra: input.extra,
    fileParts: input.fileParts,
  })
  console.log("----- 3D 代码生成Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  logAgentParsed(codegenRes.childSessionId, { summary: `codegen 产出 ${codegenRes.text.length} 字符` })
  return { text: codegenRes.text, childSessionId: codegenRes.childSessionId, error: codegenRes.error }
}

function buildHumanMessage(
  userInput: string,
  plan: PlanResult,
  isModify: boolean,
  currentHandlers?: string,
  currentLiveData?: string,
): string {
  const lines = [`[PLAN_JSON]:`, JSON.stringify(plan, null, 2), ``, `[USER_REQUEST]: ${userInput}`, ``]
  if (isModify) {
    lines.push(`[CURRENT_HANDLERS]:`, currentHandlers?.trim() || `（无）`, ``)
    lines.push(`[CURRENT_LIVE_DATA]:`, currentLiveData?.trim() || `（无）`, ``)
  }
  return lines.join("\n")
}
