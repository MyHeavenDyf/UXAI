import proto_3d_triage from "../agents/proto_3d_triage"
import proto_3d_object from "../agents/proto_3d_object"
import { topoSortByParent } from "../agents/merge_scene"
import create_scene from "./create_scene"

type ModifySceneCtx = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

type LastData = {
  // 完整意图蓝图(intent_description)
  lastIntent: any
  // 舞台规划(scene_planner)
  lastPlanner: any
  // 当前完整 SceneDocument
  sceneJson: any
}

/**
 * 修改流水线(简化版,对等 pattern/workflow/modify_json_ai 但更轻量):
 *   ① 分诊(triage)判断 regenerate vs modify
 *   ② regenerate → 走完整 create_scene
 *   ③ modify → delete + add,其中 modify 统一转成「删原物体 + object agent 重生成」
 *
 * 与 pattern 的差异:不依赖 planner_modify / module_modify 两个额外 agent,
 * 只复用 proto_3d_triage + proto_3d_object,降低 v1 复杂度。
 */
export default async function modify_scene_ai(inputCtx: ModifySceneCtx, lastData: LastData, onFinished: (result: any) => Promise<void>) {
  // ① 分诊
  const triage = await proto_3d_triage({
    ...inputCtx,
    lastPlanner: lastData.lastPlanner,
    lastObjects: lastData.sceneJson?.objects ?? [],
  })

  // ② 整体重生成
  if (triage.routing === "regenerate") {
    const query = `${inputCtx.userInput}（按反馈整体重构:${triage.reason}）`
    return create_scene({ ...inputCtx, userInput: query }, onFinished)
  }

  // ③ 局部 modify —— 统一转成 delete + add
  const delSet = new Set<string>(triage.delete)
  const addItems = [...triage.add]
  const origObjects: any[] = lastData.sceneJson?.objects ?? []

  for (const m of triage.modify) {
    const orig = origObjects.find((o) => o?.id === m.object_id)
    if (!orig) continue
    // 删原物体,用 object agent 按修改要求重生成一个新版本
    delSet.add(m.object_id)
    addItems.push({
      section_id: `${m.object_id}Zone`,
      parent_id: orig.parentId,
      id_prefix: String(orig.id ?? "obj").replace(/[0-9]+$/, ""),
      detail: `替换原物体 ${m.object_id},修改要求:${m.action}`,
    })
  }

  // 执行 delete
  const remaining = origObjects.filter((o) => !delSet.has(o.id))

  // 执行 add:并行调用 object agent 生成新物体
  const intentDescription = lastData.lastIntent ?? {}
  const newSlotResults = await Promise.all(
    addItems.map((a) =>
      proto_3d_object({
        ...inputCtx,
        idPrefix: a.id_prefix,
        sectionId: a.section_id,
        parentId: a.parent_id,
        sectionDetail: {
          id: a.section_id,
          name: a.section_id,
          intent: a.detail,
          function: a.detail,
          elements: a.detail,
          layout: a.detail,
        },
        intentDescription,
      }),
    ),
  )

  // 合并 + parent-first 重排
  const mergedObjects = topoSortByParent([...remaining, ...newSlotResults.flatMap((r) => r.objects)])
  const sceneJson = { ...(lastData.sceneJson ?? {}), version: "1", objects: mergedObjects }

  await onFinished({
    sceneIntent: lastData.lastIntent,
    scenePlanner: lastData.lastPlanner,
    slotResults: newSlotResults,
    sceneJson,
  })
}
