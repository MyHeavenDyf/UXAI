import type { SceneDocument, SceneObject } from '../utils/scene-protocol'

type ScenePlanner = {
  scene?: Record<string, unknown>
  camera: Record<string, unknown>
  lights?: unknown[]
  rootId?: string
  groups?: SceneObject[]
  slots?: unknown[]
}

type SlotAssets = {
  glb?: Record<string, unknown>
  materials?: Record<string, unknown>
  textures?: Record<string, unknown>
}

export type SlotResult = {
  objects: SceneObject[]
  section_id: string
  parent_id: string
  id_prefix: string
  assets?: SlotAssets
}

/**
 * parent-first 拓扑排序:父节点必须在子节点之前出现。
 * 渲染器按数组顺序构建,父先于子才能正确应用局部→世界变换链。
 */
export function topoSortByParent(objects: SceneObject[]): SceneObject[] {
  const byId = new Map<string, SceneObject>()
  for (const o of objects) if (o?.id) byId.set(o.id, { ...o })
  const placed = new Set<string>()
  const result: SceneObject[] = []
  let pending = [...byId.values()]

  while (pending.length > 0) {
    const next: SceneObject[] = []
    let progressed = false
    for (const o of pending) {
      const p = o.parentId
      // 父已就绪:无 parent / 父已放置 / 父不在本集合(外部根)
      if (p == null || p === "" || placed.has(p) || !byId.has(p)) {
        result.push(o)
        placed.add(o.id)
        progressed = true
      } else {
        next.push(o)
      }
    }
    pending = next
    if (!progressed) {
      // 兜底:出现循环引用或孤儿,直接追加避免死循环
      result.push(...pending)
      break
    }
  }
  return result
}

/**
 * 合并舞台骨架(group)+ 各 slot 物体 → 完整 SceneDocument。
 * 比 pattern 的 mergeModules 更简单:场景合并就是「拼接 + 去重 id + parent-first 排序」。
 */
export function mergeScene(planner: ScenePlanner, slotResults: SlotResult[]): SceneDocument {
  const groups = (planner.groups ?? []) as SceneObject[]
  const allObjects: SceneObject[] = [...groups]

  // 收集资源声明(glb/材质/纹理),各 slot 可能各自声明,这里合并
  const assetsGlb: Record<string, unknown> = {}
  const assetsMaterials: Record<string, unknown> = {}
  const assetsTextures: Record<string, unknown> = {}

  for (const r of slotResults) {
    allObjects.push(...(r.objects ?? []))
    if (r.assets?.glb) Object.assign(assetsGlb, r.assets.glb)
    if (r.assets?.materials) Object.assign(assetsMaterials, r.assets.materials)
    if (r.assets?.textures) Object.assign(assetsTextures, r.assets.textures)
  }

  // 去重 id(保留首个)
  const seen = new Set<string>()
  const deduped = allObjects.filter((o) => {
    if (!o?.id || seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })

  const hasAssets =
    Object.keys(assetsGlb).length > 0 ||
    Object.keys(assetsMaterials).length > 0 ||
    Object.keys(assetsTextures).length > 0

  return {
    version: "1",
    angleUnit: "degree",
    scene: (planner.scene as SceneDocument["scene"]) ?? { environment: { preset: "studio" }, renderStyle: "studio" },
    camera: planner.camera as unknown as SceneDocument["camera"],
    lights: (planner.lights as SceneDocument["lights"]) ?? [],
    assets: hasAssets
      ? ({ glb: assetsGlb, materials: assetsMaterials, textures: assetsTextures } as unknown as SceneDocument["assets"])
      : undefined,
    objects: topoSortByParent(deduped),
  }
}
