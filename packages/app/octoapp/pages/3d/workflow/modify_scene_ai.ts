import proto_3d_triage, { type Triage3DSetOp } from "../agents/proto_3d_triage"
import proto_3d_object from "../agents/proto_3d_object"
import { topoSortByParent } from "../agents/merge_scene"
import create_scene from "./create_scene"
import type { SceneObject } from "../utils/scene-protocol"

type ModifySceneCtx = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

type LastData = {
  lastIntent: any
  lastPlanner: any
  sceneJson: any
}

/** 原地设置点分字段(如 "material.color"),自动创建中间对象。
 *  支持数组轴路径:"position.y" / "rotation.x" / "scale.z" → 只改对应分量。 */
function setField(obj: any, path: string, value: unknown) {
  const keys = path.split(".")
  if (keys.length === 2 && (keys[0] === "position" || keys[0] === "rotation" || keys[0] === "scale")) {
    const axisIdx = { x: 0, y: 1, z: 2 }[keys[1]]
    if (axisIdx !== undefined) {
      const arr = Array.isArray(obj[keys[0]]) ? [...obj[keys[0]]] : [0, 0, 0]
      while (arr.length < 3) arr.push(0)
      arr[axisIdx] = value as number
      obj[keys[0]] = arr
      return
    }
  }
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  cur[keys[keys.length - 1]] = value
}

/**
 * 修改流水线(v2 + B 路线):优先「原地保持」,强制结构化 set。
 * set 的 target 支持:
 *   - 物体 id          → 改该物体字段
 *   - "scene"          → 改场景元信息(background / fog / environment / renderStyle)
 *   - "camera"         → 改相机(position / lookAt / fov 等)
 *   - "lights"         → 批量改所有灯光
 *   - "light:<type>"   → 改某类灯光(如 "light:directional" / "light:hemisphere")
 */
export default async function modify_scene_ai(inputCtx: ModifySceneCtx, lastData: LastData, onFinished: (result: any) => Promise<void>) {
  const triage = await proto_3d_triage({
    ...inputCtx,
    lastPlanner: lastData.lastPlanner,
    lastObjects: lastData.sceneJson?.objects ?? [],
  })
  console.log("[3D modify] triage.routing =", triage.routing)
  console.log("[3D modify] triage.set =", JSON.stringify(triage.set, null, 2))
  console.log("[3D modify] triage.add =", JSON.stringify(triage.add, null, 2))
  console.log("[3D modify] triage.delete =", triage.delete)

  // 整体重生成(仅彻底重构)
  if (triage.routing === "regenerate") {
    const query = `${inputCtx.userInput}（按反馈整体重构:${triage.reason}）`
    return create_scene({ ...inputCtx, userInput: query }, onFinished)
  }

  // deep copy 完整 sceneDoc,便于 set 改 scene/camera/lights/objects
  const sceneDoc: any = JSON.parse(JSON.stringify(lastData.sceneJson ?? { version: "1", scene: {}, camera: {}, lights: [], objects: [] }))
  if (!sceneDoc.scene) sceneDoc.scene = {}
  if (!sceneDoc.camera) sceneDoc.camera = {}
  if (!Array.isArray(sceneDoc.lights)) sceneDoc.lights = []
  if (!Array.isArray(sceneDoc.objects)) sceneDoc.objects = []
  const objects: any[] = sceneDoc.objects

  // a) set:支持 object id / scene / camera / lights / light:<type>
  const setOps: Triage3DSetOp[] = triage.set ?? []
  if (setOps.length > 0) {
    const byId = new Map<string, any>(objects.map((o: any) => [o.id, o]))
    for (const s of setOps) {
      if (!Array.isArray(s.target) || !s.field) continue
      for (const target of s.target) {
        if (target === "scene") {
          setField(sceneDoc.scene, s.field, s.value)
        } else if (target === "camera") {
          setField(sceneDoc.camera, s.field, s.value)
        } else if (target === "lights") {
          for (const l of sceneDoc.lights) setField(l, s.field, s.value)
        } else if (typeof target === "string" && target.startsWith("light:")) {
          const type = target.slice(6)
          for (const l of sceneDoc.lights) if (l.type === type) setField(l, s.field, s.value)
        } else {
          const o = byId.get(target)
          if (o) setField(o, s.field, s.value)
        }
      }
    }
  }

  // b) delete
  const delSet = new Set<string>(triage.delete ?? [])
  let curObjects: SceneObject[] = delSet.size > 0 ? objects.filter((o) => !delSet.has(o.id)) : objects

  // c) add 增量生成(只生成新增,不动原有)
  const addItems = triage.add ?? []
  if (addItems.length > 0) {
    const referenceObjects = curObjects.map((o: any) => ({
      id: o.id, type: o.type, parentId: o.parentId,
      position: o.position, scale: o.scale, rotation: o.rotation, geometry: o.geometry,
    }))
    const slotResults = await Promise.all(
      addItems.map((a) =>
        proto_3d_object({
          ...inputCtx,
          idPrefix: a.id_prefix,
          sectionId: a.section_id,
          parentId: a.parent_id,
          sectionDetail: { id: a.section_id, name: a.section_id, intent: a.detail, function: a.detail, elements: a.detail, layout: a.detail },
          intentDescription: lastData.lastIntent ?? {},
          referenceObjects,
        }),
      ),
    )
    const newObjects = slotResults.flatMap((r) => r.objects)
    curObjects = topoSortByParent([...curObjects, ...newObjects])
  }

  sceneDoc.objects = curObjects
  const sceneJson = { ...sceneDoc, version: "1" }
  await onFinished({
    sceneIntent: lastData.lastIntent,
    scenePlanner: lastData.lastPlanner,
    slotResults: [],
    sceneJson,
  })
}
