import proto_3d_intent from "../agents/proto_3d_intent"
import proto_3d_planner from "../agents/proto_3d_planner"
import proto_3d_object from "../agents/proto_3d_object"
import { mergeScene } from "../agents/merge_scene"

type CreateSceneCtx = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 首次生成流水线 —— 对等 pattern/workflow/create_json.ts:
 *   ① 意图拓展  ② 舞台规划  ③ 并行生成各 slot 物体  ④ 合并成 SceneDocument
 */
export default async function create_scene(inputCtx: CreateSceneCtx, onFinished: (result: any) => Promise<void>) {
  // ① 意图拓展:自然语言 → 3D 场景意图蓝图
  const intent = await proto_3d_intent(inputCtx)

  // ② 舞台规划:意图 → scene/camera/lights + group 骨架 + slot 分配
  const planner = await proto_3d_planner({ ...inputCtx, intentDescription: intent.intent_description })
  const sp = planner.scene_planner

  // ③ 定位每个 slot 对应的 sectionDetail,并行为每个 slot 生成 objects
  const sectionDetailList = (intent.intent_description as any)?.sectionDetailList ?? []
  const slots = (sp?.slots ?? []) as Array<{ section_id: string; parent_id: string; id_prefix: string }>

  const slotResults = await Promise.all(
    slots.map((slot) => {
      const detail =
        sectionDetailList.find((d: any) => d?.id === slot.section_id) ?? {
          id: slot.section_id,
          name: slot.section_id,
          intent: slot.section_id,
          function: "",
          elements: "",
          layout: "",
        }
      return proto_3d_object({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        parentId: slot.parent_id,
        sectionDetail: detail,
        intentDescription: intent.intent_description,
      })
    }),
  )

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
