/**
 * patch-handler —— 编辑态 per-instance 材质/transform 落盘的确定性 patch 工具（无 LLM）。
 *
 * 契约前提：handler 合 HANDLER_CONTRACT 规则 6 —— 顶部含
 *   const SUB_OVERRIDES: Record<string, OverrideSpec> = { ... }
 * 且 { ... } 内容是合法 JSON（双引号 key、color "#rrggbb" 字符串、无注释、无 trailing comma）。
 * 本工具用 JSON.parse / JSON.stringify 读写该对象字面量，不引入 typescript compiler。
 *
 * 落盘链路：编辑态改子实例材质/transform → 累积进 editDelta → 提交 → commit-edits 反查 __id 所属 type
 * → 读该 type 的 handler 源码 → 调 patchHandlerOverride 把 material/transform 合进 SUB_OVERRIDES → 重组
 * codeFiles → onCodeVersionReady 物化（重生成）。导出即代码终态，无烘焙。
 */

/** 3d-components MaterialType 合法值（与 createMaterial 工厂 5 类一致）。
 * override Map 的 material.type 仅为满足 MaterialConfig 类型注解（applySyncProps 不读 type，
 * 运行时材质类由 handler 的 new THREE.XxxMaterial(...) 决定、override 不重建）。
 * 非 5 类的归一 type（toon/points/undefined）→ 归一为 "standard"，保证 patched 字面量过 vue-tsc。 */
const MATERIAL_TYPES = new Set(["standard", "basic", "physical", "phong", "lambert"])

/**
 * handler 文件路径（type → workspace 相对路径）。
 * codegen 写 `handlers/<type>/<type>.ts`，host 读 codeDir 时 path 与此一致。
 */
export const handlerFilePathForType = (type: string): string =>
  `src/3d/managers/component/handlers/${type}/${type}.ts`

/**
 * __id → 顶层 type 反查：在 mergedSceneConfig 各 type 分组里找根前缀命中的 type。
 *
 * 匹配：`__id === node.id` 或 `__id.startsWith(node.id + "-")`；多个命中取最长 node.id
 * （最具体前缀优先，处理 `hm` / `hm-1` 同前缀歧义）。子实例 __id（如 `server-room-1-rack-0-3`）
 * 不在分组 id 里，靠其根节点前缀反推。
 *
 * 返回 null = __id 不属任何顶层节点（引擎兜底 `part-N` 格式或硬编码前缀），无法落盘。
 */
export const resolveTypeId = (
  mergedSceneConfig: Record<string, unknown>,
  __id: string,
): string | null => {
  let bestType: string | null = null
  let bestLen = -1
  for (const [type, raw] of Object.entries(mergedSceneConfig)) {
    if (!Array.isArray(raw)) continue
    for (const node of raw) {
      const id = (node as { id?: unknown })?.id
      if (typeof id !== "string") continue
      const hit = __id === id || __id.startsWith(`${id}-`)
      if (hit && id.length > bestLen) {
        bestType = type
        bestLen = id.length
      }
    }
  }
  return bestType
}

/** 定位 SUB_OVERRIDES 对象字面量的字符范围 [start, end]（含外层花括号）。不合契约 → 抛错。 */
const locateOverridesLiteral = (source: string): { start: number; end: number } => {
  const decl = source.match(/const\s+SUB_OVERRIDES\b/)
  if (!decl || decl.index === undefined) {
    throw new Error(
      "patch-handler: handler 未含 `const SUB_OVERRIDES` override Map 骨架——需重新生成该 type（合 HANDLER_CONTRACT 规则 6）",
    )
  }
  const len = source.length
  let i = decl.index + decl[0].length
  // 跳到 '='
  while (i < len && source.charAt(i) !== "=") i++
  if (i >= len) throw new Error("patch-handler: SUB_OVERRIDES 声明缺 '='")
  i += 1 // 跳过 '='
  // 跳过空白（契约要求 = 后直接 {，禁止函数包装 / 间接赋值）
  while (i < len && /\s/.test(source.charAt(i))) i += 1
  if (source.charAt(i) !== "{") {
    throw new Error(
      "patch-handler: SUB_OVERRIDES 必须直接赋对象字面量 { ... }（契约禁止函数包装 / 间接赋值）",
    )
  }
  const open = i // '{' 位置
  // 括号配对：尊重字符串字面量，避免字符串里的 } 误判结束
  let depth = 0
  let j = open
  let inStr: '"' | "'" | "`" | null = null
  while (j < len) {
    const ch = source.charAt(j)
    if (inStr) {
      if (ch === "\\") {
        j += 2
        continue
      }
      if (ch === inStr) inStr = null
      j += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch
      j += 1
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) break
    }
    j += 1
  }
  if (depth !== 0) throw new Error("patch-handler: SUB_OVERRIDES 对象字面量花括号不配对")
  return { start: open, end: j } // [start, end] 含外层 { }
}

