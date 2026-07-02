import { extractJson } from '../../utils/json-parser';
import { runChildSession } from '../run-child-session';
import { logAgentParsed } from "../../utils/debug-log"

const AGENT_NAME = "proto_intent_audit"

type ProtoIntentAuditInput = {
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
  // 待评审意图
  intentDescription: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_intent_audit(input: ProtoIntentAuditInput) {
  const { sdk, sync, modelKey, rootSession, userInput, intentDescription, onSessionCreated } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, intentDescription)
  console.log("----- 意图诊断Agent开始执行 ----- ");
  const startTime = Date.now()
  // 执行 Agent
  const auditResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  console.log("----- 意图诊断Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 audit json
  const intentJson = extractJson(auditResult.text)
  if (!intentJson) throw new Error("----- Intent Audit did not return valid JSON -----")
  const returnValue = {
    "intent_audit_pass": intentJson.is_pass,
    "intent_audit_feedback": intentJson.feedback,
    "current_step": "intent_audit"
  };
  logAgentParsed(auditResult.childSessionId, returnValue)
  return returnValue
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