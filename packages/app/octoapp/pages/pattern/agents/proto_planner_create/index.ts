import { extractJson } from '../../utils/json_parser';
import { runChildSession } from '../run-child-session';

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
  const { sdk, sync, modelKey, rootSession, userInput, intentDescription, onSessionCreated } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(intentDescription)
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
  debugger
  // 转换成 planner json
  const plannerJson = extractJson(plannerResult)
  if (!plannerJson) throw new Error("----- Planner Create did not return valid JSON -----")
  return {
    "layout_planner": plannerJson,
    "current_step": "planner_create"
  }
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

