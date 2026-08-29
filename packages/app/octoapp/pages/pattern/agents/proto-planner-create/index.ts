import { extractJson } from '../../utils/json-parser';
import { runChildSession } from '../run-child-session';
import { logAgentParsed } from "../../utils/debug-log"
import { PLANNER_CREATE_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

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
  // 额外补充信息
  extra?: Record<string, unknown>
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
  const patterns = input.extra?.patterns as any[] | undefined
  const humanMessage = buildHumanMessage(intentDescription, patterns)
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
    schema: PLANNER_CREATE_FORMAT.schema,
  })
  console.log("----- 布局规划Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 planner json
  const plannerJson = extractJson(plannerResult.text)
  if (!plannerJson) {
    logAgentParsed(plannerResult.childSessionId, { error: "Failed to parse JSON", raw: plannerResult.text })
    agentThrow(AGENT_NAME, plannerResult.childSessionId, "Planner Create did not return valid JSON")
  }
  const returnValue = {
    "layout_planner": plannerJson,
    "current_step": "planner_create"
  }
  logAgentParsed(plannerResult.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(intentDescription: string, patterns?: any[]){
  let patternSection = "";
  if (patterns && patterns.length > 0) {
    const rootContainers = patterns.map(p => ({
      patternId: p.patternId,
      rootContainer: p.rootContainer,
    }))
    patternSection = `

  [模块模板的根容器信息:] ==================================
  对于 blueprint 中带有 patternId 的 section，必须直接使用下面对应的 rootContainer 作为 slot 容器（包括 id、component、className），不要自行生成或修改这些容器的属性。

  ${JSON.stringify(rootContainers, null, 2)}`;
  }
  return `请根据以下页面蓝图，设计外壳布局并指定下一步细化模块：
  [Page Blue_print:] ==================================

  ${intentDescription}${patternSection}
  `;
}

