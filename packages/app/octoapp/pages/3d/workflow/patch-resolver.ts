/**
 * patch-resolver —— 确定性抽取 handler 源码中所有可 patch 的子实例 __id 候选。
 *
 * 3D 子物体 __id 不在 live-data.json（只有顶层 type 节点 room-1/racks-1…），是 handler.create
 * 内部硬编码、挂在 userData.__id = cid 的。triage 看不到 → 需前置候选清单注入 triage human message
 * （像 2D 注入全量 JSON 使所有 element_id 可见），triage 再从候选集语义匹配挑 __id（schema 校验
 * __id ∈ 候选集，防臆造死 __id）。
 *
 * 抽取策略：正则扫 handler 源码所有 `${node.id}-<suffix>` 模板字面量（cid 变量赋值 /
 * userData.__id 赋值右侧）+ 同行/上一行中文注释作 label + 所在 type（文件路径 handlers/<type>/
 * <type>.ts 反查）+ 该 type 下所有根节点 id（mergedSceneConfig 反查）→ 展开具体候选。
 *
 * **确定性、不怕命名漂移**：抽所有 `-*` 字面量，不靠语义（floor-0→flr-0 仍抽出）。
 * **只抽完全字面量 cid**（suffix 后紧跟反引号 = 模板闭合）：`${node.id}-floor-0` ✓，
 * `${node.id}-rack-${i++}`（suffix `rack` 后跟 `-` 非 `` ` ``）= 循环 cid，由 gap① 循环路径处理（RE_LOOP_TMPL + resolveLoopCount 枚举，见下）。
 * **跳过 SUB_OVERRIDES/SUB_SKIP/SUB_ADD 声明块**：块内字面量是 patch 数据非实例创建点，误抽会喂 triage 假候选。
 */
import type { CodeFile } from "../utils/parse-code-files"

export interface PatchCandidate {
  /** 子实例 __id（如 "room-1-floor-0"） */
  __id: string
  /** 人类可读标签（中文注释 / suffix），供 triage 语义匹配 */
  label: string
  /** 所属顶层 type（如 "room"），反查自 mergedSceneConfig */
  type: string
  /** 所属根节点 id（如 "room-1"），__id 的前缀 */
  nodeId: string
}

/** 保留 key（不入 type 清单），与 codegen-scene RESERVED_TYPES 一致 */
const RESERVED_TYPES = new Set(["version", "scene", "camera", "lights", "remove"])

/** 从 mergedSceneConfig 取所有顶层节点 [{type, nodeId}]（剔除保留 key） */
function topNodes(merged: Record<string, unknown>): { type: string; nodeId: string }[] {
  const out: { type: string; nodeId: string }[] = []
  for (const [type, raw] of Object.entries(merged)) {
    if (RESERVED_TYPES.has(type) || !Array.isArray(raw)) continue
    for (const node of raw) {
      const id = (node as { id?: unknown })?.id
      if (typeof id === "string") out.push({ type, nodeId: id })
    }
  }
  return out
}

/** 从文件路径 handlers/<type>/<type>.ts 取 type */
function typeFromPath(path: string): string | null {
  const m = path.replace(/\\/g, "/").match(/handlers\/([^/]+)\/\1\.ts$/)
  return m ? m[1] : null
}

/** 取上一行/同行的中文注释作 label（// 后到行尾，trim，须含中文） */
function extractLabel(lines: string[], i: number): string {
  const cur = lines[i]?.match(/\/\/\s*(.+)$/)?.[1]?.trim()
  if (cur && /[一-龥]/.test(cur)) return cur
  const prev = lines[i - 1]?.match(/\/\/\s*(.+)$/)?.[1]?.trim()
  if (prev && /[一-龥]/.test(prev)) return prev
  return ""
}

/**
 * 抽取所有完全字面量 cid 候选。
 *
 * 主路径：`${node.id}-<suffix>` 模板，suffix = 数字段 + 短杠分隔（每段非空 alphanumeric），
 * 且 suffix 后**紧跟反引号**（模板闭合）；suffix 后跟 `-`/`${` 等 = 循环/部分 cid（如 rack-${i++}），跳过。
 * 该 type 下每个根节点都展开一个候选（handler 模板里 ${node.id} 运行时 = 各根节点 id）。
 *
 * gap① 循环路径：${node.id}-<suffix>-${<loopVar>} 模板 → resolveLoopCount 反推循环上界
 * （字面量 N 或命名数组 .length）→ 枚举 nodeId-<suffix>-0..-(count-1) 并入候选，
 * 供 set_instance/skip 改/删循环单实例（edit_code 改循环字面量=全变，够不着单个）。
 *
 * 辅助路径：已展开的字符串字面量 "nodeId-suffix"（cid 硬编码场景），按 nodeId 前缀匹配。
 * **跳过 SUB_OVERRIDES/SUB_SKIP/SUB_ADD 声明块**（patch 数据非实例创建点，误抽喂 triage 假候选）。
 */
