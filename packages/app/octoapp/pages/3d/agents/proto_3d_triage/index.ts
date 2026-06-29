import { extractJson } from '../../utils/json_parser'
import { runChildSession } from '../run_child_session'

const AGENT_NAME = "proto_3d_triage"
/** 输出不合格(用了自然语言 modify)时回炉重试次数 */
const MAX_RETRIES = 1

/** 原地属性修改操作:对 target 列出的物体,设置 field(点分路径)= value */
export type Triage3DSetOp = { target: string[]; field: string; value: unknown }

export type Triage3DAddItem = {
  section_id: string
  parent_id: string
  id_prefix: string
  detail: string
}

export type Triage3DResult = {
  routing: "regenerate" | "modify"
  set: Triage3DSetOp[]
  delete: string[]
  add: Triage3DAddItem[]
  reason: string
}

type Proto3DTriageInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  lastPlanner: any
  lastObjects: any
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 校验 LLM 输出是否合格:regenerate 合格;否则不允许有「自然语言 modify」(action 字段)。
 * 结构化 modify(带 field/value)算合格(parseModifyToSet 会转成 set)。
 */
function isOutputValid(raw: any): boolean {
  if (raw?.routing === "regenerate") return true
  const modify = Array.isArray(raw?.modify) ? raw.modify : []
  const hasNLAction = modify.some((m: any) => m.field === undefined && m.action != null)
  return !hasNLAction
}

/**
 * 兜底:把 LLM 旧式 modify[{object_id, action}] 解析成结构化 set。
 * 覆盖:parentId、vec3 变换、单轴变换、颜色(末色=目标)、发光色、透明度/粗糙度/金属度/发光强度、可见性。
 * 各属性独立判断(一个 action 可产出多条 set)。
 */
