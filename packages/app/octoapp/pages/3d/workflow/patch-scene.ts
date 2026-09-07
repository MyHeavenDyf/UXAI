/**
 * patch-scene —— NL patch dispatcher（Phase A set_instance + Phase D set_type_transform + Phase B skip_instance）。
 *
 * triage routing="patch" + patchOps[] → 本 dispatcher 确定性应用（仿 2D mergeJson 的确定性思想：
 * 只 patch 点名的目标，其余 handler 文件原样保留，不靠 LLM 自觉重输出全量）：
 *
 *   loadCurrentSceneState 取 codeDir+merged → readCodeDirFiles 读全量 →
 *   extractPatchCandidates 抽候选 → 校验所有 op 目标合法（防 triage 臆造）→
 *   ① set_type_transform：改 live-data 节点 params（整物 transform，handler 读 opts.position 整体移动）
 *   ② set_instance：per-handler ensureApplyOverride 自愈漏 applyOverride 的子物 + patchHandlerOverride
 *      merge 进 SUB_OVERRIDES（部件材质/transform）
 *   → 重组全量 codeFiles → 调 onMaterialize 轻量物化（overlay 子集 + vite 自然 full-reload，不碰 switchVersion 240s 卡顿）。
 *
 * 校验失败 / 应用失败（任一 op）→ 不物化，返回 ok:false，调用方（codegen_scene）fallback 进现有
 * plan/codegen 全量重生成（triage 同输出 types.modify hint）。all-or-nothing，避免「部分 patch 已物化 + fallback
 * codegen 覆盖」的不一致。
 *
 * **ensureApplyOverride 自愈**（修「改墙色无反应」静默 no-op）：LLM 常对单组件型子物（createComponentObject('Wall')）
 * 设 __id 却漏调 applyOverride → SUB_OVERRIDES 写了运行时不读 = 静默无变化。patchHandlerOverride 写入前先调
 * ensureApplyOverride：定位 `obj.userData.__id = <cid>` 赋值点，若该 obj 无 applyOverride 调用，在其 .add 前
 * 确定性注入一行 applyOverride —— 既有不合契约 handler 自愈，无需 codegen 重生成、不丢其他物体。
 *
 * Phase B skip_instance（SUB_SKIP 删循环单实例；handler 无骨架时 fallback codegen 升级）保留；
 * Phase C add_instance（SUB_ADD 加单实例；handler 无骨架时 fallback codegen 升级）保留；
 * edit_code（通用 search→replace 改代码，CRUD 主线：改墙高/批量色/数量/删单部件删 group.add 行/加删一排改数组）保留；
 * extend_position_array 已砍（统一 edit_code 改位置数组）；Phase D 余 remove_type（live-data + index.ts 行编辑）未做。
 */
import { loadCurrentSceneState, readCodeDirFiles } from "../utils/version-history"
import {
  patchHandlerOverride,
  patchHandlerSkip,
  hasSkipSkeleton,
  patchHandlerAdd,
  hasAddSkeleton,
  applySearchReplace,
  resolveTypeId,
  handlerFilePathForType,
  ensureApplyOverride,
} from "../utils/patch-handler"
import { extractPatchCandidates, searchHandlerForSynonymCid } from "./patch-resolver"
import type { CodeFile } from "../utils/parse-code-files"

/** transform 字段（rotation 存弧度，Three 原生，applyOverride / live-data params 直接用） */
export interface TransformFields {
  position?: number[]
  rotation?: number[]
  scale?: number[]
}

/** Phase A op：改已有子实例（部件）的材质 + transform（任一或全有） */
export interface SetInstanceOp {
  op: "set_instance"
  __id: string
  material?: Record<string, unknown>
  transform?: TransformFields
}

/** Phase D op：改顶层 type 节点整体（整个物体）的 transform —— 整物移动/旋转/缩放。
 * 目标是一个完整物体（如台灯、机柜区）而非其部件；改 live-data 节点 params，handler 读 opts.position 整体生效。
 * nodeId 可选：triage 只出 type（取自 currentTypes）；host 按 type 唯一节点反推 nodeId，
 * 多同类时 triage 显式给 nodeId 消歧（取自当前场景节点）。 */
export interface SetTypeTransformOp {
  op: "set_type_transform"
  type: string
  nodeId?: string
  transform: TransformFields
}

