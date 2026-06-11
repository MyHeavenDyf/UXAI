import type { Message, Session } from '@opencode-ai/sdk/v2/client';
import { extractJson, getResultFromMessages } from '../../utils/json_parser';
import intentAuditSchema from './schema';

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
}

export default async function proto_intent_audit(input: ProtoIntentAuditInput) {
  const { sdk, sync, modelKey, rootSession, userInput, intentDescription } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, intentDescription)
  // 执行 Agent
  const auditResult = await runAgent(sdk, sync, modelKey, rootSession, humanMessage)
  debugger
  // 转换成 audit json
  const intentJson = extractJson(auditResult)
  if (!intentJson) throw new Error("----- Intent Audit did not return valid JSON -----")
  return {
    "intent_audit_pass": intentJson.is_pass,
    "intent_audit_feedback": intentJson.feedback,
    "current_step": "intent_audit"
  };
}

// run OpenCode SDK
async function runAgent(sdk: any, sync: any, modelKey: string, rootSession: string, humanMessage: string): Promise<string> {
  // create new session
  const newSession = await sdk.client.session.create({
    directory: sdk.directory,
    parentID: rootSession,
    agent: AGENT_NAME,
  })
  const sessionData = newSession.data as Session | undefined
  if (!sessionData) throw new Error("----- Failed to create new session -----")
  const startTime = Date.now()
  console.log("[Pattern ] intent_audit_agent运行中")
  // run session 
  await sdk.client.session.promptAsync({
    sessionID: sessionData.id,
    agent: AGENT_NAME,
    model: modelKey,
    parts: [{ type: "text", text: humanMessage }]
  })

  // get result
  let result = await getResultFromMessages(sdk, sessionData.id, false);
  console.log("[Pattern ] intent_audit_agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's')
  if (!result) throw new Error("----- Intent Audit agent returned NULL -----")
  return result;
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