export function extractPatchCandidates(
  codeDirFiles: CodeFile[],
  merged: Record<string, unknown>,
): PatchCandidate[] {
  const nodes = topNodes(merged)
  if (nodes.length === 0) return []
  const nodesByType = new Map<string, { nodeId: string }[]>()
  for (const n of nodes) {
    const arr = nodesByType.get(n.type) ?? []
    arr.push({ nodeId: n.nodeId })
    nodesByType.set(n.type, arr)
  }

  const out: PatchCandidate[] = []
  const seen = new Set<string>()

  // 模板片段：${node.id}-<suffix>` —— suffix 后**紧跟反引号**（模板闭合）才是完整字面量 cid；
  // suffix 后跟 - 或 ${ 等非反引号 = 循环/部分 cid（如 `${node.id}-rack-${i++}`），不匹配。
  // suffix 段：[A-Za-z0-9]+（-[A-Za-z0-9]+）*，捕获组 1 = suffix
  const RE_TMPL = /\$\{node\.id\}-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)`/g
  // gap① 循环 cid 模板：${node.id}-<suffix>-${<loopVar>}` —— suffix 后跟 -${loopVar} = 循环实例 cid
  // 捕获组 1 = suffix，捕获组 2 = loopVar（循环变量名，供 resolveLoopCount 反推上界）
  const RE_LOOP_TMPL = /\$\{node\.id\}-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-\$\{(\w+)\}`/g
  // gap① 前置：const 命名纯数字数组 → name + 元素数（for (i<ARR.length) 循环上界反推 count 用）
  const RE_NUM_ARR = /const\s+(\w+)\s*(?::\s*[^=]+?)?\s*=\s*\[([^\]]+)\]/g
  // 字符串字面量："nodeId-suffix" / '...' / `...`（已展开）
  const RE_STR = /["'`]([A-Za-z0-9][A-Za-z0-9-]*?)["'`]/g

  for (const f of codeDirFiles) {
    if (!f.path.endsWith(".ts")) continue
    const type = typeFromPath(f.path)
    if (!type) continue
    const typeNodes = nodesByType.get(type)
    if (!typeNodes || typeNodes.length === 0) continue

    const src = f.content
    const lines = src.split("\n")

    // gap① 前置：抽 const 命名纯数字数组名→长度（for (i<ARR.length) 循环上界反推 count 用）
    const arrLens = new Map<string, number>()
    let mA: RegExpExecArray | null
    RE_NUM_ARR.lastIndex = 0
    while ((mA = RE_NUM_ARR.exec(src)) !== null) {
      const name = mA[1]
      const vals = mA[2].split(",").map((s) => s.trim()).filter((s) => s !== "" && !Number.isNaN(Number(s)))
      if (vals.length >= 2) arrLens.set(name, vals.length)
    }

    // SUB_OVERRIDES/SUB_SKIP/SUB_ADD 声明块 = patch 数据（host 写入的 override/skip/add 条目），
    // 非实例创建点。块内字面量（如 SUB_ADD 里的 "cid": "racks-1-rack-2"）会被 RE_STR 误抽成候选 →
    // triage 拿假候选出 skip op → 删错物体。故跳过整块（声明行到闭合 ]; / };）。
    let inPatchData = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^const\s+SUB_(?:OVERRIDES|SKIP|ADD)\b/.test(line)) {
        inPatchData = true
      }
      if (inPatchData) {
        if (/[}\]]\s*;\s*$/.test(line)) inPatchData = false
        continue
      }
      const label = extractLabel(lines, i)

      // 模板片段（suffix 后紧跟反引号 = 完整字面量；循环 cid rack-${i} 的 suffix 后是 -/$ 不匹配）
      let m: RegExpExecArray | null
      RE_TMPL.lastIndex = 0
      while ((m = RE_TMPL.exec(line)) !== null) {
        const suffix = m[1]
        for (const n of typeNodes) {
          const __id = `${n.nodeId}-${suffix}`
          if (!seen.has(__id)) {
            seen.add(__id)
            out.push({ __id, label: label || suffix, type, nodeId: n.nodeId })
          }
        }
      }

      // gap① 循环 cid 模板：${node.id}-<suffix>-${<loopVar>} → resolveLoopCount 反推上界 → 枚举循环单实例
      RE_LOOP_TMPL.lastIndex = 0
      while ((m = RE_LOOP_TMPL.exec(line)) !== null) {
        const suffix = m[1]
        const loopVar = m[2]
        const count = resolveLoopCount(src, loopVar, arrLens)
        if (count > 0) {
          for (const n of typeNodes) {
            for (let k = 0; k < count; k += 1) {
              const __id = `${n.nodeId}-${suffix}-${k}`
              if (!seen.has(__id)) {
                seen.add(__id)
                out.push({ __id, label: label || `${suffix}-${k}`, type, nodeId: n.nodeId })
              }
            }
          }
        }
      }

      // 字符串字面量（已展开，按该 type 下 nodeId 前缀匹配）
      RE_STR.lastIndex = 0
      while ((m = RE_STR.exec(line)) !== null) {
        const cand = m[1]
        for (const n of typeNodes) {
          const prefix = n.nodeId + "-"
          if (cand.startsWith(prefix)) {
            const __id = cand
            if (!seen.has(__id)) {
              seen.add(__id)
              out.push({ __id, label: label || cand.slice(prefix.length), type, nodeId: n.nodeId })
            }
          }
        }
      }
    }
  }
  return out
}