/** Phase B op：删一个已有子实例（部件）—— 把其 __id 加进 handler 的 SUB_SKIP 删除集合，
 * handler 创建点 `if (SUB_SKIP.includes(cid)) continue` 跳过 = 删除。须 __id ∈ 候选清单（同 set_instance，
 * 防臆造）；handler 须含 SUB_SKIP 骨架（hasSkipSkeleton），否则该 type 进 codegenFallback 升级。 */
export interface SkipInstanceOp {
  op: "skip_instance"
  __id: string
}

/** Phase C op：加一个同质子实例（循环型 handler 加同质子物）—— 把 {cid,position,rotation?,material?}
 * 条目加进 handler 的 SUB_ADD 数组，handler 主循环后 `for (const add of SUB_ADD)` 后置遍历补创建 = 加子物。
 * cid 须 `${nodeId}-` 起头（host 反查 type 靠前缀；新 cid 不在候选清单，故不校验候选）；
 * position 必填（新实例放哪由 triage 推断）；handler 须含 SUB_ADD 骨架（hasAddSkeleton），否则 fallback 升级。 */
export interface AddInstanceOp {
  op: "add_instance"
  type: string
  nodeId: string
  cid: string
  position: number[]
  rotation?: number[]
  material?: Record<string, unknown>
}

/** Phase E op：通用改代码路线 —— 对 handler 源码做 search→replace（Aider 式精确匹配）。
 * 覆盖数据补丁（SUB_*）够不着的「烘在代码里的值」：墙高常量 / 批量材质色 / 循环数量 / 任意字面量。
 * edits 的 search 须从注入的 [当前 handler 源码] 照搬（verbatim 且唯一匹配）；host 应用时校验，
 * 0/>1 匹配 → fallback modify（不破 handler、不丢其他物体）。triage 须见 [当前 handler 源码] 才能产出 verbatim search。 */
export interface EditCodeOp {
  op: "edit_code"
  type: string
  edits: { search: string; replace: string }[]
}

/** 场景级 op（M-3 ①）：改 live-data 顶层保留键 lights/camera/scene，运行时 mutate 不重建物体树。
 *  不经 handler 源码、不抽 patch 候选、不校验候选（直读 live-data 保留键，区别于部件级五 op）。 */
export interface SetLightOp {
  op: "set_light"
  /** lights 数组索引（0=第一盏灯；lights 无 id 字段，按顺序定位） */
  index: number
  /** 要改的字段：intensity/color/skyColor/groundColor/position/target/castShadow 等 */
  fields: Record<string, unknown>
}
export interface SetCameraOp {
  op: "set_camera"
  /** 要改的字段：position/lookAt/perspective.fov/type（type 变 perspective↔orthographic 才重建） */
  fields: Record<string, unknown>
}
export interface SetSceneOp {
  op: "set_scene"
  /** 要改的字段：background/fog/environment.intensity（直接 mutate scene 属性，不重建物体树） */
  fields: Record<string, unknown>
}

// Phase D 余：remove_type
export type PatchOp =
  | SetInstanceOp
  | SetTypeTransformOp
  | SkipInstanceOp
  | AddInstanceOp
  | EditCodeOp
  | SetLightOp
  | SetCameraOp
  | SetSceneOp

export interface PatchSceneInput {
  /** 场景历史目录（sceneHistoryDir()） */
  sceneDir: string
  /** 会话 ID */
  sid: string
  /** triage 输出的 patchOps */
  patchOps: PatchOp[]
  /** 版本摘要提示（用户原话 / NL 请求），落进版本历史 summary；缺省回退「patch N 项」 */
  summaryHint?: string
  /** 轻量物化回调（index.tsx materializePatch：archive+overlay，不调 switchVersion） */
  onMaterialize: (
    files: CodeFile[],
    summary: string,
    sceneData: Record<string, unknown> | null,
  ) => Promise<void>
  /** 场景级物化回调（M-3 ①，纯场景级 op 用）：落盘 live-data + post SCENE_PATCH_ENV 增量 mutate，
   *  不 overlay handler / 不 reload / 不 dispose（区别于 onMaterialize 的 overlay+reload 重建）。 */
  onEnvMaterialize?: (
    files: CodeFile[],
    summary: string,
    sceneData: Record<string, unknown> | null,
  ) => Promise<void>
}

