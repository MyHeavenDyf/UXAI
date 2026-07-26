import { extractJson } from '../../utils/json-parser';
import { runChildSession } from '../run-child-session';
import { logAgentParsed } from "../../utils/debug-log"
import { INTENT_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "proto_intent"
type ProtoIntentInput = {
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
  pageDescription?: string
  // 额外补充信息，透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_intent(input: ProtoIntentInput) {
  const { sdk, sync, modelKey, rootSession, userInput, auditFeedback, intentAuditPass, pageDescription, onSessionCreated } = input
  const patterns = input.extra?.patterns as any[] | undefined
  const humanMessage = buildHumanMessage(userInput, auditFeedback, intentAuditPass, pageDescription, patterns)
  console.log("----- 意图扩展Agent开始执行 ----- ");
  const startTime = Date.now();
  // 执行 Agent
  const intentResult = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: INTENT_FORMAT.schema,
  })
  console.log("----- 意图扩展Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 json 数据
  const intentJson = extractJson(intentResult.text)
  if (!intentJson) {
    logAgentParsed(intentResult.childSessionId, { error: "Failed to parse JSON", raw: intentResult.text })
    agentThrow(AGENT_NAME, intentResult.childSessionId, "Intent Audit did not return valid JSON")
  }
  const returnValue = {
    "intent_description": intentJson,
    "current_step": "intent_expansion"
  }
  logAgentParsed(intentResult.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, auditFeedback: string | undefined, intentAuditPass: boolean | undefined, pageDescription: string | undefined, patterns?: any[]){
  let humanMessage: string;
  if(auditFeedback && !intentAuditPass){
    humanMessage = `你上一次生成的蓝图未通过审核校验，请务必参考以下反馈进行迭代修复：
    [用户的原始需求:] ==================================
    ${userInput}

    [待修正界面蓝图:] ==================================
    ${pageDescription}

    [蓝图审核结果:] ==================================
    ${auditFeedback}
    
    请根据评审意见结论修正界面蓝图。`;
  }else{
    let patternSection = "";
    if (patterns && patterns.length > 0) {
      const patternsForPrompt = patterns.map(p => ({
        name: p.name,
        category: p.category,
        description: p.description,
        structure: p.structure,
        patternId: p.patternId,
        rootContainer: p.rootContainer,
      }))
      patternSection = `

    [已有的模块模板:] ==================================
    ${JSON.stringify(patternsForPrompt, null, 2)}`;
    }
    humanMessage = `[用户的需求:] ==================================
    ${userInput}${patternSection}

    请开始意图扩展。`;
  }
  return humanMessage;
}