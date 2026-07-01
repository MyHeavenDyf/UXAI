import { extractJson } from '../../utils/json-parser';
import { runChildSession } from '../run-child-session';
import { logAgentParsed } from "../../utils/debug-log"

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
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_planner_create(input: ProtoPlannerCreateInput) {
  const { 
    sdk, 
    sync, 
    modelKey, 
    userInput, 
    rootSession, 
    intentDescription, 
    onSessionCreated 
  } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(intentDescription)
  console.log("----- 布局规划Agent开始执行 ----- ");
  const startTime = Date.now()
  // 执行 Agent
  const plannerResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  console.log("----- 布局规划Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 planner json
  const plannerJson = extractJson(plannerResult.text)
  if (!plannerJson) throw new Error("----- Planner Create did not return valid JSON -----")
  const returnValue = {
    "layout_planner": plannerJson,
    "current_step": "planner_create"
  }
  logAgentParsed(plannerResult.childSessionId, returnValue)
  return returnValue
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