export interface PatchSceneResult {
  ok: boolean
  /** 成功 patch 进 handler 的项数 */
  appliedCount: number
  /** 无法应用 + 原因 */
  skipped: { __id: string; reason: string }[]
  /** 需 fallback 到 plan/codegen 的顶层 type（Phase B/C 用；Phase A/D 恒空） */
  fallbackTypes: string[]
  error?: string
}

/** 在 scene 对象的 type 分组里按 nodeId 找顶层节点（Record 或 null） */
function findTypeNode(
  sceneObj: Record<string, unknown>,
  type: string,
  nodeId: string,
): Record<string, unknown> | null {
  const arr = sceneObj[type]
  if (!Array.isArray(arr)) return null
  for (const n of arr) {
    if (n && typeof n === "object" && (n as { id?: unknown }).id === nodeId) {
      return n as Record<string, unknown>
    }
  }
  return null
}

/** 某 type 下若恰好 1 个顶层节点 → 返其 id；0 或 >1 → null（多同类须 triage 显式 nodeId 消歧） */
function uniqueNodeIdOfType(sceneObj: Record<string, unknown>, type: string): string | null {
  const arr = sceneObj[type]
  if (!Array.isArray(arr) || arr.length !== 1) return null
  const id = (arr[0] as { id?: unknown }).id
  return typeof id === "string" ? id : null
}

/**
 * 把整物 transform merge 进 scene 对象某顶层节点的 params（position/rotation/scale 子字段级）。
 * 用于 set_type_transform：改 live-data 节点 params → handler 读 opts.position 整体移动。
 * 找不到节点返回 false（调用方判 fallback）。原地 mutate。
 */
function applyTypeTransform(
  sceneObj: Record<string, unknown>,
  type: string,
  nodeId: string,
  tf: TransformFields,
): boolean {
  const node = findTypeNode(sceneObj, type, nodeId)
  if (!node) return false
  const params = (node.params ?? {}) as Record<string, unknown>
  if (tf.position) params.position = tf.position
  if (tf.rotation) params.rotation = tf.rotation
  if (tf.scale) params.scale = tf.scale
  node.params = params
  return true
}

/** 场景级 op 判定（M-3 ①）：set_light/set_camera/set_scene 作用 live-data 顶层保留键，
 *  不进 handler 源码 patch、不抽候选、不校验候选（直读 live-data，区别于部件级五 op）。 */
function isSceneLevelOp(op: PatchOp): op is SetLightOp | SetCameraOp | SetSceneOp {
  return op.op === "set_light" || op.op === "set_camera" || op.op === "set_scene"
}

/**
 * 把场景级 op merge 进 scene 对象的顶层保留键（lights[index]/camera/scene）。
 * 用于 set_light/set_camera/set_scene：改 live-data 保留键 → 运行时 mutate 不重建物体树。
 * lights 按 index 定位（数组无 id）；camera/scene 是对象直接 merge。原地 mutate。
 * @returns true=应用成功；false=目标不存在（index 越界 / camera·scene 缺失）→ 调用方判 skipped。
 */
function applySceneLevel(
  sceneObj: Record<string, unknown>,
  op: SetLightOp | SetCameraOp | SetSceneOp,
): boolean {
  if (op.op === "set_light") {
    const lights = sceneObj.lights
    if (!Array.isArray(lights) || op.index < 0 || op.index >= lights.length) return false
    const light = lights[op.index]
    if (!light || typeof light !== "object") return false
    Object.assign(light as Record<string, unknown>, op.fields)
    return true
  }
  if (op.op === "set_camera") {
    const camera = sceneObj.camera
    if (!camera || typeof camera !== "object") return false
    Object.assign(camera as Record<string, unknown>, op.fields)
    return true
  }
  // set_scene
  const scene = sceneObj.scene
  if (!scene || typeof scene !== "object") return false
  Object.assign(scene as Record<string, unknown>, op.fields)
  return true
}

