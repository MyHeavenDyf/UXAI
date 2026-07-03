import proto_3d_intent from "../agents/proto_3d_intent"
import proto_3d_planner from "../agents/proto_3d_planner"
import proto_3d_object from "../agents/proto_3d_object"
import { mergeScene } from "../agents/merge_scene"
import { computeSceneCamera, extractViewpointParams, computeExpectedBounds } from "../utils/compute_camera"

type CreateSceneCtx = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 首次生成流水线:
 *   ① 意图拓展  ② 舞台规划(不含camera)  ③ 并行生成各 slot 物体
 *   ③.5 确定性视角计算(零 token)  ④ 合并成 SceneDocument
 */
export default async function create_scene(inputCtx: CreateSceneCtx, onFinished: (result: any) => Promise<void>) {
  // ① 意图拓展:自然语言 → 3D 场景意图蓝图
  const intent = await proto_3d_intent(inputCtx)

  // ② 舞台规划:意图 → scene/lights + group 骨架 + slot 分配（camera 在步骤③后由确定性计算生成）
  const planner = await proto_3d_planner({ ...inputCtx, intentDescription: intent.intent_description })
  const sp = planner.scene_planner

  // ③ 定位每个 slot 对应的 sectionDetail,并行为每个 slot 生成 objects
  const sectionDetailList = (intent.intent_description as any)?.sectionDetailList ?? []
  const slots = (sp?.slots ?? []) as Array<{ section_id: string; parent_id: string; id_prefix: string }>
  const cameraPlan = (intent.intent_description as any)?.cameraPlan as string | undefined

  // 预提取视角方向，传入 object agent 用于物体朝向判断
  const vpParams = extractViewpointParams(cameraPlan)
  const phi = vpParams.azimuthAngle * (Math.PI / 180)
  const camApprox = {
    position: [Math.sin(phi) * 10, 5, Math.cos(phi) * 10],
  }

  const slotResults = await Promise.all(
    slots.map((slot: any) => {
      const detail =
        sectionDetailList.find((d: any) => d?.id === slot.section_id) ?? {
          id: slot.section_id,
          name: slot.section_id,
          intent: slot.section_id,
          function: "",
          elements: "",
          layout: "",
        }
      // 把 planner 的 bounds 注入 sectionDetail,让 object agent 严格在边界内摆放
      if (slot.bounds) detail.bounds = slot.bounds
      return proto_3d_object({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        parentId: slot.parent_id,
        sectionDetail: detail,
        intentDescription: intent.intent_description,
        camera: camApprox,
      })
    }),
  )

  // ③.5 确定性视角检视: 对比 planner 预期包围盒 vs 实际物体包围盒
  const allObjects = slotResults.flatMap((r) => r.objects ?? [])
  const expectedBounds = computeExpectedBounds(sp?.slots ?? [], sp?.groups ?? [])
  const { camera, validation } = computeSceneCamera({
    cameraPlan,
    objects: allObjects,
    expectedBounds,
  })
  sp.camera = camera

  // 偏差过大时输出警告日志
  if (validation?.needsCorrection) {
    console.warn(
      `[viewpoint] 场景包围盒与规划偏差: ${validation.reason}`,
      `(预期宽 ${validation.sceneWidthExpected}m, 实际宽 ${validation.sceneWidthActual}m)`,
    )
  }

  // ④ 合并成完整 SceneDocument
  const sceneJson = mergeScene(sp, slotResults)

  // ⑤ 回调:把中间产物 + 最终场景交给页面层(用于落盘历史/推送预览)
  await onFinished({
    sceneIntent: intent.intent_page,
    scenePlanner: sp,
    slotResults,
    sceneJson,
  })
}