/** 一份 per-instance 改动（镜像 3d-templete OverrideSpec；rotation 存弧度） */
type OverrideEntry = {
  material?: Record<string, unknown>
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] }
}

/**
 * 把一份 per-instance 材质/transform merge 进 handler 源码的 `SUB_OVERRIDES[__id]`。
 *
 * - material：字段级 merge（保留未覆盖字段，不丢既有项）；缺 type 补 "standard"
 *   （applySyncProps 不读 type，落盘材质类型不可变更；补默认仅为满足 MaterialConfig 类型注解使 handler 过 vue-tsc，安全）。
 * - transform：position/rotation/scale 各子字段级 merge（保留未覆盖子字段）；rotation 存弧度（Three 原生，applyOverride 直接 set）。
 * - 新 __id：增项。
 *
 * 前提：source 合契约（含 SUB_OVERRIDES 骨架且内容合法 JSON）。否则抛错，调用方提示重新生成。
 */
export const patchHandlerOverride = (
  source: string,
  __id: string,
  entry: OverrideEntry,
): string => {
  const { start, end } = locateOverridesLiteral(source)
  const inner = source.slice(start, end + 1) // 含 { }
  let parsed: Record<string, OverrideEntry>
  try {
    parsed = JSON.parse(inner) as Record<string, OverrideEntry>
  } catch (e) {
    throw new Error(
      `patch-handler: SUB_OVERRIDES 内容非合法 JSON（契约要求双引号 key、color "#rrggbb" 字符串、无注释、无 trailing comma）——${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const prev = parsed[__id] ?? {}
  const next: OverrideEntry = { ...prev }
  // material 字段级 merge + type 归一（type 须是 MaterialType 合法值，否则 patched 字面量过不了 vue-tsc；
  // 非 5 类 toon/points/undefined → "standard"，applySyncProps 不读 type、运行时材质类不变，安全）
  if (entry.material) {
    const prevMat = (prev.material ?? {}) as Record<string, unknown>
    const nextMat: Record<string, unknown> = { ...prevMat, ...entry.material }
    if (typeof nextMat.type !== "string" || !MATERIAL_TYPES.has(nextMat.type)) {
      nextMat.type = "standard"
    }
    next.material = nextMat
  }
  // transform 子字段级 merge（rotation 存弧度，原样落盘 SUB_OVERRIDES）
  if (entry.transform) {
    const prevTf = (prev.transform ?? {}) as NonNullable<OverrideEntry["transform"]>
    const nextTf: NonNullable<OverrideEntry["transform"]> = { ...prevTf }
    if (entry.transform.position) nextTf.position = entry.transform.position
    if (entry.transform.rotation) nextTf.rotation = entry.transform.rotation
    if (entry.transform.scale) nextTf.scale = entry.transform.scale
    next.transform = nextTf
  }
  parsed[__id] = next
  const newInner = JSON.stringify(parsed, null, 2)
  return source.slice(0, start) + newInner + source.slice(end + 1)
}

/** 定位 SUB_SKIP 数组字面量的字符范围 [start, end]（含外层方括号）。不合契约 → 抛错。
 *  克隆 locateOverridesLiteral 的括号配对逻辑（尊重字符串字面量），改：定位 `const SUB_SKIP`、
 *  期望 `[` 起头、按 `[`/`]` 配对（SUB_SKIP 是 string[]，元素皆字符串，方括号无嵌套对象）。 */
const locateSkipLiteral = (source: string): { start: number; end: number } => {
  const decl = source.match(/const\s+SUB_SKIP\b/)
  if (!decl || decl.index === undefined) {
    throw new Error(
      "patch-handler: handler 未含 `const SUB_SKIP` 删除集合骨架——需重新生成该 type（合 HANDLER_CONTRACT 规则 7）",
    )
  }
  const len = source.length
  let i = decl.index + decl[0].length
  // 跳到 '='（跳过 `: string[]` 类型注解里的字符）
  while (i < len && source.charAt(i) !== "=") i += 1
  if (i >= len) throw new Error("patch-handler: SUB_SKIP 声明缺 '='")
  i += 1 // 跳过 '='
  // 跳过空白（契约要求 = 后直接 [，禁止函数包装 / 间接赋值）
  while (i < len && /\s/.test(source.charAt(i))) i += 1
  if (source.charAt(i) !== "[") {
    throw new Error(
      "patch-handler: SUB_SKIP 必须直接赋数组字面量 [ ... ]（契约禁止函数包装 / 间接赋值）",
    )
  }
  const open = i // '[' 位置
  // 括号配对：尊重字符串字面量，避免字符串里的 ] 误判结束
  let depth = 0
  let j = open
  let inStr: '"' | "'" | "`" | null = null
  while (j < len) {
    const ch = source.charAt(j)
    if (inStr) {
      if (ch === "\\") {
        j += 2
        continue
      }
      if (ch === inStr) inStr = null
      j += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch
      j += 1
      continue
    }
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) break
    }
    j += 1
  }
  if (depth !== 0) throw new Error("patch-handler: SUB_SKIP 数组字面量方括号不配对")
  return { start: open, end: j } // [start, end] 含外层 [ ]
}

/**
 * 把一个 cid 加进 / 移出 handler 源码的 `SUB_SKIP` 删除集合（Phase B skip_instance 落盘）。
 *
 * - mode="add"：cid 不在集合则 push（幂等，重复加不重复入）。
 * - mode="remove"：cid 在集合则过滤掉（撤回删除）。
 *
 * 运行时契约（HANDLER_CONTRACT 规则 7）：handler 每个 cid 创建点含
 *   `if (SUB_SKIP.includes(cid)) continue`
 * 故 SUB_SKIP 列入 cid → 该实例创建时跳过 = 删除。索引语义稳定（i++ 留在 cid 内、跳过占索引不重编号），
 * 后续删第 N 个仍命中同一 cid（不漂移）。
 *
 * 前提：source 含 SUB_SKIP 骨架（locateSkipLiteral）且内容合法 JSON 数组（字符串元素）。
 * 缺骨架 → 抛错，调用方判 hasSkipSkeleton=false 走 codegen 升级 fallback。
 */
export const patchHandlerSkip = (
  source: string,
  __id: string,
  mode: "add" | "remove",
): string => {
  const { start, end } = locateSkipLiteral(source)
  const inner = source.slice(start, end + 1) // 含 [ ]
  let arr: string[]
  try {
    arr = JSON.parse(inner)
  } catch (e) {
    throw new Error(
      `patch-handler: SUB_SKIP 内容非合法 JSON 数组（契约要求双引号字符串元素、无注释、无 trailing comma）——${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (mode === "add") {
    if (!arr.includes(__id)) arr = [...arr, __id]
  } else {
    arr = arr.filter((c) => c !== __id)
  }
  const newInner = JSON.stringify(arr, null, 2)
  return source.slice(0, start) + newInner + source.slice(end + 1)
}

/**
 * 判 handler 是否含 SUB_SKIP 删除骨架（Phase B skip_instance 能否 data-patch 的前提）。
 *
 * 合骨架 = 同时含：
 *  (a) `const SUB_SKIP` 声明（locateSkipLiteral 能定位）；
 *  (b) 至少一处 `SUB_SKIP.includes(` 调用（每 cid 创建点的跳过检查）。
 * 缺任一 → false：该 type 走 codegen 升级 fallback（首次升级后新生成 handler 含骨架，后续删都是 data-patch）。
 */
export const hasSkipSkeleton = (source: string): boolean => {
  if (!/const\s+SUB_SKIP\b/.test(source)) return false
  if (!/SUB_SKIP\.includes\s*\(/.test(source)) return false
  return true
}

/** Phase C add_instance 的单条新增条目（SUB_ADD 数组元素）。
 *  cid 须 `${nodeId}-` 起头（host 反查 type 靠前缀）；position 必填（新实例放哪由 triage 推断）；
 *  rotation 存弧度；material 为标量字段（color "#rrggbb" 字符串，落盘 JSON 兼容）。 */
type AddEntry = {
  cid: string
  position: number[]
  rotation?: number[]
  material?: Record<string, unknown>
}

/** 定位 SUB_ADD 数组字面量的字符范围 [start, end]（含外层方括号）。不合契约 → 抛错。
 *  克隆 locateSkipLiteral 的括号配对逻辑（track [] depth、尊重字符串字面量）——SUB_ADD 元素虽是
 *  对象 {}，但 {} 不影响 [] depth、position/rotation 子数组合法闭合，故同 skip 的 [] 配对即可定位外层 ]。 */
const locateAddLiteral = (source: string): { start: number; end: number } => {
  const decl = source.match(/const\s+SUB_ADD\b/)
  if (!decl || decl.index === undefined) {
    throw new Error(
      "patch-handler: handler 未含 `const SUB_ADD` 加子物集合骨架——需重新生成该 type（合 HANDLER_CONTRACT 规则 8）",
    )
  }
  const len = source.length
  let i = decl.index + decl[0].length
  // 跳到 '='（跳过 `: Array<...>` 类型注解里的字符）
  while (i < len && source.charAt(i) !== "=") i += 1
  if (i >= len) throw new Error("patch-handler: SUB_ADD 声明缺 '='")
  i += 1 // 跳过 '='
  // 跳过空白（契约要求 = 后直接 [，禁止函数包装 / 间接赋值）
  while (i < len && /\s/.test(source.charAt(i))) i += 1
  if (source.charAt(i) !== "[") {
    throw new Error(
      "patch-handler: SUB_ADD 必须直接赋数组字面量 [ ... ]（契约禁止函数包装 / 间接赋值）",
    )
  }
  const open = i // '[' 位置
  // 括号配对：尊重字符串字面量，避免字符串里的 ] 误判结束
  let depth = 0
  let j = open
  let inStr: '"' | "'" | "`" | null = null
  while (j < len) {
    const ch = source.charAt(j)
    if (inStr) {
      if (ch === "\\") {
        j += 2
        continue
      }
      if (ch === inStr) inStr = null
      j += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch
      j += 1
      continue
    }
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) break
    }
    j += 1
  }
  if (depth !== 0) throw new Error("patch-handler: SUB_ADD 数组字面量方括号不配对")
  return { start: open, end: j } // [start, end] 含外层 [ ]
}

/**
 * 把一条新增条目 merge 进 handler 源码的 `SUB_ADD` 数组（Phase C add_instance 落盘）。
 *
 * - 同 cid 已存在 → 替换（更新 position/rotation/material，幂等，重试不重复 push）。
 * - 不存在 → push 增项。
 *
 * 运行时契约（HANDLER_CONTRACT 规则 8）：handler 主循环**后**含
 *   `for (const add of SUB_ADD) { 创建单实例 + 盖 __id=add.cid + applyOverride + group.add }`
 * 故 SUB_ADD 列条目 → 运行时后置遍历补创建 = 加子物。
 *
 * 前提：source 含 SUB_ADD 骨架（locateAddLiteral）且内容合法 JSON 数组（对象元素）。缺骨架 → 抛错，
 * 调用方判 hasAddSkeleton=false 走 codegen 升级 fallback。
 */
export const patchHandlerAdd = (source: string, entry: AddEntry): string => {
  const { start, end } = locateAddLiteral(source)
  const inner = source.slice(start, end + 1) // 含 [ ]
  let arr: AddEntry[]
  try {
    arr = JSON.parse(inner)
  } catch (e) {
    throw new Error(
      `patch-handler: SUB_ADD 内容非合法 JSON 数组（契约要求双引号 key、color "#rrggbb" 字符串、无注释、无 trailing comma）——${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const idx = arr.findIndex((e) => e.cid === entry.cid)
  if (idx >= 0) arr[idx] = entry
  else arr = [...arr, entry]
  const newInner = JSON.stringify(arr, null, 2)
  return source.slice(0, start) + newInner + source.slice(end + 1)
}

/**
 * 判 handler 是否含 SUB_ADD 加子物骨架（Phase C add_instance 能否 data-patch 的前提）。
 *
 * 合骨架 = 同时含：
 *  (a) `const SUB_ADD` 声明（locateAddLiteral 能定位）；
 *  (b) 至少一处 `of SUB_ADD` 后置遍历（主循环后 for...of 创建补实例）。
 * 缺任一 → false：该 type 走 codegen 升级 fallback（首次升级后新 handler 含骨架，后续加都是 data-patch）。
 */
export const hasAddSkeleton = (source: string): boolean => {
  if (!/const\s+SUB_ADD\b/.test(source)) return false
  if (!/of\s+SUB_ADD\b/.test(source)) return false
  return true
}

/** 转义正则元字符（suffix / objVar / cidVar 均为 \w+ 与短杠，理论无元字符，仍防御性转义） */
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * 确保目标 __id 的子实例在运行时会被 applyOverride 应用其 SUB_OVERRIDES 项（自愈不合契约的 handler）。
 *
 * 根因（用户「改墙颜色没反应」即此）：LLM 常对单组件型子物（createComponentObject('Wall') 等）
 * 设了 `userData.__id = ${node.id}-walls` 却**漏调** `applyOverride(SUB_OVERRIDES, obj, cid)` →
 * host 把改动 patch 进 `SUB_OVERRIDES[__id]`，但运行时 handler 从不读它 → **静默 no-op**
 * （patch 返回 ok=true、版本归档，但视觉零变化，无报错可追）。
 *
 * 本函数在 host 写 SUB_OVERRIDES **之前**先扫 handler 源码：定位
 * `objVar.userData.__id = <cidExpr>` 赋值点，若该 objVar 无 `applyOverride(SUB_OVERRIDES, objVar, …)`
 * 调用，则在其被 `.add(objVar)` 之前**确定性注入**一行
 * `applyOverride(SUB_OVERRIDES, objVar, cidExpr);` —— 使 SUB_OVERRIDES 项在运行时被读取应用。
 * 既有不合契约的 handler 由此自愈：无需 codegen 重生成、不丢其他物体、确定性（无 LLM）。
 *
 * 仅识别契约（HANDLER_CONTRACT 规则 3/6）规定的两种 __id 赋值形态：
 *  A 内联模板：`objVar.userData.__id = `${node.id}-<suffix>``
 *  B 变量模板：`const cidVar = `${node.id}-<suffix>`` + `objVar.userData.__id = cidVar`
 * 非此形态（罕见 / 非契约，如字符串拼接 `node.id + "-x"`）→ 不注入（返回 reason），调用方据 reason 降级。
 *
 * 幂等：已存在 `applyOverride(objVar)` → 不重复注入；同 handler 多次调用安全。
 * 注入位置选「.add(objVar) 之前」而非「__id 行之后」——确保子物材质/transform 默认值已设全再盖
 * （若注入在 __id 行后、默认 position.set 之前，applyOverride 设的 transform 会被后续 set 覆盖）。
 */
export function ensureApplyOverride(
  source: string,
  __id: string,
  nodeId: string,
): { source: string; injected: boolean; reason?: string } {
  // suffix = __id 去掉 nodeId 前缀（__id = nodeId + "-" + suffix，候选抽取时即此关系）
  const suffix = nodeId && __id.startsWith(nodeId + "-") ? __id.slice(nodeId.length + 1) : ""
  if (!suffix) {
    return { source, injected: false, reason: `无法从 __id=${__id} / nodeId=${nodeId} 推导 suffix` }
  }
  // 模板字面量正则片段：匹配反引号包裹的 `${node.id}-<suffix>`（cid 必须 backtick 模板才能插值 node.id）
  const tmplFrag = "`\\$\\{node\\.id\\}-" + escRe(suffix) + "`"

  let objVar: string | null = null
  let cidExpr: string | null = null
  let idMatchIndex = -1

  // A) 内联模板：objVar.userData.__id = `${node.id}-<suffix>`
  const reA = new RegExp("(\\w+)\\.userData\\.__id\\s*=\\s*(" + tmplFrag + ")")
  const mA = reA.exec(source)
  if (mA) {
    objVar = mA[1]
    cidExpr = mA[2] // 含反引号的模板字面量
    idMatchIndex = mA.index
  } else {
    // B) 变量模板：const cidVar = `${node.id}-<suffix>` → objVar.userData.__id = cidVar
    const reBvar = new RegExp("const\\s+(\\w+)\\s*=\\s*(" + tmplFrag + ")")
    const mBvar = reBvar.exec(source)
    if (mBvar) {
      const cidVar = mBvar[1]
      const reBuse = new RegExp("(\\w+)\\.userData\\.__id\\s*=\\s*" + escRe(cidVar) + "\\b")
      const mBuse = reBuse.exec(source)
      if (mBuse) {
        objVar = mBuse[1]
        cidExpr = cidVar // 注入时用变量名（与运行时一致）
        idMatchIndex = mBuse.index
      }
    }
  }

  if (!objVar || !cidExpr || idMatchIndex < 0) {
    return {
      source,
      injected: false,
      reason: `未找到 __id 赋值点：应为 ${nodeId}- 起头的 backtick 模板赋值（非契约形态，无法注入 applyOverride）`,
    }
  }

  const oVar = escRe(objVar)
  // 已存在 applyOverride(SUB_OVERRIDES, objVar, …) → 无需注入（幂等；一个 obj 一个 __id，applyOverride 覆盖之）
  const reHas = new RegExp("applyOverride\\s*\\(\\s*SUB_OVERRIDES\\s*,\\s*" + oVar + "\\b")
  if (reHas.test(source)) {
    return { source, injected: false }
  }

  // 注入点：idMatchIndex 之后的第一个 `.add(objVar)` 之前（子物默认值此时已设全）
  const after = source.slice(idMatchIndex)
  const reAdd = new RegExp("\\.add\\s*\\(\\s*" + oVar + "\\b")
  const mAdd = reAdd.exec(after)
  let insertOffset: number
  let indent: string
  if (mAdd) {
    const absAdd = idMatchIndex + mAdd.index
    insertOffset = source.lastIndexOf("\n", absAdd) + 1 // .add 行行首（无 \n 则 0）
    indent = source.slice(insertOffset, absAdd).match(/^\s*/)?.[0] ?? ""
  } else {
    // 回退：注入到 __id 赋值语句行末（下一行行首）
    const idLineEnd = source.indexOf("\n", idMatchIndex)
    insertOffset = idLineEnd < 0 ? source.length : idLineEnd + 1
    const lineStart = source.lastIndexOf("\n", idMatchIndex) + 1
    indent = source.slice(lineStart, idMatchIndex).match(/^\s*/)?.[0] ?? ""
  }

  const injection = `${indent}applyOverride(SUB_OVERRIDES, ${objVar}, ${cidExpr});\n`
  return { source: source.slice(0, insertOffset) + injection + source.slice(insertOffset), injected: true }
}
/**
 * 对 handler 源码做 search→replace（通用改代码路线 edit_code，Aider 式精确匹配）。
 *
 * 按序应用每条 edit：search 须在源码中**唯一匹配**（恰好 1 处）→ replace 替换之；0 处（search 不在源码）
 * 或 >1 处（search 不唯一）→ 返回 failed + 原始 source（不部分应用，all-or-nothing）。
 *
 * 覆盖数据补丁（SUB_*）够不着的「烘在代码里的值」：墙高常量（`const wallHeight = 3`→`1.5`）、批量材质色
 * （循环内 `0x8899aa`→`0xff0000`）、循环数量（`i < 4`→`i < 6`）、任意字面量。search 须从注入的
 * [当前 handler 源码] 照搬（verbatim，含缩进），LLM 据所见源码产出即可。
 *
 * replace 用函数形式注入（避免 `$&`/`$1` 等 replacement 模式被 String.replace 解释为模式）。
 * 匹配失败（0/>1）→ 调用方判 failed 走 fallback modify（不破 handler、不丢其他物体）。
 */
export function applySearchReplace(
  source: string,
  edits: { search: string; replace: string }[],
): { source: string; failed?: { search: string; reason: string } } {
  let out = source
  for (const e of edits) {
    if (!e.search) return { source, failed: { search: e.search, reason: "edit_code search 串为空" } }
    const count = out.split(e.search).length - 1
    if (count === 0) {
      return { source, failed: { search: e.search, reason: "edit_code search 串在 handler 中未匹配（0 处），需 fallback modify" } }
    }
    if (count > 1) {
      return { source, failed: { search: e.search, reason: `edit_code search 串在 handler 中匹配 ${count} 处（须唯一），需 fallback modify` } }
    }
    out = out.replace(e.search, () => e.replace)
  }
  return { source: out }
}

/**
 * 检测 __id 是否为引擎兜底 part-N（manager.stampMissingIds 盖的 `${rootId}-part-N`）。
 *
 * 组件型 Group（createComponentObject('Wall') / loadModel GLB 等）内部子 mesh 无语义 __id，
 * manager 在 handler create 返回后才兜底盖 `${rootId}-part-N`。而 handler create 时 applyOverride 查的是
 * handler 自盖的 Group 语义 cid（如 `${node.id}-walls`），**不查** part-N → commitEdits 若把改动写进
 * SUB_OVERRIDES[part-N] 是死项（运行时从不读）→ 重建后改动丢失（用户「改墙色提交变回去」即此）。
 * 故 part-N 兜底 __id 的材质改色走 edit_code 改 handler 的 color 字面量，不走 SUB_OVERRIDES。
 */
export const isFallbackPartId = (__id: string): boolean => /-part-\d+$/.test(__id)

/**
 * 把 handler 源码里首个材质 color 字面量（`color: 0xHEX`）替换为新色（edit_code 路线，Aider 式唯一匹配）。
 *
 * 用于编辑态提交组件型 Group 改色（isFallbackPartId 命中）：SUB_OVERRIDES+applyOverride 对黑盒 Group
 * 走不通（key 错位 + Group 无 material + part __id 时序在后），改 color 字面量 = 重建时组件用新色，确定性持久。
 *
 * 取源码首个 `color:\s*0x[hex]` 串（verbatim，含原空格）作 search、同串仅换 hex 作 replace（保空格格式），
 * 调 applySearchReplace 唯一匹配校验。**多部件异色（杆/罩/泡…，distinct>1）→ skip 防改错部件+全变**；单色但同色多份（count>1）或无 color 字面量 → failed（调用方跳过/降级）。
 *
 * 局限：仅改 color 字面量；roughness/metalness 等非 color 材质字段对组件型 Group 暂不落盘（SUB_OVERRIDES 对
 * Group no-op，edit_code 改多字段字面量脆弱，后续按需扩展）。单 material handler（墙/地板/天花板）可靠。
 */
export const patchHandlerMaterialColor = (
  source: string,
  newColorHex: string,
): { source: string; failed?: { reason: string } } => {
  // 收集全部 `color: 0xHEX` 字面量（gi 全量）。多部件异色 handler（杆/罩/泡各一色）取首匹配会改错部件+全变，
  // 故先数不同色值：>1 种 → 无法定位具体子部件 → skip（防静默改错部件+全变），须组件 Group 内子 mesh 盖语义
  // __id + applyOverride 走 SUB_OVERRIDES 单实例改色（P0.1-5 B 路线 codegen prompt 补规则保障）。
  const matches = source.match(/color:\s*0x[0-9a-fA-F]+/gi)
  if (!matches || matches.length === 0) {
    return { source, failed: { reason: "edit_code 改色：handler 源码未找到 `color: 0x` 材质字面量（该 type 可能非材质驱动或字面量格式异常）" } }
  }
  const distinct = new Set<string>()
  for (const s of matches) {
    const h = /0x[0-9a-fA-F]+/i.exec(s)
    if (h) distinct.add(h[0].toLowerCase())
  }
  if (distinct.size > 1) {
    return {
      source,
      failed: {
        reason: `edit_code 改色：handler 有 ${distinct.size} 种不同 color 字面量（多部件异色，如杆/罩/泡），patchHandlerMaterialColor 无法定位具体子部件（取首匹配=改错部件+全变）；须组件 Group 内子 mesh 盖语义 __id+applyOverride 走 SUB_OVERRIDES 单实例改色`,
      },
    }
  }
  // 单色（或同色多份）：取首匹配 verbatim 作 search、同串仅换 hex 作 replace（保空格），唯一性校验。
  const search = matches[0]
  const replace = search.replace(/0x[0-9a-fA-F]+/i, newColorHex)
  const res = applySearchReplace(source, [{ search, replace }])
  if (res.failed) {
    return { source: res.source, failed: { reason: `edit_code 改色：color 字面量匹配不唯一或失败（${res.failed.reason}）` } }
  }
  return { source: res.source }
}
