import { extractJson } from '../../utils/json_parser';
import { runChildSession } from "../run_child_session"

const AGENT_NAME = "proto_planner_modify"

export interface PlannerModifySlot {
  section_id: string
  element_id: string
  id_prefix: string
  operation: "create" | "modify" | "none"
}

export interface PlannerModifyElement {
  id: string
  component: string
  props: Record<string, unknown>
  children: string[]
}

export interface PlannerModifyOutput {
  rootId: string
  elements: PlannerModifyElement[]
  slots: PlannerModifySlot[]
}

export type PlannerModifyInput = {
  intentReason: string
  intentDelete: string[]
  intentAdd: string[]
  intentModify: Array<{ section_id: string; element_id: string; action: string }>
  intentPage: Record<string, unknown>
  layoutPlanner: Record<string, unknown>
}

export type PlannerModifyContext = {
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
  // 分诊诊断结果
  input: PlannerModifyInput
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_planner_modify(ctx: PlannerModifyContext): Promise<{
  output: PlannerModifyOutput
  removedSectionIds: string[]
}> {
  const { 
    sdk, 
    sync, 
    modelKey, 
    rootSession, 
    userInput, 
    onSessionCreated } = ctx
  // 组装输入提示词
  const humanMessage = buildHumanMessage(ctx.input)
  console.log("----- 布局修改Agent开始执行 ----- ");
  const startTime = Date.now();
  const modifyRes = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession
  })
  console.log("----- 布局修改Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 modify json
  const modifyJson = extractJson(modifyRes)
  if (!modifyJson) throw new Error("----- Planner Modify JSON did not return valid JSON -----")
  const output: PlannerModifyOutput = {
    rootId: (modifyJson.rootId as string) ?? "",
    elements: (modifyJson.elements as PlannerModifyElement[]) ?? [],
    slots: ((modifyJson.slots as PlannerModifySlot[]) ?? []).map((s) => ({
      section_id: s.section_id ?? "",
      element_id: s.element_id ?? "",
      id_prefix: s.id_prefix ?? "",
      operation: (s.operation as "create" | "modify" | "none") ?? "none",
    })),
  }

  const newSectionIds = new Set(output.slots.map((s) => s.section_id))
  const oldSlots = (ctx.input.layoutPlanner.slots as Array<Record<string, unknown>>) ?? []
  const removedSectionIds = oldSlots.map((s) => s.section_id as string).filter((id) => !newSectionIds.has(id))
  return { output, removedSectionIds }
}

function cleanSlots(layoutPlanner: Record<string, unknown>): Record<string, unknown> {
  const slots = (layoutPlanner.slots as Array<Record<string, unknown>>) ?? []
  return {
    ...layoutPlanner,
    slots: slots.map((s) => ({ ...s, operation: "none" })),
  }
}

function buildHumanMessage(input: PlannerModifyInput): string {
  const cleanLayout = cleanSlots(input.layoutPlanner)
  return [
    `请根据以下内容，修改外壳布局并指定下一步细化模块：`,
    ``,
    `【Explicit Modification Directives】: ========================`,
    `- 总体需求: ${input.intentReason}`,
    `- 需要删除的模块: ${JSON.stringify(input.intentDelete)}`,
    `- 需要新增的模块: ${JSON.stringify(input.intentAdd)}`,
    `- 需要修改的模块: ${JSON.stringify(input.intentModify)}`,
    ``,
    `【Page Blueprint】: ========================`,
    JSON.stringify(input.intentPage),
    ``,
    `【Original Macro-Layout JSON & Intent-to-Container Mappings】: ========================`,
    JSON.stringify(cleanLayout),
    ``,
  ].join("\n")
}