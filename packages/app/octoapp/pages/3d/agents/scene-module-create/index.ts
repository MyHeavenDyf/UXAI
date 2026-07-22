import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { SceneModuleResult } from "../merge"
import { SCENE_MODULE_CREATE_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"

const AGENT_NAME = "scene_3d_module_create"

type SceneModuleCreateInput = {
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
  // 用户输入
  idPrefix: string
  // 本分区对应意图模块
  sectionId: string
  // 本分区对应父容器 group
  elementId: string
  // 完整布局规划
  layoutPlanner: any
  // 意图扩展结论
  intentDescription: any
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function scene_3d_module_create(input: SceneModuleCreateInput): Promise<SceneModuleResult> {
  const { sdk, sync, modelKey, rootSession, idPrefix, sectionId, elementId, layoutPlanner, intentDescription, onSessionCreated } = input
  const humanMessage = buildHumanMessage(idPrefix, sectionId, elementId, layoutPlanner, intentDescription)
  console.log(`----- 3D 分区物体生成Agent开始执行 [${sectionId}] ----- `)
  const startTime = Date.now()
  const moduleResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
    extra: input.extra,
    schema: SCENE_MODULE_CREATE_FORMAT.schema,
  })
  console.log(`----- 3D 分区物体生成Agent运行结束 [${sectionId}]，耗时：`, (Date.now() - startTime) / 1000, "s -----")
  const moduleJson = extractJson(moduleResult.text)
  if (!moduleJson) {
    logAgentParsed(moduleResult.childSessionId, { error: "Failed to parse JSON", raw: moduleResult.text })
    agentThrow(AGENT_NAME, moduleResult.childSessionId, "Scene Module Create did not return valid JSON")
  }
  const returnValue: SceneModuleResult = {
    scene_objects: (moduleJson.scene_objects ?? []) as SceneModuleResult["scene_objects"],
    section_id: sectionId,
    element_id: elementId,
    id_prefix: idPrefix,
  }
  logAgentParsed(moduleResult.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(idPrefix: string, sectionId: string, elementId: string, layoutPlanner: any, intentDescription: any): string {
  // 拓展意图
  const userInput = intentDescription?.userInput ?? ""
  const sceneAnalysis = intentDescription?.sceneAnalysis ?? ""
  const layoutDesc = intentDescription?.layoutDescription ?? ""
  const sections = intentDescription?.sections ?? []
  const sectionsStr = JSON.stringify(sections, null, 2)

  // 布局规划
  const elements = layoutPlanner?.elements ?? []
  const slotElement = elements.find((e: any) => e?.id === elementId) ?? {}
  const slotElemnetStr = JSON.stringify(slotElement, null, 2)
  const slots = layoutPlanner?.slots ?? []
  const slot = slots.find((s: any) => s?.section_id === sectionId) ?? {}
  const slotStr = JSON.stringify(slot, null, 2)

  // 该分区详细意图
  const sectionDetailList = intentDescription?.sectionDetailList ?? []
  const sectionDetail = sectionDetailList.find((item: any) => item?.id === sectionId) ?? {}
  const sectionDetailStr = JSON.stringify(sectionDetail, null, 2)

  return `请为以下 3D 场景分区生成物体（mesh/group + 几何体）：

  [完整场景蓝图:] ==================================
  - 用户输入: ${userInput}
  - 场景意图分析: ${sceneAnalysis}
  - 布局描述: ${layoutDesc}
  - 场景结构: ${sectionsStr}

  [分区顶层容器:] ==================================
  - Zone Group ID: ${elementId}
  - Zone Group:
    ${slotElemnetStr}
  - Zone Slot:
    ${slotStr}

  [需要被生成的分区详细蓝图:] ==================================
  ${sectionDetailStr}

  [需要被生成分区的根节点 group id:] ${elementId}
  [分区内部物体 id 前缀:] ${idPrefix} (注：该分区内所有 object id 必须以此开头)

  请根据蓝图，生成分区内所有物体的 objects 数组（平铺 + parentId 指向 ${elementId}）。`
}
