import { extractJson } from '../../utils/json-parser';
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"

const AGENT_NAME = "proto_module_modify";

export interface ModuleModifyInput {
  layoutPlanner: Record<string, unknown>
  idPrefix: string
  sectionId: string
  originModules: Record<string, unknown>
  modifications: Record<string, unknown>
  intentDescription?: Record<string, unknown>
}

export interface ModuleModifyResult {
  ui_json: Record<string, unknown>
  sectionId: string
  elementId: string
  idPrefix: string
}

type ModuleModifyContext = {
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
  // 透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 修改输入
  input: ModuleModifyInput
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_module_modify(ctx: ModuleModifyContext): Promise<ModuleModifyResult> {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput,
    onSessionCreated 
  } = ctx
  // 组装输入提示词
  const humanMessage = buildHumanMessage(ctx.input)
  console.log("----- 模块修改Agent开始执行 ----- ");
  const startTime = Date.now();
  const modifyRes = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    extra: ctx.extra,
  })
  console.log("----- 模块修改Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 json 数据
  const modifyJson = extractJson(modifyRes.text)
  if (!modifyJson) throw new Error("module_modify did not return valid JSON")

  const rootElementId = ctx.input.originModules.rootId as string
  if (modifyJson.rootId !== rootElementId) {
    const target = (modifyJson.elements as Array<{ id: string }>)?.find((e) => e.id === modifyJson.rootId)
    if (target) {
      target.id = rootElementId
      modifyJson.rootId = rootElementId
    }
  }

  const returnValue = {
    ui_json: modifyJson,
    sectionId: ctx.input.sectionId,
    elementId: rootElementId,
    idPrefix: ctx.input.idPrefix,
  }
  logAgentParsed(modifyRes.childSessionId, returnValue)
  return returnValue
}


function buildHumanMessage(input: ModuleModifyInput): string {
  const lines = [
    `[顶层布局和Slots]: ===============`,
    JSON.stringify(input.layoutPlanner),
    ``,
    `[模块内部元素id前缀]: ===============`,
    input.idPrefix,
    ``,
    `[当前正在修改模块section_id]: ===============`,
    input.sectionId,
    ``,
    `[UI JSON数据] ===============`,
    JSON.stringify(input.originModules),
    ``,
    `[修改意见] ===============`,
    JSON.stringify(input.modifications),
  ]
  if (input.intentDescription) {
    lines.push(
      ``,
      `[更新后的页面意图] ===============`,
      JSON.stringify(input.intentDescription),
    )
  }
  return lines.join("\n")
}