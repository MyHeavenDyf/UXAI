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
import { withModuleRetry } from "../utils/module-retry"

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
  onFinished: (finalJson: { sceneIntent: any; layoutPlanner: ScenePlanner; modulesJson: SceneModuleResult[]; sceneConfig: SceneConfig; skipped?: string[] }) => Promise<void>,
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

  // ── element_id 重映射（核心健壮性修复）──────────────────────────────────
  // planner_modify 的 LLM 即便被要求"未改动分区保持 element_id 不变"，仍可能为分区
  // 重新生成 element_id（LLM 行为不可控，已多次踩坑）。一旦漂移，旧物体的 parentId 还指向
  // 旧 element_id，mergeSceneObjects 的归属判断（沿 parentId 链查 slot.element_id）会一路
  // 走到旧分区根 group（parentId:null）返回 undefined → 旧物体被整体丢弃；即便保留也因
  // parentId 指向已不存在的旧 id 被孤儿校验丢弃。这就是"加物体后原有物体消失"的根因。
  //
  // 修复：section_id 是稳定主键（语义级，triage/planner_modify/module_* 全流程按 section_id
  // 编排），用它把"旧 element_id → 新 element_id"对齐，再把旧物体的 parentId 从旧 id 改写
  // 到新 id。element_id 稳定时 eidRemap 为空，纯 no-op，零副作用。
  const oldSlots = ((lastPlanner.slots ?? []) as Array<{ section_id: string; element_id: string }>) ?? []
  const oldElementBySection = new Map(oldSlots.map((s) => [s.section_id, s.element_id]))
  const newElementBySection = new Map(
    (newPlanner.slots ?? []).map((s) => [s.section_id, s.element_id]),
  )
  const eidRemap = new Map<string, string>()
  for (const [sectionId, oldEid] of oldElementBySection) {
    const newEid = newElementBySection.get(sectionId)
    if (newEid && newEid !== oldEid) eidRemap.set(oldEid, newEid)
  }
  if (eidRemap.size > 0) {
    console.warn(
      "[3d-modify] 检测到 element_id 漂移，重映射旧物体 parentId：",
      [...eidRemap.entries()],
    )
  }
  // 只改写"指向旧分区 element_id"的 parentId；中间 group 的 id（如 tblzTable）不变，链路自然对齐。
  const remappedOldObjects: SceneConfigObject3D[] = lastSceneObjects.map((o) => {
    if (o.parentId && eidRemap.has(o.parentId)) {
      return { ...o, parentId: eidRemap.get(o.parentId)! }
    }
    return o
  })

  // 找某分区旧的物体数组（【整棵子树】= 直接子 + 所有后代），基于重映射后的集合查。
  // 必须给全子树：module_modify 按契约要"原样保留全部未改动物体"（含嵌套后代），且 merge 对 modify
  // 分区是整体替换 —— 若只给直接子，后代既不会被 module 保留、又会被 merge 丢弃，整代丢失。
  const findPrevModuleObjects = (slot: SceneSlot): SceneConfigObject3D[] | null => {
    const eid = slot.element_id || oldElementBySection.get(slot.section_id)
    if (!eid) return null
    const byParent = new Map<string, SceneConfigObject3D[]>()
    for (const o of remappedOldObjects) {
      if (!o.parentId) continue
      const arr = byParent.get(o.parentId)
      if (arr) arr.push(o)
      else byParent.set(o.parentId, [o])
    }
    const out: SceneConfigObject3D[] = []
    const stack = byParent.get(eid) ? [...(byParent.get(eid) as SceneConfigObject3D[])] : []
    while (stack.length) {
      const o = stack.pop() as SceneConfigObject3D
      out.push(o)
      const kids = byParent.get(o.id)
      if (kids) stack.push(...kids)
    }
    return out.length ? out : null
  }

  const modulePromises: Promise<SceneModuleResult | null>[] = newPlanner.slots.map(async (slot) => {
    // 保留未改动分区：返回 null（merge 时按 operation:none 保留旧物体）
    if (slot.operation === "none") {
      return null
    }
    // 新增分区（失败则跳过 → 该分区空 group，UI 提示后可再 modify 补齐）
    if (slot.operation === "create") {
      return withModuleRetry(`新增分区 ${slot.section_id}`, () =>
        scene_3d_module_create({
          ...inputCtx,
          idPrefix: slot.id_prefix,
          sectionId: slot.section_id,
          elementId: slot.element_id,
          layoutPlanner: newPlanner,
          intentDescription: updatedIntent as any,
        }),
      )
    }
    // 修改分区
    if (slot.operation === "modify") {
      const originObjects = findPrevModuleObjects(slot) ?? []
      const modAction = triage.modify.find((m) => m.section_id === slot.section_id)
      if (!modAction || originObjects.length === 0) return null
      const result = await withModuleRetry(`修改分区 ${slot.section_id}`, () =>
        scene_3d_module_modify({
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
        }),
      )
      if (!result) {
        // 修改失败回落：用旧物体填充该分区。merge 对 modify 分区是 REPLACE，若不兜底会整分区丢失。
        console.warn(`[3d-modify] 分区 ${slot.section_id} 修改失败，保留旧物体`)
        return {
          scene_objects: originObjects,
          section_id: slot.section_id,
          element_id: slot.element_id,
          id_prefix: slot.id_prefix,
        }
      }
      return result
    }
    return null
  })

  const moduleResultsRaw = await Promise.all(modulePromises)
  const moduleResults = moduleResultsRaw.filter(Boolean) as SceneModuleResult[]
  // 跳过的分区 = 新增(create)失败（无旧物可回落）；修改(modify)失败已回落保留旧物，不计入。
  const skipped = newPlanner.slots
    .map((slot, i) =>
      moduleResultsRaw[i] === null && slot.operation === "create" ? slot.section_id : null,
    )
    .filter((s): s is string => !!s)

  // 合并：newPlanner + 新/改分区物体 + 保留的旧分区物体（旧物体已按 element_id 重映射对齐新 planner）
  const merged = mergeSceneObjects(newPlanner, moduleResults, remappedOldObjects)
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "modify_modules_merged", {
    modulesJson: moduleResults,
    sceneConfig: merged,
    extra: {
      eidRemap: [...eidRemap.entries()],
      oldObjectsCount: remappedOldObjects.length,
      slots: (newPlanner.slots ?? []).map((s) => ({
        section_id: s.section_id,
        element_id: s.element_id,
        operation: s.operation,
      })),
      skipped: skipped.length ? skipped : undefined,
    },
  })

  await onFinished({
    sceneIntent: updatedIntent,
    layoutPlanner: newPlanner,
    modulesJson: moduleResults,
    sceneConfig: merged,
    skipped: skipped.length ? skipped : undefined,
  })
}
