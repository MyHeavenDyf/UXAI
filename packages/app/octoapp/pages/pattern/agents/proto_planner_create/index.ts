import type { Message, Session } from '@opencode-ai/sdk/v2/client';
import { extractJson, getResultFromMessages } from '../../utils/json_parser';

const AGENT_NAME = "proto_planner_create"

type ProtoPlannerCreateInput = {
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
  intentDescription: string
}

export default async function proto_planner_create(input: ProtoPlannerCreateInput) {
  const { sdk, sync, modelKey, rootSession, userInput, intentDescription } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(intentDescription)
  // 执行 Agent
  const plannerResult = await runAgent(sdk, sync, modelKey, rootSession, humanMessage)
  debugger
  // 转换成 planner json
  const plannerJson = extractJson(plannerResult)
  if (!plannerJson) throw new Error("----- Planner Create did not return valid JSON -----")
  return {
    "layout_planner": plannerJson,
    "current_step": "planner_create"
  }
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
  console.log("[Pattern ] planner_create_agent运行中")
  // run session 
  await sdk.client.session.promptAsync({
    sessionID: sessionData.id,
    agent: AGENT_NAME,
    model: modelKey,
    parts: [{ type: "text", text: humanMessage }]
  })

  // get result
  let result = await getResultFromMessages(sdk, sessionData.id, false);
  console.log("[Pattern ] planner_create_agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's')
  if (!result) throw new Error("----- Intent Audit agent returned NULL -----")
  return result;
}

// 组装布局规划的输入文本
function buildHumanMessage(intentDescription: string){
  let humanMessage: string;
  humanMessage = `请根据以下页面蓝图，设计外壳布局并指定下一步细化模块：
  [Page Blue_print:] ==================================

  ${intentDescription}
  `;
  return humanMessage;
}

