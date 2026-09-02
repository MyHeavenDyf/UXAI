import { extractJson } from "../../utils/json-parser"
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import { SCENE_TRIAGE_FORMAT } from "./schema"
import { agentThrow } from "../../utils/error-msg"
import type { PatchOp, TransformFields, SetInstanceOp, SetTypeTransformOp, SkipInstanceOp, AddInstanceOp, EditCodeOp, SetLightOp, SetCameraOp, SetSceneOp } from "../../workflow/patch-scene"
import type { PatchCandidate } from "../../workflow/patch-resolver"

const AGENT_NAME = "scene_3d_triage"

export type TriageInputContext = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  lastIntent: any
  lastPlanner: any
  lastSceneObjects: any
  onSessionCreated?: (childSessionID: string) => void
  /** 当前场景已有的 type 清单（新 codegen 流；片C 从 mergedSceneConfig keys 取）。旧调用不传 */
  currentTypes?: string[]
  /** 是否已有场景（片C 传；旧调用由 lastSceneObjects.length 推断） */
  hasScene?: boolean
  /** 文件附件（图片等，传给 agent 的 prompt parts；供 triage 看图描述 attachment_description） */
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
  /** 可 patch 候选 __id 清单（host 前置从 handler 源码确定性抽取；注入 triage 供受限选择，防臆造 __id） */
  patchCandidates?: PatchCandidate[]
  /** 当前 handler 源码（hasScene 时 host 读 codeDir 全量 .ts 注入；edit_code 的 search 串须从此处照搬
   *  verbatim 含缩进、须在源码中唯一匹配，防臆造 search 匹配不上 → fallback modify 丢物体）。
   *  本地 dev 工具，token 成本可接受；改材质标量/transform/删部件等用不到源码的 op 无须看。 */
  currentHandlers?: string
  /** 当前场景级配置（hasScene 时 host 从 mergedSceneConfig 取 camera/lights/scene 注入；
   *  set_light 的 index 按 lights 数组顺序、set_camera/set_scene 的 fields 参照当前值改）。无场景时不传。 */
  currentSceneEnv?: { camera?: unknown; lights?: unknown; scene?: unknown }
  /**
   * 兜底再问模式：host 检测到 triage 把标量改动误判 modify（没吐 patchOps）且候选非空时，
   * 置 true 再问一次 —— 强制 routing=patch 并从候选清单选 __id 出 patchOps；
   * 若确实无法 patch（无匹配候选 / 结构性）则 routing=modify（不硬 patch，不崩）。
   */
  forcePatch?: boolean
}

// legacy item 类型 —— 旧 8-agent 孤儿文件（modify-scene-ai.ts）仍读 TriageResult.delete/add/modify，
// codegen 流不再产出这些（LLM 只输出 routing+types），wrapper 默认 []。Step 8 清理孤儿后可删。
export interface TriageModifyItem {
  section_id: string
  element_id: string
  action: string
}

export interface TriageDeleteItem {
  element_id: string
  action: string
}

export interface TriageAddItem {
  action: string
}

export interface TriageTypes {
  create: string[]
  modify: string[]
}

export interface TriageResult {
  routing: "create" | "modify" | "patch" | "chat"
  types: TriageTypes
  /** routing=patch 时输出；基于原场景的局部增删查改 ops（Phase A：set_instance 材质/transform） */
  patchOps: PatchOp[]
  // legacy（孤儿兼容，codegen 流恒为空数组）
  delete: TriageDeleteItem[]
  add: TriageAddItem[]
  modify: TriageModifyItem[]
  reply: string
  reason: string
  attachment_description: string | null
}