function parseModifyToSet(items: any[]): Triage3DSetOp[] {
  const ops: Triage3DSetOp[] = []
  for (const m of items ?? []) {
    const id = m.object_id ?? m.id
    if (!id) continue
    if (m.field !== undefined && m.value !== undefined) {
      ops.push({ target: Array.isArray(m.target) ? m.target : [id], field: String(m.field), value: m.value })
      continue
    }
    const action = String(m.action ?? "")
    if (!action) continue

    const v3 = action.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/)
    const vec3 = v3 ? [Number(v3[1]), Number(v3[2]), Number(v3[3])] : null
    const colorMatches = action.match(/#[0-9A-Fa-f]{6}\b/g)
    const color = colorMatches && colorMatches.length > 0 ? colorMatches[colorMatches.length - 1] : null
    const numM = action.match(/(?:^|[^\w#[.\]])(-?\d+(?:\.\d+)?)(?:度|°|m|米|%)?(?![\w.])/)
    const num = numM ? Number(numM[1]) : null
    const has = (re: RegExp) => re.test(action)

    // parentId(层级)
    const parentM = action.match(/(?:parentId|父(?:节点|级|组)?|parent|挂到|脱离到|移至)\s*(?:从\s*["']?[\w]+["']?\s*)?(?:改为|改成|变为|调(?:整)?到|到|至)?\s*["']?([A-Za-z_][\w]*(?:[Gg]roup|Root|根)?)/)
    if (parentM && has(/parentId|父|parent|挂到|脱离|组/)) {
      ops.push({ target: [id], field: "parentId", value: parentM[1] })
    }
    // vec3 变换
    if (vec3 && has(/位置|移动|挪|移|坐标|position|pos\b/i)) ops.push({ target: [id], field: "position", value: vec3 })
    if (vec3 && has(/旋转|转动|朝向|rotate|rotation|角度/i)) ops.push({ target: [id], field: "rotation", value: vec3 })
    if (vec3 && has(/缩放|尺寸|大小|比例|scale|size/i)) ops.push({ target: [id], field: "scale", value: vec3 })
    else if (num !== null && has(/缩放|尺寸|大小|比例|scale|size/i)) ops.push({ target: [id], field: "scale", value: num })
    // 单轴变换:"position.y 改成 15.2" / "y 上移到 16"
    const axisM = action.match(/(position|rotation|scale|位置|旋转|缩放)?\.?\s*([xyz])\s*(?:从\s*-?[\d.]+\s*)?(?:改成|改为|变成|调整为|上移到|下移到|移到|移至|调到|至|为|=)\s*(-?[\d.]+)/)
    if (axisM) {
      const val = Number(axisM[3])
      let f = "position"
      if (/旋转|rotation|角度/i.test(axisM[1] ?? "")) f = "rotation"
      else if (/缩放|scale/i.test(axisM[1] ?? "")) f = "scale"
      ops.push({ target: [id], field: `${f}.${axisM[2]}`, value: val })
    }
    // 颜色类
    if (color && has(/发光色|emissive|自发光/i)) ops.push({ target: [id], field: "material.emissive", value: color })
    else if (color && has(/色|颜色|color|材质|material/i)) ops.push({ target: [id], field: "material.color", value: color })
    // 数值材质属性
    if (num !== null && has(/透明|opacity|transparent/i)) {
      ops.push({ target: [id], field: "material.opacity", value: num })
      if (num < 1) ops.push({ target: [id], field: "material.transparent", value: true })
    }
    if (num !== null && has(/粗糙|roughness/i)) ops.push({ target: [id], field: "material.roughness", value: num })
    if (num !== null && has(/金属|metalness/i)) ops.push({ target: [id], field: "material.metalness", value: num })
    if (num !== null && has(/发光强度|emissive.*intensity|亮度|intensity/i)) ops.push({ target: [id], field: "material.emissiveIntensity", value: num })
    // 可见性
    if (has(/隐藏|不可见|hide|invisible/i)) ops.push({ target: [id], field: "visible", value: false })
    else if (has(/显示|可见|show/i)) ops.push({ target: [id], field: "visible", value: true })
  }
  return ops
}

/**
 * 修改分诊 Agent(B 路线:强制结构化 set)。
 * 流程:分诊 → 校验 → 若用了自然语言 modify,带 feedback 回炉重试 → 仍不完美则 parseModifyToSet 兜底。
 */
export default async function proto_3d_triage(ctx: Proto3DTriageInput): Promise<Triage3DResult> {
  const { sdk, sync, modelKey, rootSession, userInput, lastPlanner, lastObjects, onSessionCreated } = ctx

  let feedback = ""
  let raw: any = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const humanMessage = buildHumanMessage(userInput, lastPlanner, lastObjects, feedback)
    console.log(`----- [3D] 分诊Agent执行 (attempt ${attempt + 1}/${MAX_RETRIES + 1}) -----`)
    const startTime = Date.now()
    const triageRes = await runChildSession({
      sync,
      modelKey,
      isRoot: true,
      onSessionCreated,
      agent: AGENT_NAME,
      client: sdk.client,
      prompt: humanMessage,
      directory: sdk.directory,
      parentSessionID: rootSession,
    })
    console.log("----- [3D] 分诊Agent结束,耗时:", (Date.now() - startTime) / 1000, "s -----")

    raw = extractJson(triageRes)
    if (!raw) {
      if (attempt < MAX_RETRIES) {
        feedback = "上次未返回合法 JSON,请重新输出纯 JSON。"
        continue
      }
      throw new Error("----- [3D] Triage did not return valid JSON -----")
    }
    console.log("[3D triage] raw LLM output:", JSON.stringify(raw, null, 2).slice(0, 3000))

    if (isOutputValid(raw)) {
      if (attempt > 0) console.log("[3D triage] 回炉后输出合格 ✓")
      break
    }
    // 不合格:用了自然语言 modify → 回炉
    console.log("[3D triage] 输出不合格(用了自然语言 modify,未用 set),回炉重试...")
    feedback = `你上次的输出使用了 modify + 自然语言 action(如 {"object_id":"x","action":"把颜色改成红色(#FF0000)"}),这是禁止的格式。属性修改必须放进 set 数组,每项结构化 {"target":["物体id"], "field":"字段路径", "value":值}。例如:改色 field:"material.color" value:"#FF0000";改位置 field:"position" value:[x,y,z];单轴 field:"position.y" value:15.2;改发光强度 field:"material.emissiveIntensity" value:2。请严格按输出格式重新输出,不要 modify 字段,不要自然语言 action。`
  }

  // 兼容字段名 + 兜底解析(回炉后仍残留的 modify)
  const rawSet = (raw.set ?? raw.changes ?? raw.updates ?? raw.modifications ?? []) as any[]
  const rawModify = (raw.modify ?? []) as any[]
  return {
    routing: (raw.routing as "regenerate" | "modify") ?? "modify",
    set: [...rawSet, ...parseModifyToSet(rawModify)] as Triage3DSetOp[],
    delete: (raw.delete ?? raw.remove ?? []) as string[],
    add: (raw.add ?? raw.create ?? raw.new ?? []) as Triage3DAddItem[],
    reason: (raw.reason as string) ?? "",
  }
}

function buildHumanMessage(userInput: string, lastPlanner: any, lastObjects: any, feedback = ""): string {
  const lines = [
    `[用户修改请求]: ${userInput}`,
    ``,
    `[当前场景的舞台规划(scene/camera/lights/groups)]: ${JSON.stringify(lastPlanner)}`,
    ``,
    `[当前场景的所有物体(objects)]: ${JSON.stringify(lastObjects)}`,
    ``,
  ]
  if (feedback) {
    lines.push(`[校验反馈 —— 上次输出不合格,必须修正]: ${feedback}`, ``)
  }
  lines.push(`请进行修改分诊。严格遵守「保守优先,原地修改」:属性修改必须用 set 结构化(target/field/value),新增用 add。严格按输出格式返回纯 JSON,绝不输出 modify 字段或自然语言 action。`)
  return lines.join("\n")
}
