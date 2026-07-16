import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"

const AGENT_NAME = "scene_3d_intent"

type SceneIntentInput = {
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
  // 上一轮审查意见
  auditFeedback?: string
  // 上一轮审查是否通过
  intentAuditPass?: boolean
  // 上一轮的意图输出
  sceneDescription?: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_intent(input: SceneIntentInput) {
  const { sdk, sync, modelKey, rootSession, userInput, auditFeedback, intentAuditPass, sceneDescription, onSessionCreated } = input
  const humanMessage = buildHumanMessage(userInput, auditFeedback, intentAuditPass, sceneDescription)
  console.log("----- 3D 意图扩展Agent开始执行 ----- ")
  const startTime = Date.now()
  const intentResult = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
  })
  console.log("----- 3D 意图扩展Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  const intentJson = extractJson(intentResult.text)
  if (!intentJson) {
    logAgentParsed(intentResult.childSessionId, { error: "Failed to parse JSON", raw: intentResult.text })
    throw new Error("----- Scene Intent did not return valid JSON -----")
  }
  const returnValue = {
    intent_description: intentJson,
    intent_page: simplifyData(intentJson),
    current_step: "intent_expansion",
  }
  logAgentParsed(intentResult.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, auditFeedback: string | undefined, intentAuditPass: boolean | undefined, sceneDescription: string | undefined): string {
  let humanMessage: string
  if (auditFeedback && !intentAuditPass) {
    humanMessage = `你上一次生成的场景蓝图未通过审核校验，请务必参考以下反馈进行迭代修复：
    [用户的原始需求:] ==================================
    ${userInput}

    [待修正场景蓝图:] ==================================
    ${sceneDescription}

    [蓝图审核结果:] ==================================
    ${auditFeedback}

    请根据评审意见结论修正场景蓝图。`
  } else {
    humanMessage = `[用户的需求:] ==================================
    ${userInput}

    请开始 3D 场景意图扩展。`
  }
  return humanMessage
}

// 将复杂的 intent_description 数据转换为精简版 intent_page（场景语义）
export function simplifyData(complexData: any) {
  const data = complexData ?? {}
  const sceneDescription = data.sceneAnalysis ?? ""
  const layoutDescription = data.layoutDescription ?? ""

  const sectionDetailList = data.sectionDetailList ?? []
  const detailMap = sectionDetailList.reduce((map: any, detail: any) => {
    if (detail?.id) {
      map[detail.id] = detail
    }
    return map
  }, {})

  const sections = data.sections ?? []
  const newSections = sections.map((section: any) => {
    const sectionId = section?.id
    const sectionName = section?.name
    const detail = detailMap[sectionId] ?? {}
    const intent = detail.intent ?? ""
    const functionField = detail.function ?? ""
    return {
      id: sectionId,
      name: sectionName,
      intent,
      function: functionField,
    }
  })

  return {
    sceneDescription,
    layoutDescription,
    sections: newSections,
  }
}
