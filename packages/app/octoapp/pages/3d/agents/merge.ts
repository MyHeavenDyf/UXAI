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
  //    注入 __zone 标记到 slot.element_id 对应的 group：zone 身份权威源 = planner.slots，
  //    传给渲染端 liveDataLoader 标 __logicalRoot（编辑态「整体」选中）。支持嵌套分区
  //    （如 tableAndPropsZone 挂在 platformAndGroundZone 下，两者都是 zone）。
  const zoneElementIds = new Set((planner.slots ?? []).map((s) => s.element_id))
  const shellObjects: SceneConfigObject3D[] = (planner.elements ?? []).map((e) => ({
    ...e,
    ...(zoneElementIds.has(e.id) ? { __zone: true } : {}),
  }))

  // 2. 计算 modify 场景下哪些 slot 的旧物体要被替换/保留
  const slotsByOp = new Map<string, "create" | "modify" | "none">()
  for (const s of planner.slots ?? []) {
    slotsByOp.set(s.element_id, (s.operation ?? "create") as "create" | "modify" | "none")
  }

  // 3. 保留旧物体：只保留 operation==="none" 的分区旧物体。
  //    none：分区未变动，无 agent 重生成，原样保留其旧物体。
  //    modify：分区有改动，module_modify 按契约返回该分区【完整】物体清单（含未改动的原物体，
  //           见 scene_3d_module_modify.txt "输出完整的该分区全部物体"）。旧物体会被 module 输出整体替换 ——
  //           若再保留旧物，被删除的物体会从旧集复活（删除失效，且改名物体会重复）。故 modify 分区旧物体一律不保留。
  //    create：新分区，无旧物体。
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
    if (op === "none") {
      keptOldObjects.push(obj)
    }
    // modify / create / undefined 的旧物体一律丢弃：
    //   modify 由 module 输出整体替换；create 无旧物；undefined 是归属不明的孤立旧物。
  }

  // 4. moduleObjects：各分区新物体（modify 场景下可能是增量，只含改动+新增）
  const moduleObjects: SceneConfigObject3D[] = []
  for (const r of moduleResults) {
    if (r?.scene_objects) {
      moduleObjects.push(...r.scene_objects)
    }
  }

  // 5. 合并：shell + 新物体（modify/create 分区的完整输出）+ 保留旧物体（none 分区），按 id 去重。
  //    modify 分区旧物体已在第 3 步剔除，此处由 moduleObjects 整体替换（含删除/改名/新增语义）；
  //    none 分区旧物体在 keptOldObjects 原样保留。moduleObjects 排在 keptOldObjects 前以确保
  //    万一同 id 冲突时新物体优先（正常无冲突，分区 id_prefix 不同）。
  //    渲染端（3d-templete liveDataLoader）两遍构建（先建 nodeMap 再按 parentId 挂载），
  //    数组顺序不影响最终父子关系，故无需保证"父先于子"。
  const seen = new Set<string>()
  const merged: SceneConfigObject3D[] = []
  for (const obj of [...shellObjects, ...moduleObjects, ...keptOldObjects]) {
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

  // 诊断汇总：验证 modify 流物体累积时用（对照 sendToPreview payload 的 objects 数）。
  if (oldSceneObjects.length > 0) {
    console.log(
      `[mergeSceneObjects] old=${oldSceneObjects.length} shell=${shellObjects.length} keptOld=${keptOldObjects.length} module=${moduleObjects.length} → merged=${merged.length} valid=${validObjects.length}`,
    )
  }

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
