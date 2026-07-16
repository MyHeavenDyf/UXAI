/**
 * 3D 版场景合并（mergeSceneObjects）
 *
 * 与 pattern 的 mergeModules（A2UI rootId+elements+children 引用树）不同，
 * 3D 的 SceneConfig.objects 是平铺数组 + parentId 指针，合并大幅简化：
 *   shellObjects（planner.elements，分区 group 容器）
 * + moduleObjects（各 slot 生成的分区内物体，parentId 指向 slot.element_id）
 * = 完整 SceneConfig.objects
 *
 * planner 额外生成 camera/lights/scene（宏观），merge 时直接取 planner 的。
 *
 * modify 场景：按 slot.operation 区分 create/modify/none，
 *   modify 的 slot 旧物体被新物体替换（按 parentId==slot.element_id 过滤旧物体）。
 */
import type { SceneConfig, SceneConfigObject3D } from "../utils/scene-config"

/** planner 输出的 slot 结构 */
export interface SceneSlot {
  section_id: string
  element_id: string
  id_prefix: string
  zone_description?: string
  object_count_hint?: number
  operation?: "create" | "modify" | "none"
}

/** planner 输出的 layout_planner 结构 */
export interface ScenePlanner {
  rootId: string
  elements: SceneConfigObject3D[]
  slots: SceneSlot[]
  camera?: SceneConfig["camera"]
  lights?: SceneConfig["lights"]
  scene?: SceneConfig["scene"]
}

/** 单个 module_create/modify 的返回 */
export interface SceneModuleResult {
  scene_objects: SceneConfigObject3D[]
  section_id: string
  element_id: string
  id_prefix: string
}

/**
 * 合并 planner 外壳 + 各分区物体 → 完整 SceneConfig
 *
 * @param planner 场景规划（含 rootId/elements/slots/camera/lights/scene）
 * @param moduleResults 各分区物体生成结果数组
 * @param oldSceneObjects modify 场景下的旧完整 objects（用于按 operation 替换/保留）
 */
export function mergeSceneObjects(
  planner: ScenePlanner,
  moduleResults: SceneModuleResult[],
  oldSceneObjects: SceneConfigObject3D[] = [],
): SceneConfig {
  // 1. shellObjects：planner.elements（分区 group 容器 + 结构 group）
  const shellObjects: SceneConfigObject3D[] = (planner.elements ?? []).map((e) => ({ ...e }))

  // 2. 计算 modify 场景下哪些 slot 的旧物体要被替换/保留
  const slotsByOp = new Map<string, "create" | "modify" | "none">()
  for (const s of planner.slots ?? []) {
    slotsByOp.set(s.element_id, (s.operation ?? "create") as "create" | "modify" | "none")
  }

  // 3. 保留旧物体：operation==="none" 和 "modify" 的 slot 的旧物体都保留。
  //    none：分区未变动，原样保留。
  //    modify：分区有改动，但 agent 通常只返回改动部分（不重输出全部），所以保留旧物体，
  //           再用 moduleResults 里同 id 的新物体覆盖、新 id 的追加（见第 5 步）。
  //    create：新分区，无旧物体，不保留。
  //    归属判断：沿 parentId 链向上查找，直到命中某 slot.element_id，取其 operation。
  //    （孙物体 parentId 指向子 group，非 element_id 本身，需递归向上找分区根。）
  const keptOldObjects: SceneConfigObject3D[] = []
  const shellIdSet = new Set(shellObjects.map((o) => o.id))
  // oldSceneObjects 的 id → object 映射（用于沿 parentId 链向上找）
  const oldById = new Map<string, SceneConfigObject3D>()
  for (const o of oldSceneObjects) {
    if (o.id) oldById.set(o.id, o)
  }
  function resolveZoneOp(obj: SceneConfigObject3D): "create" | "modify" | "none" | undefined {
    let cur = obj
    let guard = 0
    while (cur && guard++ < 32) {
      const pid = cur.parentId
      if (pid === null || pid === undefined) return undefined
      const op = slotsByOp.get(pid)
      if (op) return op
      const next: SceneConfigObject3D | undefined = oldById.get(pid) ?? shellObjects.find((s) => s.id === pid)
      if (!next) return undefined
      cur = next
    }
    return undefined
  }
  for (const obj of oldSceneObjects) {
    if (shellIdSet.has(obj.id)) continue // shell 物体由 planner 提供，不保留旧版
    const op = resolveZoneOp(obj)
    if (op === "none" || op === "modify") {
      keptOldObjects.push(obj)
    }
    // create/undefined 的旧物体丢弃
  }

  // 4. moduleObjects：各分区新物体（modify 场景下可能是增量，只含改动+新增）
  const moduleObjects: SceneConfigObject3D[] = []
  for (const r of moduleResults) {
    if (r?.scene_objects) {
      moduleObjects.push(...r.scene_objects)
    }
  }

  // 5. 合并：shell + 保留旧物体 + 新物体，按 id 去重（新物体覆盖同 id 旧物）
  //    modify 场景下 module 可能只返回增量（改动+新增），旧物体已在 keptOldObjects，
  //    此处按 id 去重：module 物体优先（覆盖旧版），keptOld 中未被覆盖的保留。
  //    顺序保证父先于子（shell 先、旧物次、新物最后）。
  const seen = new Set<string>()
  const merged: SceneConfigObject3D[] = []
  for (const obj of [...shellObjects, ...keptOldObjects, ...moduleObjects]) {
    if (seen.has(obj.id)) continue
    seen.add(obj.id)
    merged.push(obj)
  }
  // 轻量 parentId 一致性检查：父必须已存在
  const idSet = new Set(merged.map((o) => o.id))
  const validObjects = merged.filter((o) => {
    if (o.parentId === null || o.parentId === undefined) return true
    if (!idSet.has(o.parentId)) {
      console.warn(`[mergeSceneObjects] 丢弃孤儿对象 ${o.id}：parentId=${o.parentId} 不存在`)
      return false
    }
    return true
  })

  // 6. 组装完整 SceneConfig：camera/lights/scene 取 planner，objects 用合并结果
  const sceneConfig: SceneConfig = {
    version: "1.0",
    angleUnit: "deg",
    scene: planner.scene ?? { background: "#1a1a2e" },
    camera: planner.camera ?? {
      type: "perspective",
      position: [10, 8, 12],
      lookAt: [0, 0, 0],
      perspective: { fov: 50, near: 0.1, far: 1000 },
    },
    lights: planner.lights ?? [{ type: "ambient", intensity: 0.6 }],
    objects: validObjects,
  }

  return sceneConfig
}
