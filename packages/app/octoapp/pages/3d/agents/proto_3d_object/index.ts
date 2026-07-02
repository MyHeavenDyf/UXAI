import { extractJson } from '../../utils/json_parser'
import { buildObjectPrompt } from '../../utils/scene-protocol'
import { runChildSession } from '../run_child_session'

const AGENT_NAME = "proto_3d_object"

type Proto3DObjectInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  // slot 信息
  idPrefix: string
  sectionId: string
  parentId: string
  // 本区域对应的 sectionDetail(放什么、怎么排布)
  sectionDetail: any
  // 整体意图蓝图
  intentDescription: any
  // 相机信息(用于判断"左/右/上/下"方向)
  camera?: any
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 物体生成 Agent:为单个 slot 生成 objects[]。
 * 本 agent 最需要完整协议,前端用 buildObjectPrompt 把
 * 协议/目录/设计规范/示例拼进 humanMessage(后端 system prompt 只含铁律)。
 */
export default async function proto_3d_object(input: Proto3DObjectInput) {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    idPrefix,
    sectionId,
    parentId,
    sectionDetail,
    intentDescription,
    camera,
    onSessionCreated,
  } = input
  const humanMessage = buildHumanMessage(intentDescription, sectionDetail, parentId, idPrefix, camera)
  console.log(`----- [3D] 物体生成Agent开始执行 (section=${sectionId}) -----`)
  const startTime = Date.now()

  const objectResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  console.log(`----- [3D] 物体生成Agent结束 (section=${sectionId}),耗时:`, (Date.now() - startTime) / 1000, "s -----")

  const parsed = extractJson(objectResult)
  const objects = (parsed as any)?.objects
  if (!parsed || !Array.isArray(objects)) {
    throw new Error(`----- [3D] Object agent did not return a valid { objects: [] } (section=${sectionId}) -----`)
  }
  return {
    objects,
    section_id: sectionId,
    parent_id: parentId,
    id_prefix: idPrefix,
  }
}

function buildHumanMessage(intentDescription: any, sectionDetail: any, parentId: string, idPrefix: string, camera?: any): string {
  // buildObjectPrompt 携带完整协议 + 目录 + 设计规范 + 示例 + 输出规则
  const base = buildObjectPrompt({
    intentJson: intentDescription,
    slotElementId: parentId,
    idPrefix,
  })
  const bounds = sectionDetail?.bounds
  const boundsLine = bounds
    ? `- bounds(本区域物体局部坐标边界,严禁超出): xMin=${bounds.xMin}, xMax=${bounds.xMax}, zMin=${bounds.zMin}, zMax=${bounds.zMax}`
    : ""
  const camPos = camera?.position ?? [0, 0, 0]
  const camLine = camera
    ? `- 相机位置: ${JSON.stringify(camPos)}。方向约定(从相机视角): 左=-X方向, 右=+X方向, 远/上(背景)=-Z方向(离相机更远的Z), 近/下(前景)=+Z方向, 高=+Y方向。用户说"左上角"= 小X + 小Z(远); "右下角"= 大X + 大Z(近)。`
    : ""
  return `${base}

# 本 slot 的具体任务
- parent_id(本区域所有物体的 parentId): ${parentId}
- id_prefix(本区域物体 id 前缀): ${idPrefix}
${boundsLine}
${camLine}
- 本区域蓝图(sectionDetail):
${JSON.stringify(sectionDetail, null, 2)}

请生成本区域的 objects JSON。所有物体的 parentId 必须为 "${parentId}"。
${bounds ? `所有物体的 position 的 X/Z 必须严格在 bounds 范围内(xMin≤x≤xMax, zMin≤z≤zMax)。` : ""}
只输出 { "objects": [...] }。`
}