export default async function scene_3d_triage(ctx: TriageInputContext): Promise<TriageResult> {
  const { sync, modelKey, rootSession, onSessionCreated } = ctx
  const humanMessage = buildHumanMessage(ctx)
  console.log("----- 3D 场景分诊Agent开始执行 ----- ")
  const startTime = Date.now()
  const triageRes = await runChildSession({
    sync,
    modelKey,
    isRoot: true,
    onSessionCreated,
    agent: AGENT_NAME,
    client: ctx.sdk.client,
    prompt: humanMessage,
    directory: ctx.sdk.directory,
    parentSessionID: rootSession,
    schema: SCENE_TRIAGE_FORMAT.schema,
    fileParts: ctx.fileParts,
  })
  console.log("----- 3D 场景分诊Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  // 先透传 LLM 返回的错误（idle 超时 / APIError / 限流 / 超上下文），
  // 否则拿空 text 跑 extractJson → 报"did not return valid JSON"掩盖真实原因。
  if (triageRes.error) {
    logAgentParsed(triageRes.childSessionId, { error: triageRes.error })
    agentThrow(AGENT_NAME, triageRes.childSessionId, triageRes.error)
  }
  const triageJson = extractJson(triageRes.text)
  if (!triageJson) {
    logAgentParsed(triageRes.childSessionId, { error: "Failed to parse JSON", raw: triageRes.text })
    agentThrow(AGENT_NAME, triageRes.childSessionId, "Scene Triage did not return valid JSON")
  }
  const rawTypes = (triageJson.types ?? {}) as { create?: unknown; modify?: unknown }
  const returnValue: TriageResult = {
    routing: (triageJson.routing as "create" | "modify" | "patch" | "chat") ?? "create",
    types: {
      create: toStringArray(rawTypes.create),
      modify: toStringArray(rawTypes.modify),
    },
    patchOps: parsePatchOps(triageJson.patchOps),
    // codegen 流 LLM 不再输出 delete/add/modify；留空数组供孤儿 modify-scene-ai.ts 不崩
    delete: [],
    add: [],
    modify: [],
    reply: (triageJson.reply as string) ?? "",
    reason: (triageJson.reason as string) ?? "",
    attachment_description: normalizeAttachmentDesc(triageJson.attachment_description),
  }
  console.log(`[scene_3d_triage] routing=${returnValue.routing}, patchOps=${returnValue.patchOps.length} [${returnValue.patchOps.map((o) => o.op).join(",")}], create=[${returnValue.types.create.join(",")}] modify=[${returnValue.types.modify.join(",")}], reason=${returnValue.reason}`)
  logAgentParsed(triageRes.childSessionId, returnValue)
  return returnValue
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

/** 解析 transform 子字段（position/rotation/scale，rotation 存弧度）；无任何字段返 undefined */
function parseTransform(t: unknown): TransformFields | undefined {
  if (!t || typeof t !== "object") return undefined
  const r = t as Record<string, unknown>
  const tf: TransformFields = {}
  if (Array.isArray(r.position)) tf.position = r.position as number[]
  if (Array.isArray(r.rotation)) tf.rotation = r.rotation as number[]
  if (Array.isArray(r.scale)) tf.scale = r.scale as number[]
  return Object.keys(tf).length > 0 ? tf : undefined
}

/**
 * 解析 patchOps：set_instance（部件材质/transform）+ set_type_transform（整物 transform）+ skip_instance（删子实例）。
 * schema 已约束 op 形态；host 再校验目标合法性（__id ∈ 候选 / type 存在）防臆造。
 * material/transform 透传（patchHandlerOverride 做字段级 merge + type 归一；set_type_transform 改 live-data params；skip_instance 改 SUB_SKIP）。
 */
function parsePatchOps(v: unknown): PatchOp[] {
  if (!Array.isArray(v)) return []
  const out: PatchOp[] = []
  for (const o of v) {
    if (!o || typeof o !== "object") continue
    const r = o as Record<string, unknown>
    if (r.op === "set_instance") {
      if (typeof r.__id !== "string") continue
      const op: SetInstanceOp = { op: "set_instance", __id: r.__id }
      if (r.material && typeof r.material === "object") op.material = r.material as Record<string, unknown>
      const tf = parseTransform(r.transform)
      if (tf) op.transform = tf
      out.push(op)
    } else if (r.op === "set_type_transform") {
      if (typeof r.type !== "string") continue
      const tf = parseTransform(r.transform)
      if (!tf) continue // 须含至少一个 transform 字段
      const op: SetTypeTransformOp = { op: "set_type_transform", type: r.type, transform: tf }
      if (typeof r.nodeId === "string") op.nodeId = r.nodeId
      out.push(op)
    } else if (r.op === "skip_instance") {
      if (typeof r.__id !== "string") continue
      const op: SkipInstanceOp = { op: "skip_instance", __id: r.__id }
      out.push(op)
    } else if (r.op === "add_instance") {
      if (typeof r.type !== "string" || typeof r.nodeId !== "string" || typeof r.cid !== "string") continue
      if (!Array.isArray(r.position)) continue
      const op: AddInstanceOp = {
        op: "add_instance",
        type: r.type,
        nodeId: r.nodeId,
        cid: r.cid,
        position: r.position as number[],
      }
      if (Array.isArray(r.rotation)) op.rotation = r.rotation as number[]
      if (r.material && typeof r.material === "object") op.material = r.material as Record<string, unknown>
      out.push(op)
    } else if (r.op === "edit_code") {
      if (typeof r.type !== "string" || !Array.isArray(r.edits)) continue
      const edits: { search: string; replace: string }[] = []
      for (const e of r.edits) {
        if (!e || typeof e !== "object") continue
        const ee = e as Record<string, unknown>
        if (typeof ee.search !== "string" || typeof ee.replace !== "string") continue
        edits.push({ search: ee.search, replace: ee.replace })
      }
      if (edits.length === 0) continue
      const op: EditCodeOp = { op: "edit_code", type: r.type, edits }
      out.push(op)
    } else if (r.op === "set_light") {
      // 场景级改灯（M-3 ①）：index 按 lights 数组顺序，fields 含 intensity/color/position 等
      if (typeof r.index !== "number" || !r.fields || typeof r.fields !== "object") continue
      out.push({ op: "set_light", index: r.index, fields: r.fields as Record<string, unknown> } as SetLightOp)
    } else if (r.op === "set_camera") {
      // 场景级改相机（M-3 ①）：fields 含 position/lookAt/fov/type
      if (!r.fields || typeof r.fields !== "object") continue
      out.push({ op: "set_camera", fields: r.fields as Record<string, unknown> } as SetCameraOp)
    } else if (r.op === "set_scene") {
      // 场景级改环境（M-3 ①）：fields 含 background/fog/environment
      if (!r.fields || typeof r.fields !== "object") continue
      out.push({ op: "set_scene", fields: r.fields as Record<string, unknown> } as SetSceneOp)
    }
  }
  return out
}

function buildHumanMessage(ctx: TriageInputContext): string {
  const lines = [`[用户请求]: ${ctx.userInput}`, ``]
  if (ctx.forcePatch) {
    // 兜底再问：host 已判定此请求疑似标量改动（改颜色/材质标量/transform）且候选非空，
    // 强制要求 routing=patch 并从候选清单挑 __id 出 patchOps；若确实无法 patch 则 routing=modify。
    lines.push(`[强制约束]: 此请求被判定为疑似标量改动（改颜色 / 材质标量 / 位置 / 旋转 / 缩放）。`)
    lines.push(`  请优先 routing=patch 输出 patchOps：改部件材质/transform → set_instance（__id 取自下方[可 patch 候选 __id 清单]）；`)
    lines.push(`  移动/旋转/缩放整个物体（如「把台灯放地上」「机柜整体前移」）→ set_type_transform（type 取自[当前场景已有 type 分组]，单物 nodeId 可省）。`)
    lines.push(`  仅当确实无法 patch（清单中无匹配候选 / 请求实为结构性如换贴图/换主题/加删物体）时，才 routing=modify。`)
    lines.push(`  ⚠️「变成X色」「改颜色」「换颜色」= 改颜色（patch），不是换主题重建（modify）。`)
    lines.push(``)
  }
  if (ctx.hasScene === false) {
    lines.push(`[当前场景状态]: 无场景（首次生成）`)
  } else if (ctx.currentTypes && ctx.currentTypes.length > 0) {
    lines.push(`[当前场景已有 type 分组]: ${JSON.stringify(ctx.currentTypes)}`)
  } else if (ctx.lastPlanner || (ctx.lastSceneObjects && ctx.lastSceneObjects.length > 0)) {
    // 兼容旧 8-agent 调用（lastPlanner / lastSceneObjects）
    lines.push(`[当前场景布局]: ${JSON.stringify(ctx.lastPlanner)}`)
    lines.push(`[当前场景物体]: ${JSON.stringify(ctx.lastSceneObjects)}`)
  } else {
    lines.push(`[当前场景状态]: 无场景（首次生成）`)
  }
  // 可 patch 候选 __id 清单（host 从 handler 源码确定性抽取；triage 据语义匹配挑 __id，严禁臆造）
  if (ctx.patchCandidates && ctx.patchCandidates.length > 0) {
    const list = ctx.patchCandidates.map((c) => `- ${c.__id}（${c.label}，type:${c.type}）`).join("\n")
    lines.push(``)
    lines.push(`[可 patch 候选 __id 清单]（routing=patch 时，set_instance.__id 必须取自此清单，严禁臆造）:`)
    lines.push(list)
  }
  if (ctx.currentHandlers) {
    lines.push(``)
    lines.push(`[当前 handler 源码]（edit_code 的 search 串须从此处照搬，verbatim 含缩进、须在源码中唯一匹配；改材质标量/transform/删部件等用不到源码的 op 无须看）:`)
    lines.push(ctx.currentHandlers)
  }
  if (ctx.currentSceneEnv) {
    lines.push(``)
    lines.push(`[当前场景 camera/lights/scene]（set_light 的 index 按 lights 数组顺序；set_camera/set_scene 的 fields 参照当前值改，如「灯再亮一点」= 当前 intensity +0.5）:`)
    lines.push(JSON.stringify(ctx.currentSceneEnv))
  }
  return lines.join("\n")
}

function normalizeAttachmentDesc(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t === "null" || t === "无" || t === "无图片" || t === "无图像" || t === "N/A") return null
  return t
}