/**
 * gap①：反推循环单实例 cid 的循环上界 count（枚举 rack-0..rack-(count-1) 用）。
 *
 * 识别两种 for 循环上界（loopVar = 循环变量名，取自 RE_LOOP_TMPL 捕获组 2）：
 *  (a) 字面量上界 `for (let <v>=0; <v> < N; ...)` → count = N
 *  (b) 数组长度上界 `for (let <v>=0; <v> < <arr>.length; ...)` → count = arrLens[arr]（前置已抽）
 * 假设 0 起始、`< <bound>`（codegen Constraint 标准形态）；非此形态 / count≤0 → 返 0（不枚举，
 * set_instance/skip 循环单实例 __id 不进候选 → fallback modify，不崩）。
 */
function resolveLoopCount(
  src: string,
  loopVar: string,
  arrLens: Map<string, number>,
): number {
  // (a) 字面量上界：for (let i=0; i < 5; i++) —— 上界为数字字面量
  const reLit = new RegExp(
    `for\\s*\\(\\s*(?:let|var)\\s+${loopVar}\\s*=\\s*-?\\d+\\s*;\\s*${loopVar}\\s*<\\s*(\\d+)`,
  )
  const mLit = reLit.exec(src)
  if (mLit) {
    const n = Number(mLit[1])
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  // (b) 数组长度上界：for (let i=0; i < arr.length; i++) —— 上界为命名数组 .length
  const reArr = new RegExp(
    `for\\s*\\(\\s*(?:let|var)\\s+${loopVar}\\s*=\\s*-?\\d+\\s*;\\s*${loopVar}\\s*<\\s*(\\w+)\\.length`,
  )
  const mArr = reArr.exec(src)
  if (mArr) {
    const len = arrLens.get(mArr[1])
    return typeof len === "number" ? len : 0
  }
  return 0
}

/**
 * 轻量门：用户请求是否疑似「标量改动」（改颜色/材质标量/transform）。
 *
 * 仅作 codegen_scene 的兜底再问触发器 —— triage 把标量改动误判 modify（没吐 patchOps）时，
 * 若此门为 true 且有候选 → 约束再问 triage force-patch（让 LLM 从候选选 __id 出 patchOps）。
 *
 * 宽网即可：误报只会多一次再问（再问时 LLM 找不到候选会正确落 modify，不崩）；
 * 漏报才危险（标量改动漏掉 → 重建），故关键词宁宽勿窄。纹理/加物体/删物体等结构性词不在此列。
 */
const SCALAR_RE =
  /(颜色|红色|蓝色|绿色|黄色|黑色|白色|紫色|粉色|橙色|灰色|青色|棕色|银色|金色|变红|变蓝|变绿|变黄|变黑|变白|变紫|变粉|变橙|变灰|变青|变棕|漆成|涂成|色的|色$|材质|粗糙|金属|透明|发光|线框|哑光|磨砂|反光|高光|移动|前移|后移|左移|右移|平移|上移|下移|上升|升高|下降|降低|挪|移到|移至|旋转|转动|翻转|朝向|放大|缩小|缩放|变大|变小|变高|变矮|变宽|变窄|变长|加长|缩短|位置|高度|宽度|长度|尺寸|大小)/

export function looksLikeScalarChange(userInput: string): boolean {
  return SCALAR_RE.test(userInput)
}
