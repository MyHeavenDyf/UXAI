/**
 * 3D 场景 AI 修改工作流（类比 pattern/workflow/modify-json-ai.ts）
 *
 * 比 pattern 简化：3D 用 parentId 平铺数组，无 children 引用树，
 * 不需要 pattern 的 element_id 修正逻辑（pattern LLM 可能错改 shell element_id）。
 * merge 用 mergeSceneObjects（按 slot.operation 替换/保留物体）。
 */
import scene_3d_triage from "../agents/scene-triage"
import scene_3d_planner_modify from "../agents/scene-planner-modify"
import scene_3d_module_create from "../agents/scene-module-create"
import scene_3d_module_modify from "../agents/scene-module-modify"
import { mergeSceneObjects, type SceneModuleResult, type ScenePlanner, type SceneSlot } from "../agents/merge"
import type { SceneConfig, SceneConfigObject3D } from "../utils/scene-config"
import { saveDebugSnapshot } from "../utils/debug-log"

type SceneModifyInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  extra?: Record<string, unknown>
  onSessionCreated?: (childSessionID: string) => void
  refreshPreview?: () => void
}

type LastData = {
  lastIntent: any
  lastPlanner: any
  lastSceneObjects: any[]
}

const historyDir = (sdk: any) => `${sdk.directory}/.octo/design-3d/history`

export default async function modify_scene_ai(
  inputCtx: SceneModifyInput,
  lastData: LastData,
  onFinished: (finalJson: { sceneIntent: any; layoutPlanner: ScenePlanner; modulesJson: SceneModuleResult[]; sceneConfig: SceneConfig }) => Promise<void>,
) {
  const lastPlanner: ScenePlanner = lastData.lastPlanner
  // lastData.lastSceneObjects 实际是 SceneModuleResult[]（每分区 {scene_objects, section_id, ...}），
  // mergeSceneObjects 需要扁平的 SceneConfigObject3D[]，这里拍平。
  const lastSceneObjects: SceneConfigObject3D[] = (() => {
    const raw = lastData.lastSceneObjects ?? []
    const flat: SceneConfigObject3D[] = []
    for (const item of raw) {
      if (Array.isArray(item)) {
        flat.push(...(item as SceneConfigObject3D[]))
      } else if (item && Array.isArray((item as any).scene_objects)) {
        flat.push(...((item as any).scene_objects as SceneConfigObject3D[]))
      } else if (item && (item as any).id) {
        flat.push(item as SceneConfigObject3D)
      }
    }
    return flat
  })()
  const historyD = historyDir(inputCtx.sdk)

  // 分诊，判断是修改、还是重新生成、还是简单回答
  const triage = await scene_3d_triage({
    ...inputCtx,
    lastIntent: lastData.lastIntent,
    lastPlanner,
    lastSceneObjects,
  })
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "modify_triage")

  // 暂时屏蔽非修改场景
  if (triage.routing !== "modify") {
    return {}
  }

  // 重新布局规划
  const modifyResult = await scene_3d_planner_modify({
    ...inputCtx,
    input: {
      intentReason: triage.reason,
      intentDelete: triage.delete,
      intentAdd: triage.add,
      intentModify: triage.modify,
      intentPage: triage.updated_intent,
      layoutPlanner: lastPlanner as unknown as Record<string, unknown>,
    },
  })
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "modify_planner", {
    lastIntent: triage.updated_intent,
    lastPlanner: modifyResult.output as unknown as Record<string, unknown>,
  })

  const updatedIntent = { ...triage.updated_intent }
  const newPlanner = modifyResult.output

  // 旧分区 element_id 映射（section_id → element_id），用于找旧分区物体
  const oldSlots = ((lastPlanner.slots ?? []) as Array<{ section_id: string; element_id: string }>) ?? []
  const oldElementBySection = new Map(oldSlots.map((s) => [s.section_id, s.element_id]))

  // 找某分区旧的物体数组（parentId 指向该 element_id 的物体）
  const findPrevModuleObjects = (slot: SceneSlot): SceneConfigObject3D[] | null => {
    const eid = slot.element_id || oldElementBySection.get(slot.section_id)
    if (!eid) return null
    const objs = lastSceneObjects.filter((o) => o.parentId === eid)
    return objs.length ? objs : null
  }

  const modulePromises: Promise<SceneModuleResult | null>[] = newPlanner.slots.map((slot) => {
    // 保留未改动分区：返回 null（merge 时按 operation:none 保留旧物体）
    if (slot.operation === "none") {
      return Promise.resolve(null)
    }
    // 新增分区
    if (slot.operation === "create") {
      return scene_3d_module_create({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        elementId: slot.element_id,
        layoutPlanner: newPlanner,
        intentDescription: updatedIntent as any,
      })
    }
    // 修改分区
    if (slot.operation === "modify") {
      const originObjects = findPrevModuleObjects(slot)
      const modAction = triage.modify.find((m) => m.section_id === slot.section_id)
      if (!originObjects || !modAction) return Promise.resolve(null)
      return scene_3d_module_modify({
        ...inputCtx,
        input: {
          layoutPlanner: newPlanner as unknown as Record<string, unknown>,
          idPrefix: slot.id_prefix,
          sectionId: slot.section_id,
          elementId: slot.element_id,
          originObjects,
          modifications: modAction as unknown as Record<string, unknown>,
          intentDescription: updatedIntent as any,
        },
      })
    }
    return Promise.resolve(null)
  })

  const moduleResultsRaw = await Promise.all(modulePromises)
  const moduleResults = moduleResultsRaw.filter(Boolean) as SceneModuleResult[]

  // 合并：newPlanner + 新/改分区物体 + 保留的旧分区物体
  const merged = mergeSceneObjects(newPlanner, moduleResults, lastSceneObjects)
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "modify_modules_merged", {
    modulesJson: moduleResults,
    sceneConfig: merged,
  })

  await onFinished({
    sceneIntent: updatedIntent,
    layoutPlanner: newPlanner,
    modulesJson: moduleResults,
    sceneConfig: merged,
  })
}
