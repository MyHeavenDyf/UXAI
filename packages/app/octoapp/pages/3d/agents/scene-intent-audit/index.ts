import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"

const AGENT_NAME = "scene_3d_intent_audit"

export interface IntentAuditResult {
  is_pass: boolean
  feedback: string
  current_step: string
}

type SceneIntentAuditInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  sceneDescription: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_intent_audit(input: SceneIntentAuditInput): Promise<IntentAuditResult> {
  const { sdk, sync, modelKey, rootSession, userInput, sceneDescription, onSessionCreated } = input
  const humanMessage = buildHumanMessage(userInput, sceneDescription)
  console.log("----- 3D 意图审核Agent开始执行 ----- ")
  const startTime = Date.now()
  const auditRes = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
  })
  console.log("----- 3D 意图审核Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const auditJson = extractJson(auditRes.text)
  if (!auditJson) {
    logAgentParsed(auditRes.childSessionId, { error: "Failed to parse JSON", raw: auditRes.text })
    throw new Error("----- Scene Intent Audit did not return valid JSON -----")
  }
  const returnValue: IntentAuditResult = {
    is_pass: auditJson.is_pass ?? false,
    feedback: auditJson.feedback ?? "",
    current_step: "intent_audit",
  }
  logAgentParsed(auditRes.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, sceneDescription: string): string {
  return `[用户的原始场景需求:] ==================================
${userInput}

[待审核的场景蓝图:] ==================================
${sceneDescription}

请审核场景蓝图是否完全覆盖用户需求。`
}