export async function patchScene(input: PatchSceneInput): Promise<PatchSceneResult> {
  const { sceneDir, sid, patchOps, onMaterialize, onEnvMaterialize, summaryHint } = input
  const skipped: { __id: string; reason: string }[] = []

  if (patchOps.length === 0) {
    return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: "patchOps 为空" }
  }

  // 1. 取当前版本 codeDir + mergedSceneConfig
  const state = await loadCurrentSceneState(sceneDir, sid)
  const codeDir = state?.codeDir
  const merged = state?.mergedSceneConfig ?? null
  if (!codeDir) {
    return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: "无 codeDir（需先生成场景）" }
  }
  if (!merged) {
    return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: "无 mergedSceneConfig，无法反查 __id 所属 type" }
  }

  // 2. 读 codeDir 全量 + 抽候选
  const files = await readCodeDirFiles(codeDir)
  if (!files || files.length === 0) {
    return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: `读 codeDir 失败或为空：${codeDir}` }
  }
  const candidates = extractPatchCandidates(files, merged)
  const candById = new Map(candidates.map((c) => [c.__id, c]))
  const candIds = new Set(candById.keys())

  // 3. 拆分 + 校验 ops（all-or-nothing：任一校验失败 → 不物化，调用方 fallback codegen）
  const instanceOps: SetInstanceOp[] = []
  const typeOps: { type: string; nodeId: string; transform: TransformFields }[] = []
  const skipOps: { __id: string; type: string }[] = []
  const addOps: {
    type: string
    nodeId: string
    cid: string
    position: number[]
    rotation?: number[]
    material?: Record<string, unknown>
  }[] = []
  const editCodeOps: { type: string; edits: { search: string; replace: string }[] }[] = []
  const sceneLevelOps: (SetLightOp | SetCameraOp | SetSceneOp)[] = []
  for (const op of patchOps) {
    if (op.op === "set_instance") {
      if (!op.material && !op.transform) {
        skipped.push({ __id: op.__id, reason: "set_instance 须含 material 或 transform" })
        continue
      }
      if (!candIds.has(op.__id)) {
        // 方案 C 兜底：triage 按用户词臆造的 __id（如「集装箱」→container-0）不在候选清单，
        // 扫 handler 源码找同义词 cid（container→box）映射到真实候选；找到则修正 __id 继续应用，否则 skip 降级 modify
        const syn = searchHandlerForSynonymCid(op.__id, candidates, files)
        if (!syn) {
          skipped.push({ __id: op.__id, reason: `__id 不在候选清单（命名漂移 / 循环 cid / 非语义 cid），需 fallback modify` })
          continue
        }
        op.__id = syn.__id
        candIds.add(syn.__id)
        candById.set(syn.__id, syn)
      }
      if (!resolveTypeId(merged, op.__id)) {
        skipped.push({ __id: op.__id, reason: "无法反推所属 type" })
        continue
      }
      instanceOps.push(op)
    } else if (op.op === "set_type_transform") {
      if (!op.transform || (!op.transform.position && !op.transform.rotation && !op.transform.scale)) {
        skipped.push({ __id: `${op.type}/${op.nodeId ?? ""}`, reason: "set_type_transform 须含 transform（position/rotation/scale 至少一个）" })
        continue
      }
      // 解析 nodeId：triage 显式给则校验存在；否则按 type 唯一节点反推（多同类须显式 nodeId 消歧）
      let nodeId = op.nodeId ?? ""
      if (!nodeId) nodeId = uniqueNodeIdOfType(merged, op.type) ?? ""
      if (!nodeId || !findTypeNode(merged, op.type, nodeId)) {
        skipped.push({
          __id: `${op.type}/${op.nodeId ?? nodeId}`,
          reason: op.nodeId
            ? `顶层节点 ${op.nodeId} 不在 ${op.type} 分组`
            : `${op.type} 下非唯一顶层节点（须显式 nodeId 指定）`,
        })
        continue
      }
      typeOps.push({ type: op.type, nodeId, transform: op.transform })
    } else if (op.op === "skip_instance") {
      // 删子实例：__id 须在候选清单（同 set_instance；循环 cid 不在清单 = 删不了，走 modify）+ 能反推 type
      if (!candIds.has(op.__id)) {
        // 方案 C 兜底：同 set_instance，扫 handler 源码找同义词 cid 映射到真实候选
        const syn = searchHandlerForSynonymCid(op.__id, candidates, files)
        if (!syn) {
          skipped.push({ __id: op.__id, reason: `__id 不在候选清单（命名漂移 / 循环 cid / 非语义 cid），需 fallback modify` })
          continue
        }
        op.__id = syn.__id
        candIds.add(syn.__id)
        candById.set(syn.__id, syn)
      }
      const type = resolveTypeId(merged, op.__id)
      if (!type) {
        skipped.push({ __id: op.__id, reason: "无法反推所属 type" })
        continue
      }
      skipOps.push({ __id: op.__id, type })
    } else if (op.op === "add_instance") {
      // 加子实例：cid 是**新**实例（不在候选清单，故不校验候选）；只校验前缀（host 靠 nodeId- 反查 type）+ position + nodeId 存在
      if (!op.position || op.position.length < 3) {
        skipped.push({ __id: op.cid, reason: "add_instance 须含 position（至少 3 元素）" })
        continue
      }
      if (!op.cid.startsWith(`${op.nodeId}-`)) {
        skipped.push({
          __id: op.cid,
          reason: `add_instance cid 须以 ${op.nodeId}- 起头（host 靠前缀反查 type）`,
        })
        continue
      }
      if (!findTypeNode(merged, op.type, op.nodeId)) {
        skipped.push({ __id: op.cid, reason: `nodeId ${op.nodeId} 不在 ${op.type} 分组（无法定位 handler）` })
        continue
      }
      addOps.push({
        type: op.type,
        nodeId: op.nodeId,
        cid: op.cid,
        position: op.position,
        rotation: op.rotation,
        material: op.material,
      })
    } else if (op.op === "edit_code") {
      // 通用改代码（search→replace）：edits 须非空数组；type 须在场景 type 分组（host 据此定位 handler）。
      // search 唯一匹配校验在应用阶段做（applySearchReplace），失败走 fallback modify。
      if (!Array.isArray(op.edits) || op.edits.length === 0) {
        skipped.push({ __id: op.type, reason: "edit_code 须含 edits（至少 1 对 search→replace）" })
        continue
      }
      if (!Array.isArray(merged[op.type])) {
        skipped.push({ __id: op.type, reason: `${op.type} 不在当前场景 type 分组` })
        continue
      }
      editCodeOps.push({ type: op.type, edits: op.edits })
    } else if (isSceneLevelOp(op)) {
      // 场景级 op（M-3 ①）：set_light/set_camera/set_scene 直读 live-data 保留键，
      // 不抽候选、不校验候选、不碰 handler 源码。校验 = 目标存在（index 不越界 / camera·scene 键在）+ fields 非空。
      if (op.op === "set_light") {
        const lightArr = merged.lights
        if (!Array.isArray(lightArr) || op.index < 0 || op.index >= lightArr.length) {
          skipped.push({ __id: `light-${op.index}`, reason: `lights 索引 ${op.index} 越界（当前 ${Array.isArray(lightArr) ? lightArr.length : 0} 盏）` })
          continue
        }
      } else if (op.op === "set_camera") {
        if (!merged.camera || typeof merged.camera !== "object") {
          skipped.push({ __id: "camera", reason: "live-data 无 camera 保留键" })
          continue
        }
      } else {
        // set_scene
        if (!merged.scene || typeof merged.scene !== "object") {
          skipped.push({ __id: "scene", reason: "live-data 无 scene 保留键" })
          continue
        }
      }
      if (!op.fields || typeof op.fields !== "object") {
        skipped.push({ __id: op.op, reason: `${op.op} 须含 fields（至少 1 个要改的字段）` })
        continue
      }
      sceneLevelOps.push(op)
    } else {
      // op 在此为 never（PatchOp 八分支已穷尽）；防御性兜底：若联合扩展未接线则落地坏 op 便于排查
      skipped.push({ __id: "", reason: `未知 op 类型：${JSON.stringify(op)}` })
    }
  }

  if (skipped.length > 0) {
    return {
      ok: false,
      appliedCount: 0,
      skipped,
      fallbackTypes: [],
      error: `部分 patch op 无法应用（${skipped.length}/${patchOps.length}），需 fallback modify`,
    }
  }

  // 4. 应用 set_type_transform + 场景级 op → 改 live-data（节点 params / 顶层保留键，不改 handler 代码）
  //    hasTypeOps || hasSceneLevel 时 deepClone merged（防 mutate 原引用）+ 解析 live-data.json，
  //    把改动同步进 clone（供 SCENE_UPDATE/SCENE_PATCH_ENV 下发）与 live-data（供 vite reload 重读 / 落盘）。
  const hasTypeOps = typeOps.length > 0
  const hasSceneLevel = sceneLevelOps.length > 0
  const mergedClone: Record<string, unknown> = hasTypeOps || hasSceneLevel
    ? JSON.parse(JSON.stringify(merged))
    : merged
  let liveDataFile: CodeFile | undefined
  let liveData: Record<string, unknown> | null = null
  if (hasTypeOps || hasSceneLevel) {
    liveDataFile = files.find((f) => f.path.replace(/\\/g, "/").endsWith("live-data.json"))
    if (!liveDataFile) {
      return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: "set_type_transform/场景级 patch 需改 live-data.json，但 codeDir 未找到该文件" }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(liveDataFile.content)
    } catch (e) {
      return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: `live-data.json 解析失败：${e instanceof Error ? e.message : String(e)}` }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, appliedCount: 0, skipped, fallbackTypes: [], error: "live-data.json 非 JSON 对象（无法应用 patch）" }
    }
    liveData = parsed as Record<string, unknown>
    for (const op of typeOps) {
      applyTypeTransform(mergedClone, op.type, op.nodeId, op.transform)
      applyTypeTransform(liveData, op.type, op.nodeId, op.transform)
    }
    for (const op of sceneLevelOps) {
      applySceneLevel(mergedClone, op)
      applySceneLevel(liveData, op)
    }
  }

  // 5. 应用 set_instance → per-handler：先 ensureApplyOverride 自愈漏 applyOverride 的子物
  //    （否则 SUB_OVERRIDES 写了运行时不读 = 静默 no-op，用户「改墙色无反应」即此），再 patchHandlerOverride merge
  const byType = new Map<string, SetInstanceOp[]>()
  for (const op of instanceOps) {
    const type = resolveTypeId(merged, op.__id) // 校验阶段已确认非空
    if (!type) continue // 防御（校验已挡）
    const arr = byType.get(type) ?? []
    arr.push(op)
    byType.set(type, arr)
  }
  for (const [type, ops] of byType) {
    const handlerPath = handlerFilePathForType(type)
    const target = files.find(
      (f) => f.path === handlerPath || f.path.replace(/\\/g, "/").endsWith(handlerPath),
    )
    if (!target) {
      for (const op of ops) skipped.push({ __id: op.__id, reason: `codeDir 未找到 ${type} handler 文件（${handlerPath}）` })
      continue
    }
    let src = target.content
    for (const op of ops) {
      const cand = candById.get(op.__id)
      if (cand) {
        // 自愈：handler 漏 applyOverride 则注入一行（幂等，已有则跳过）
        src = ensureApplyOverride(src, op.__id, cand.nodeId).source
      }
      try {
        src = patchHandlerOverride(src, op.__id, { material: op.material, transform: op.transform })
      } catch (e) {
        skipped.push({ __id: op.__id, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    target.content = src
  }

  // 5b. 应用 skip_instance → per-handler：有 SUB_SKIP 骨架则 patchHandlerSkip 加 cid（data patch）；
  //     无骨架 → skipped（该 type 需 codegen 升级，all-or-nothing 走 fallback modify）。
  //     （B6 将改为 scoped codegen 升级单 type + 再 data-patch，不全量 fallback。）
  if (skipOps.length > 0) {
    const skipByType = new Map<string, string[]>()
    for (const op of skipOps) {
      const arr = skipByType.get(op.type) ?? []
      arr.push(op.__id)
      skipByType.set(op.type, arr)
    }
    for (const [type, ids] of skipByType) {
      const handlerPath = handlerFilePathForType(type)
      const target = files.find(
        (f) => f.path === handlerPath || f.path.replace(/\\/g, "/").endsWith(handlerPath),
      )
      if (!target) {
        for (const id of ids) skipped.push({ __id: id, reason: `codeDir 未找到 ${type} handler 文件（${handlerPath}）` })
        continue
      }
      if (!hasSkipSkeleton(target.content)) {
        for (const id of ids) skipped.push({ __id: id, reason: `${type} handler 无 SUB_SKIP 骨架（需 codegen 升级，合 HANDLER_CONTRACT 规则 7）` })
        continue
      }
      let src = target.content
      for (const id of ids) {
        try {
          src = patchHandlerSkip(src, id, "add")
        } catch (e) {
          skipped.push({ __id: id, reason: e instanceof Error ? e.message : String(e) })
        }
      }
      target.content = src
    }
  }

  // 5c. 应用 add_instance → per-handler：有 SUB_ADD 骨架则 patchHandlerAdd 加条目（data patch）；
  //     无骨架 → skipped（该 type 需 codegen 升级，合 HANDLER_CONTRACT 规则 8，all-or-nothing 走 fallback modify）。
  //     （C6 将改为 scoped codegen 升级单 type + 再 data-patch，不全量 fallback。）
  if (addOps.length > 0) {
    const addByType = new Map<
      string,
      { cid: string; position: number[]; rotation?: number[]; material?: Record<string, unknown> }[]
    >()
    for (const op of addOps) {
      const arr = addByType.get(op.type) ?? []
      arr.push({ cid: op.cid, position: op.position, rotation: op.rotation, material: op.material })
      addByType.set(op.type, arr)
    }
    for (const [type, entries] of addByType) {
      const handlerPath = handlerFilePathForType(type)
      const target = files.find(
        (f) => f.path === handlerPath || f.path.replace(/\\/g, "/").endsWith(handlerPath),
      )
      if (!target) {
        for (const e of entries)
          skipped.push({ __id: e.cid, reason: `codeDir 未找到 ${type} handler 文件（${handlerPath}）` })
        continue
      }
      if (!hasAddSkeleton(target.content)) {
        for (const e of entries)
          skipped.push({
            __id: e.cid,
            reason: `${type} handler 无 SUB_ADD 骨架（需 codegen 升级，合 HANDLER_CONTRACT 规则 8）`,
          })
        continue
      }
      let src = target.content
      for (const e of entries) {
        try {
          src = patchHandlerAdd(src, {
            cid: e.cid,
            position: e.position,
            rotation: e.rotation,
            material: e.material,
          })
        } catch (err) {
          skipped.push({ __id: e.cid, reason: err instanceof Error ? err.message : String(err) })
        }
      }
      target.content = src
    }
  }

  // 5d. 应用 edit_code → per-handler：对 handler 源码做 search→replace（通用改代码路线，CRUD 主线）。
  //     search 须唯一匹配（0/>1 → skipped 走 fallback modify，不破 handler、不丢其他物体）。
  if (editCodeOps.length > 0) {
    for (const op of editCodeOps) {
      const handlerPath = handlerFilePathForType(op.type)
      const target = files.find(
        (f) => f.path === handlerPath || f.path.replace(/\\/g, "/").endsWith(handlerPath),
      )
      if (!target) {
        skipped.push({ __id: op.type, reason: `codeDir 未找到 ${op.type} handler 文件（${handlerPath}）` })
        continue
      }
      const res = applySearchReplace(target.content, op.edits)
      if (res.failed) {
        skipped.push({ __id: op.type, reason: res.failed.reason })
        continue
      }
      target.content = res.source
    }
  }

  // 应用阶段若任一失败 → all-or-nothing 不物化（in-memory 变更随 return 丢弃，无副作用）
  if (skipped.length > 0) {
    return {
      ok: false,
      appliedCount: 0,
      skipped,
      fallbackTypes: [],
      error: `部分 patch op 应用失败（${skipped.length}/${patchOps.length}），需 fallback modify`,
    }
  }

  // 6. 落盘 live-data 改动（场景级 / set_type_transform）+ 物化
  //    summary 优先用用户原话（summaryHint），让版本历史可辨（非「patch N 项」）；缺省回退通用
  if (liveDataFile && liveData) liveDataFile.content = JSON.stringify(liveData, null, 2)
  const appliedCount = patchOps.length - skipped.length
  const summary = summaryHint && summaryHint.trim() ? summaryHint.trim().slice(0, 60) : `patch ${appliedCount} 项`
  // 纯场景级（无部件级 op）→ onEnvMaterialize：落盘 live-data + post SCENE_PATCH_ENV 增量 mutate，
  //   不 overlay handler / 不 reload / 不 dispose（M-3 ① 核心：灯调亮不闪不丢编辑态）。
  //   混合 / 纯部件级 → onMaterialize：overlay handler + reload 重建，场景级改动随 live-data 重读自然生效。
  const hasComponentOps =
    instanceOps.length > 0 || hasTypeOps || skipOps.length > 0 || addOps.length > 0 || editCodeOps.length > 0
  if (hasSceneLevel && !hasComponentOps && onEnvMaterialize) {
    await onEnvMaterialize(files, summary, mergedClone)
  } else {
    // sceneData：改了 live-data → 用 mergedClone（含新值）；否则用原 merged
    await onMaterialize(files, summary, mergedClone)
  }

  return { ok: true, appliedCount, skipped, fallbackTypes: [] }
}
