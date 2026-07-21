import { extractJson } from '../../utils/json-parser';
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import { mergeJson, type PatchOp, type PatchSource } from "../../utils/patch-json"
import { MODIFY_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "proto_modify";

export interface TriageOpItem {
  element_id: string
  action: string
}

export interface ModuleModifyInput {
  ui_json_str: Record<string, unknown>
  audit_feedback: string
  triage_ops: TriageOpItem[]
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

export default async function proto_modify(ctx: ModuleModifyContext): Promise<ModuleModifyResult> {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput,
    onSessionCreated,
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
    schema: MODIFY_FORMAT.schema,
  })
  console.log("----- 模块修改Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 json 数据
  const modifyJson = extractJson(modifyRes.text)
  if (!modifyJson) {
    logAgentParsed(modifyRes.childSessionId, { error: "Failed to parse JSON", raw: modifyRes.text })
    agentThrow(AGENT_NAME, modifyRes.childSessionId, "modify did not return valid JSON")
  }
  const raw = modifyJson as unknown
  const patchOps = (Array.isArray(raw) ? raw : [raw]) as PatchOp[]
  const patched = mergeJson(ctx.input.ui_json_str as unknown as PatchSource, patchOps)

  const returnValue = {
    ui_json: patched as unknown as Record<string, unknown>,
    sectionId: ctx.input.sectionId,
    elementId: ctx.input.originModules.rootId as string,
    idPrefix: ctx.input.idPrefix,
  }
  logAgentParsed(modifyRes.childSessionId, returnValue)
  return returnValue
}


function buildHumanMessage(input: ModuleModifyInput): string {
  const triageLines = input.triage_ops.length > 0
    ? [
        ``,
        `[分诊操作列表]: ===============`,
        JSON.stringify(input.triage_ops),
      ]
    : []

  const lines = [
    `[用户的修改请求]: ===============`,
    input.audit_feedback,
    ``,
    `[JSON数据为:] ===============`,
    JSON.stringify(input.ui_json_str),
    ...triageLines,
  ]

  return lines.join("\n")
}