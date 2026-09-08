/**
 * codegen_scene —— Direct 单次直出 codegen 编排（无 plan 无自愈）
 *
 *   triage（routing=create/modify/patch/chat + types + patchOps）
 *     → direct codegen（1 次调用，吃 type 名 + 用户 prompt + currentHandlers[modify] + assetCatalog，
 *       LLM 自己想坐标/尺寸/结构，输出 handler + group + scene-config.json）
 *     → parseCodeFiles + parseDirectResult
 *     → host 确定性合并 index.ts + live-data.json
 *     → 物化 + 预览（onCodeVersionReady / materializePatch）
 *     → 门控（失败只提示不重跑不重试）
 *
 * 旧 3-agent 流水线 plan + pertype/full + 自愈循环已随 direct 落地全清删除
 * （单次 codegen 30-60s 替代 plan+并行/全量+自愈 32-50min）。
 * modify/patch/edit_code/编辑器链路完全不动（它们吃 handler 文件，和生成方式无关）。
 *
 * 发送层渐进迁移：pendingPreviewData 存分组 TreeScene（onCodeVersionReady 回填），不碰 14 个平铺 SceneConfig 文件。
 */
import scene_3d_triage from "../agents/scene-triage"
import { scene_3d_codegen_direct } from "../agents/scene-codegen"
import { parseCodeFiles, type CodeFile } from "../utils/parse-code-files"
import { checkHandlerSyntax, type SyntaxError } from "../utils/parse-check"
import { loadCurrentSceneState, readCodeDirFiles } from "../utils/version-history"
import { getDesktopApi } from "../utils/desktop-api"
import { workspaceDir, materialize } from "../utils/workspace"
import { extractPatchCandidates, looksLikeScalarChange, type PatchCandidate } from "./patch-resolver"
import { patchScene, type PatchOp } from "./patch-scene"
import type { SceneCreateInput } from "./scene-create-input"
import type { GateFinding, GateResult } from "../utils/scene-gate"
import type { ErrorFinding } from "../utils/error-msg"

const RESERVED_TYPES = new Set(["version", "scene", "camera", "lights", "remove"])

/** direct codegen 产出的 type 元数据（build_detail 空——LLM 自己想，不需要 plan 预设） */
export interface DirectType {
  type: string
  purpose: string
  implementation: "native" | "component" | "model"
  build_detail: string
  components: string[]
  resources: string[]
}

/** synthetic plan：host 合并 live-data 时需要 camera/lights/scene + types 清单，direct 模式由 LLM 的 scene-config.json 填充 */
export interface DirectPlan {
  scene_description: string
  types: DirectType[]
  camera: Record<string, unknown>
  lights: unknown[]
  scene: Record<string, unknown>
}

export type CodegenSceneInput = SceneCreateInput & {
  /** 是否已有场景（host 据 lastSceneObjects.length 预判；triage 做最终 routing） */
  hasScene: boolean
  /** 场景历史目录（sceneHistoryDir()），供读当前状态 + codeDir */
  sceneDir: string
  /** sdk 根目录（workspace 路径基准 = {sdkDir}/.octo/design-3d/workspace），供读 assetCatalog */
  sdkDir: string
  /** codegen 产物回调 → onCodeVersionReady（物化 + 预览，全量 switchVersion 路径） */
  onCodeReady: (files: CodeFile[], sceneData: Record<string, unknown> | null, summary: string) => Promise<void>
  /** patch 产物回调 → materializePatch（轻量物化，overlay 子集不重启 dev；patch 路径用） */
  onMaterialize: (files: CodeFile[], summary: string, sceneData: Record<string, unknown> | null) => Promise<void>
  /** 场景级 patch 产物回调 → materializeEnvPatch（落盘 live-data + post SCENE_PATCH_ENV，不 reload 不 dispose；M-3 ① 纯场景级 op 用） */
  onEnvMaterialize?: (files: CodeFile[], summary: string, sceneData: Record<string, unknown> | null) => Promise<void>
  /** 上一轮 9a 门控失败清单（来自 handleRetry 喂回），注入 codegen 让其照着修 */
  priorGateFindings?: GateFinding[]
  /**
   * P7-2 修复场景：上一轮结构化报错清单（file/line/code/message，来自 ProtoError.findings）。
   * 注入 triage 让其路由 patch + edit_code 精准改那一行。非修复场景不传。
   */
  priorErrors?: ErrorFinding[]
  /**
   * 9a 门控执行器（物化后跑）。host 提供（闭包 settleMs 延迟 + 读
   * consoleBuffer）；返回 GateResult 供提示——运行时错只提示不重跑（direct 无自愈）。
   * 不传则 host 自行跑门控（旧行为）。
   */
  gateRunner?: (plan: DirectPlan | null, sceneData: Record<string, unknown> | null) => Promise<GateResult>
}

export interface CodegenSceneResult {
  routing: "create" | "modify" | "patch" | "chat"
  reply?: string
  summary?: string
  plan?: DirectPlan
  /** triage 输出的 patchOps（routing=patch 时；供 host 跳过 9a 门控等） */
  patchOps?: PatchOp[]
  /** codegen 产出的分组 sceneData（供 host 跑 9a 完整性门控） */
  sceneData?: Record<string, unknown> | null
  /** 末轮 9a 门控结果（gateRunner 提供时；undefined=循环内没跑门控，host 自行跑） */
  gatePassed?: boolean
  /** 末轮 9a 门控 findings（失败时 error 级清单，供 host 落失败卡片 + stash 手动重试） */
  gateFindings?: GateFinding[]
  /** P7-2：结构化报错清单（物化前 syntax/type 错转 ErrorFinding[]），供 host 落失败卡片「修复」入口 */
  findings?: ErrorFinding[]
  error?: string
}

/** 把 SyntaxError[]/TypeError[] 转成 ErrorFinding[]（供 host 落失败卡片修复入口） */
function toErrorFindings(errs: SyntaxError[]): ErrorFinding[] {
  return errs.map((e) => ({ file: e.file, line: e.line, code: String(e.code), message: e.message }))
}

export async function codegen_scene(input: CodegenSceneInput): Promise<CodegenSceneResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated, fileParts, hasScene, sceneDir, sdkDir, onCodeReady, onMaterialize, onEnvMaterialize, priorGateFindings, priorErrors, gateRunner } =
    input

  // 1. 取当前场景 type 清单（modify 时供 triage 判哪些 type 可改 / 继承）
  const currentTypes = hasScene ? await loadCurrentTypes(sceneDir, rootSession) : []

  // 1.5. 抽 patch 候选 __id 清单（hasScene 时；注入 triage 供受限选择，防臆造 __id）
  //      子物体 __id 不在 live-data、在 handler 源码；正则确定性抽所有完全字面量 cid。
  const patchCandidates = hasScene ? await loadPatchCandidates(sceneDir, rootSession) : []

  // 1.7. 读当前 handler 源码（hasScene 时；注入 triage 供 edit_code 出 verbatim search 串，防臆造匹配不上
  //      → fallback modify 丢物体）。modify/patch-fallback 路径复用此 currentCode（不二次读 codeDir）。
  const currentCode = hasScene ? await loadCurrentCode(sceneDir, rootSession) : null
  const currentHandlers = currentCode?.currentHandlers ?? ""
  // 1.8. 取当前场景级配置（camera/lights/scene；注入 triage 供 set_light/set_camera/set_scene 改值参照，M-3 ①）
  const currentSceneEnv = hasScene ? await loadCurrentSceneEnv(sceneDir, rootSession) : undefined

  // 2. triage：判 routing + types + patchOps
  console.log("[codegen_scene] ① triage 分诊中…")
  const triage = await scene_3d_triage({
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput,
    onSessionCreated,
    fileParts,
    lastIntent: null,
    lastPlanner: null,
    lastSceneObjects: [],
    currentTypes,
    hasScene,
    patchCandidates,
    currentHandlers,
    currentSceneEnv,
    priorErrors,
  })
  if (triage.routing === "chat") {
    return { routing: "chat", reply: triage.reply }
  }

  // 2.5. patch 短路：基于原场景局部改材质/transform，不进 codegen（不重生成、不丢物体）。
  //      1B：只要 triage 吐了 patchOps（哪怕 routing=modify 也吐了——prompt 要求标量改动必出 patchOps）
  //      → 优先 patchScene（host 决定，不依赖 triage routing 判断的可靠性）。
  //      校验失败（__id 不在候选 / handler 无骨架）→ 不物化，fallback 进下面 codegen。
  //      1C 兜底：triage 把标量改动误判 modify（没吐 patchOps）但请求像标量改动 + 有候选
  //      → 约束再问 triage force-patch（从候选选 __id 出 patchOps）；再问仍无 patchOps / patch 失败 → 落 codegen。
  const patchSummary = userInput.trim().slice(0, 60) || "patch"
  if (triage.patchOps.length > 0) {
    console.log(
      `[codegen_scene] ① patch 短路（${triage.patchOps.length} ops，routing=${triage.routing}，不进 codegen）…`,
    )
    const patchRes = await patchScene({
      sceneDir,
      sid: rootSession,
      patchOps: triage.patchOps,
      summaryHint: userInput,
      onMaterialize,
      onEnvMaterialize,
    })
    if (patchRes.ok) {
      // P7-2 修复闭环：priorErrors 非空 = 用户在修上一轮 bug，patch 物化后跑门控验证修复是否生效。
      //   失败 → 回带新 findings 让 host 落失败卡片（用户可再点「修复」），不自动重试（direct 无自愈）。
      //   非 fix 场景（priorErrors 空）→ 仍只 toast 不跑门控（普通 patch 改材质/transform 不需验证）。
      if (priorErrors && priorErrors.length > 0 && gateRunner) {
        const gate = await gateRunner(null, null)
        console.log(`[codegen_scene] ① patch 修复门控验证:`, gate.passed ? "PASS" : "FAIL", gate.findings)
        return {
          routing: "patch",
          summary: patchSummary,
          patchOps: triage.patchOps,
          gatePassed: gate.passed,
          gateFindings: gate.findings,
        }
      }
      return { routing: "patch", summary: patchSummary, patchOps: triage.patchOps }
    }
  } else if (patchCandidates.length > 0 && looksLikeScalarChange(userInput)) {
    console.log(
      `[codegen_scene] ① patch 兜底再问（triage routing=${triage.routing} 未吐 patchOps，请求疑似标量改动，force-patch）…`,
    )
    const reTriage = await scene_3d_triage({
      sdk,
      sync,
      modelKey,
      rootSession,
      userInput,
      onSessionCreated,
      fileParts,
      lastIntent: null,
      lastPlanner: null,
      lastSceneObjects: [],
      currentTypes,
      hasScene,
      patchCandidates,
      currentHandlers,
      currentSceneEnv,
      forcePatch: true,
      priorErrors,
    })
    if (reTriage.patchOps.length > 0) {
      const patchRes = await patchScene({
        sceneDir,
        sid: rootSession,
        patchOps: reTriage.patchOps,
        summaryHint: userInput,
        onMaterialize,
        onEnvMaterialize,
      })
      if (patchRes.ok) {
        // P7-2 修复闭环：同主 patch 短路，fix 场景跑门控验证修复
        if (priorErrors && priorErrors.length > 0 && gateRunner) {
          const gate = await gateRunner(null, null)
          console.log(`[codegen_scene] ① 兜底 patch 修复门控验证:`, gate.passed ? "PASS" : "FAIL", gate.findings)
          return {
            routing: "patch",
            summary: patchSummary,
            patchOps: reTriage.patchOps,
            gatePassed: gate.passed,
            gateFindings: gate.findings,
          }
        }
        return { routing: "patch", summary: patchSummary, patchOps: reTriage.patchOps }
      }
      console.warn(`[codegen_scene] 兜底再问 patch 失败，fallback codegen：${patchRes.error}`, patchRes.skipped)
    } else if (reTriage.routing === "chat") {
      // 兜底再问判为闲聊（极少见）：透传，不进 codegen
      return { routing: "chat", reply: reTriage.reply }
    }
  }

  // patch 失败 fallback 时也走 modify 路径（codegen 注入 [CURRENT_HANDLERS] 保留未受影响 type）
  const isModify = triage.routing === "modify" || triage.routing === "patch"
  // attachment_description 注入用户输入（供 codegen 参考）
  const effectiveUserInput = triage.attachment_description
    ? `[参考内容]: ${triage.attachment_description}\n[用户需求]: ${userInput}`
    : userInput

  // 2.6. 读 workspace 资产清单（注入 codegen 的 [ASSET_CATALOG]，让 LLM 选 asset:<id>，如机房选 asset:rack）
  const assetCatalog = await loadAssetCatalog(sdkDir)

  // 3. direct codegen：1 次调用，create+modify 都走它，LLM 自己想坐标/尺寸/结构
  const targetTypes = [...triage.types.create, ...triage.types.modify].filter((t) => t && t.trim())
  const summary = userInput.trim().slice(0, 80) || "scene"
  console.log(`[codegen_scene] ② direct codegen ${targetTypes.length} 个 type…（create=${triage.types.create.length} modify=${triage.types.modify.length}）`)

  // modify 时当前 handler 文件 + live-data（复用 1.7 读的 currentCode；create 时空）
  const currentFiles = isModify && currentCode ? currentCode.currentFiles : []
  const currentLiveData = isModify && currentCode ? currentCode.currentLiveData : ""
  const prevLiveData = parseLiveData(currentLiveData)

  const directRes = await scene_3d_codegen_direct({
    sdk,
    sync,
    modelKey,
    rootSession,
    onSessionCreated,
    fileParts,
    userInput: effectiveUserInput,
    types: targetTypes,
    isModify,
    currentHandlers: isModify ? buildCurrentHandlersMap(currentFiles, targetTypes) : undefined,
    currentGroups: isModify ? buildCurrentGroupsMap(prevLiveData, targetTypes) : undefined,
    priorGateFindings,
    assetCatalog,
  })
  if (directRes.error) {
    return { routing: triage.routing, error: `direct codegen 失败：${directRes.error}（请重试）` }
  }

  // 4. 解析 direct 输出 → handler/group/scene-config
  const parsed = parseDirectResult(directRes.text)
  const handlerByType = parsed.handler
  const groupByType = parsed.group
  const sceneConfig = parsed.sceneConfig
  if (handlerByType.size === 0) {
    return { routing: triage.routing, error: `codegen 未产出任何 handler（输出可能被截断或格式错），请重试` }
  }

  // 5. synthetic plan：types 只有 type 名（build_detail 空），env 来自 LLM 的 scene-config.json
  const plan: DirectPlan = {
    scene_description: summary,
    types: targetTypes.map((t) => ({ type: t, purpose: "", implementation: "native", build_detail: "", components: [], resources: [] })),
    camera: (sceneConfig.camera as Record<string, unknown>) ?? {},
    lights: Array.isArray(sceneConfig.lights) ? sceneConfig.lights : [],
    scene: (sceneConfig.scene as Record<string, unknown>) ?? {},
  }

  // 6. modify 时补回未受影响 type 的 handler/group（不在 targetTypes 里的 type 从 currentCode 继承）
  if (isModify) seedUnchangedTypes(handlerByType, groupByType, targetTypes, currentFiles, prevLiveData)

  // 7. host 确定性合并 files + sceneData（index.ts + live-data.json 由 host 生成，不靠 LLM）
  const assembled = assembleScene(plan, handlerByType, groupByType, isModify, prevLiveData)

  // 8. 物化前静态语法检查：transpileModule 抓 1xxx 语法错（失败只报错不重试，direct 无自愈）
  const syntaxErrors = checkHandlerSyntax(assembled.files)
  if (syntaxErrors.length > 0) {
    const detail = syntaxErrors
      .slice(0, 5)
      .map((e) => `${e.file}:${e.line}:${e.column}: ${e.message} (code ${e.code})`)
      .join("；")
    console.error(`[codegen_scene] ⑥ 语法检查 ${syntaxErrors.length} 个错（direct 无自愈，放弃）：`, detail)
    return {
      routing: triage.routing,
      error: `生成的 handler .ts 存在代码错误（${syntaxErrors.length} 处，请重试）：${detail}`,
      findings: toErrorFindings(syntaxErrors),
    }
  }

  console.log(
    `[codegen_scene] parseCodeFiles 解析到 ${assembled.files.length} 个文件:`,
    assembled.files.map((f) => f.path),
  )
  console.log(`[codegen_scene] extractSceneData:`, assembled.sceneData ? `非空 (keys=${Object.keys(assembled.sceneData).join(",")})` : "空")

  // 9. 物化 + 预览（modify 走 materializePatch 轻量 overlay；create 走 onCodeVersionReady 全量）
  if (isModify) {
    await onMaterialize(assembled.files, summary, assembled.sceneData)
  } else {
    await onCodeReady(assembled.files, assembled.sceneData, summary)
  }

  // 10. 9a 门控：运行时错只提示不重跑（direct 无自愈）
  let gatePassed: boolean | undefined
  let gateFindings: GateFinding[] | undefined
  if (gateRunner) {
    const gate = await gateRunner(plan, assembled.sceneData)
    gatePassed = gate.passed
    gateFindings = gate.findings
    console.log(`[codegen_scene] ⑩ 9a 门控:`, gate.passed ? "PASS" : "FAIL", gate.findings)
  }

  return {
    routing: triage.routing,
    summary,
    plan,
    sceneData: assembled.sceneData,
    gatePassed,
    gateFindings,
  }
}

/** 解析 live-data.json 字符串 → 对象（失败返回 null；空串 → null）。 */
function parseLiveData(content: string): Record<string, unknown> | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // 不可解析（旧版本边界）→ null
  }
  return null
}

/** modify 时把「未受影响 type」（不在 targetTypes 里）的 handler + 分组从 currentCode 基线填入。 */
function seedUnchangedTypes(
  handlerByType: Map<string, CodeFile>,
  groupByType: Map<string, unknown[]>,
  targetTypes: string[],
  currentFiles: CodeFile[],
  prevLiveData: Record<string, unknown> | null,
): void {
  const targetSet = new Set(targetTypes)
  for (const f of currentFiles) {
    const type = typeFromHandlerPath(f.path)
    if (type && !targetSet.has(type)) handlerByType.set(type, f)
  }
  if (prevLiveData) {
    for (const [key, val] of Object.entries(prevLiveData)) {
      if (RESERVED_TYPES.has(key) || targetSet.has(key) || !Array.isArray(val)) continue
      groupByType.set(key, val as unknown[])
    }
  }
}

/** 从 handler path 提 type 名（`.../handlers/<type>/<type>.ts` → `<type>`；非 handler → null）。 */
function typeFromHandlerPath(path: string): string | null {
  const p = path.replace(/\\/g, "/")
  const m = p.match(/handlers\/([^/]+)\/[^/]+\.ts$/)
  return m ? m[1] : null
}

/** modify 时找该 type 当前 handler 源码（照抄布局参数）；create/无 → undefined。 */
function findCurrentHandler(currentFiles: CodeFile[], type: string): CodeFile | undefined {
  return currentFiles.find((f) => f.path.replace(/\\/g, "/").endsWith(`handlers/${type}/${type}.ts`))
}

/** modify 时找该 type 当前分组片段（JSON 字符串）；create/无分组 → undefined。 */
function findCurrentGroup(prevLiveData: Record<string, unknown> | null, type: string): string | undefined {
  const group = prevLiveData?.[type]
  if (!Array.isArray(group)) return undefined
  return JSON.stringify(group, null, 2)
}

/** 从 handler 源码提导出名（`export const xxx: ComponentHandler` → `xxx`；不合法 → null）。 */
function extractHandlerExportName(content: string): string | null {
  const m = content.match(/export\s+const\s+(\w+)\s*:\s*ComponentHandler\b/)
  return m ? m[1] : null
}

/** 解析单 agent 全量输出（2N 个 ## file 块）→ handler / group 两个 Map（type → 产物）。 */
function parseFullResult(text: string): { handler: Map<string, CodeFile>; group: Map<string, unknown[]> } {
  const handler = new Map<string, CodeFile>()
  const group = new Map<string, unknown[]>()
  for (const f of parseCodeFiles(text)) {
    const p = f.path.replace(/\\/g, "/")
    if (p.endsWith(".group.json")) {
      const type = p.replace(/^.*\//, "").replace(/\.group\.json$/, "")
      const g = parseGroupFragment(f.content)
      if (type && g) group.set(type, g)
    } else if (p.endsWith(".ts") && !p.endsWith("index.ts")) {
      const type = typeFromHandlerPath(p)
      const exportName = extractHandlerExportName(f.content)
      if (type && exportName) {
        // host 归一 path（与 parsePerTypeResult 一致：约定 handlers/<type>/<type>.ts）
        handler.set(type, { path: `src/3d/managers/component/handlers/${type}/${type}.ts`, content: f.content })
      }
    }
  }
  return { handler, group }
}

/** 解析 direct 输出：handler + group + scene-config.json（camera/lights/scene）。 */
function parseDirectResult(text: string): {
  handler: Map<string, CodeFile>
  group: Map<string, unknown[]>
  sceneConfig: { camera?: unknown; lights?: unknown; scene?: unknown }
} {
  const { handler, group } = parseFullResult(text)
  // 找 scene-config.json 块
  let sceneConfig: { camera?: unknown; lights?: unknown; scene?: unknown } = {}
  for (const f of parseCodeFiles(text)) {
    const p = f.path.replace(/\\/g, "/")
    if (p === "scene-config.json" || p.endsWith("/scene-config.json")) {
      try {
        const parsed = JSON.parse(stripFence(f.content)) as Record<string, unknown>
        sceneConfig = { camera: parsed.camera, lights: parsed.lights, scene: parsed.scene }
      } catch {
        console.warn("[parseDirectResult] scene-config.json 解析失败，env 用空默认值")
      }
      break
    }
  }
  return { handler, group, sceneConfig }
}

/** 剥 fenced code block 围栏 → 纯内容（parseGroupFragment/scene-config 用）。 */
function stripFence(content: string): string {
  return content
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/, "")
    .trim()
}

/** modify 时把本轮要写 type 的当前 handler 源码按 type 收录（照抄布局参数）。 */
function buildCurrentHandlersMap(currentFiles: CodeFile[], pendingTypes: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const type of pendingTypes) {
    const f = findCurrentHandler(currentFiles, type)
    if (f) map[type] = f.content
  }
  return map
}

/** modify 时把本轮要写 type 的当前分组片段按 type 收录（根节点 id 照抄勿换）。 */
function buildCurrentGroupsMap(
  prevLiveData: Record<string, unknown> | null,
  pendingTypes: string[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const type of pendingTypes) {
    const g = findCurrentGroup(prevLiveData, type)
    if (g) map[type] = g
  }
  return map
}

/** 解析 group.json 片段 → TreeNode[]。片段短（几个 root node）几乎不截断；剥围栏直接 parse，失败 → null（该 type 缺失）。 */
function parseGroupFragment(content: string): unknown[] | null {
  const cleaned = stripFence(content)
  try {
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? (parsed as unknown[]) : null
  } catch {
    return null
  }
}

/** host 生成 handlers/index.ts：每个 type 一行 import + 一行注册（导出名从 handler 源码提取，零猜测）。 */
function buildHandlersIndex(entries: { type: string; exportName: string }[]): string {
  const importLines = entries.map((e) => `import { ${e.exportName} } from './${e.type}/${e.type}';`)
  const regLines = entries.map((e) => `  { type: '${e.type}', handler: ${e.exportName} },`)
  return [
    `import { componentManager, type ComponentHandler } from '../ComponentManager';`,
    `import { sharedState } from './base/shared';`,
    ...importLines,
    ``,
    `export { sharedState, ComponentSharedState } from './base/shared';`,
    ``,
    `const typeHandlers: Array<{ type: string; handler: ComponentHandler }> = [`,
    ...regLines,
    `];`,
    ``,
    `export const registerComponentHandlers = (): void => {`,
    `  componentManager.registerHandlers(typeHandlers);`,
    `};`,
    ``,
    `export const disposeComponentHandlers = (): void => {`,
    `  sharedState.dispose();`,
    `};`,
    ``,
  ].join("\n")
}

/** host 确定性合并：handler files + index.ts + live-data.json → { files, sceneData }。 */
function assembleScene(
  plan: DirectPlan,
  handlerByType: Map<string, CodeFile>,
  groupByType: Map<string, unknown[]>,
  isModify: boolean,
  prevLiveData: Record<string, unknown> | null,
): { files: CodeFile[]; sceneData: Record<string, unknown> } {
  const files: CodeFile[] = [...handlerByType.values()]

  // index.ts：每 type 的导出名从 handler 源码提取（LLM camelCase 转换不一致也零风险）
  const entries: { type: string; exportName: string }[] = []
  for (const [type, handler] of handlerByType) {
    const exportName = extractHandlerExportName(handler.content)
    if (exportName) entries.push({ type, exportName })
  }
  files.push({ path: "src/3d/managers/component/handlers/index.ts", content: buildHandlersIndex(entries) })

  // live-data.json：camera/lights/scene 取 plan（create）或上一轮旧值（modify，6d 语义内联）+ 各 type 分组
  const pickEnv = isModify && prevLiveData ? prevLiveData : null
  const env: Record<string, unknown> = {}
  if (pickEnv && pickEnv.scene !== undefined) env.scene = pickEnv.scene
  else if (plan.scene !== undefined) env.scene = plan.scene
  if (pickEnv && pickEnv.camera !== undefined) env.camera = pickEnv.camera
  else if (plan.camera !== undefined) env.camera = plan.camera
  if (pickEnv && pickEnv.lights !== undefined) env.lights = pickEnv.lights
  else if (plan.lights !== undefined) env.lights = plan.lights

  const liveData: Record<string, unknown> = { version: "1.0", ...env }
  for (const [type, group] of groupByType) liveData[type] = group
  files.push({ path: "public/live-data.json", content: JSON.stringify(liveData, null, 2) })

  return { files, sceneData: liveData }
}

/** 从当前 SceneSessionState.mergedSceneConfig 取 type 清单（剔除保留 key） */
async function loadCurrentTypes(sceneDir: string, sid: string): Promise<string[]> {
  try {
    const state = await loadCurrentSceneState(sceneDir, sid)
    const merged = state?.mergedSceneConfig
    if (!merged || typeof merged !== "object") return []
    return Object.keys(merged).filter((k) => !RESERVED_TYPES.has(k))
  } catch {
    return []
  }
}

/**
 * 抽 patch 候选 __id 清单（hasScene 时；注入 triage 供受限选择 __id，防臆造）。
 * 读 codeDir 全量 + mergedSceneConfig → extractPatchCandidates 正则抽所有完全字面量 cid。
 * 无 codeDir / 非 Electron / 读失败 → 返 []（triage 无候选 → routing=patch 会 fallback modify）。
 */
async function loadPatchCandidates(sceneDir: string, sid: string): Promise<PatchCandidate[]> {
  try {
    const state = await loadCurrentSceneState(sceneDir, sid)
    if (!state?.codeDir || !state.mergedSceneConfig) return []
    const files = await readCodeDirFiles(state.codeDir)
    if (!files) return []
    return extractPatchCandidates(files, state.mergedSceneConfig)
  } catch (e) {
    console.warn("[codegen_scene] loadPatchCandidates 失败", e)
    return []
  }
}

/**
 * 取当前场景级配置（camera/lights/scene 顶层保留键，M-3 ①）。注入 triage 的 [当前场景 camera/lights/scene]，
 * 供 set_light 的 index 按 lights 顺序、set_camera/set_scene 的 fields 参照当前值改（如「灯再亮一点」= 当前 +0.5）。
 * 无 mergedSceneConfig / 读失败 → 返 undefined（triage 无场景级参照，改值靠目标值推断，不崩）。
 */
async function loadCurrentSceneEnv(
  sceneDir: string,
  sid: string,
): Promise<{ camera?: unknown; lights?: unknown; scene?: unknown } | undefined> {
  try {
    const state = await loadCurrentSceneState(sceneDir, sid)
    const merged = state?.mergedSceneConfig
    if (!merged || typeof merged !== "object") return undefined
    const m = merged as Record<string, unknown>
    return { camera: m.camera, lights: m.lights, scene: m.scene }
  } catch (e) {
    console.warn("[codegen_scene] loadCurrentSceneEnv 失败", e)
    return undefined
  }
}

/**
 * modify 时从当前版本 codeDir 读全部 handler .ts 源码 + live-data，
 * 注入 codegen 的 [CURRENT_HANDLERS] / [CURRENT_GROUPS]（供保留未受影响 type）。
 * - currentLiveData：优先取 state.mergedSceneConfig（内存状态，落盘时 = sceneData）。
 * - currentHandlers：读 codeDir 全部 .ts 文件，按 `## file: <path>\n<content>` 拼接（与 codegen 输出格式一致）。
 * 无 codeDir / 非 Electron / 读失败 → 返回空（codegen 盲生成 plan types，可能丢未受影响 type，边界可接受）。
 */
async function loadCurrentCode(
  sceneDir: string,
  sid: string,
): Promise<{ currentHandlers: string; currentLiveData: string; currentFiles: CodeFile[] }> {
  const state = await loadCurrentSceneState(sceneDir, sid)
  // live-data：优先从内存状态取（onCodeVersionReady 落盘时 mergedSceneConfig = sceneData）
  const currentLiveData = state?.mergedSceneConfig ? JSON.stringify(state.mergedSceneConfig, null, 2) : ""

  const codeDir = state?.codeDir
  const api = getDesktopApi()
  if (!codeDir || !api?.listDirectory || !api?.readFileBuffer) {
    if (!codeDir) {
      console.warn("[codegen_scene] loadCurrentCode: 无 codeDir，modify 无法注入旧 handler（旧版本或落盘失败）")
    }
    return { currentHandlers: "", currentLiveData, currentFiles: [] }
  }
  try {
    const entries = await api.listDirectory(codeDir)
    const tsFiles = entries
      .filter((e) => e.type === "file" && e.path.endsWith(".ts"))
      .map((e) => ({ path: e.path.replace(/\\/g, "/") }))
      .sort((a, b) => a.path.localeCompare(b.path))
    const blocks: string[] = []
    const currentFiles: CodeFile[] = []
    for (const f of tsFiles) {
      const buf = await api.readFileBuffer(`${codeDir}/${f.path}`)
      if (!buf) continue
      const content = new TextDecoder().decode(buf)
      blocks.push(`## file: ${f.path}\n${content}`)
      currentFiles.push({ path: f.path, content })
    }
    return { currentHandlers: blocks.join("\n\n"), currentLiveData, currentFiles }
  } catch (e) {
    console.warn("[codegen_scene] loadCurrentCode: 读 codeDir 失败", e)
    return { currentHandlers: "", currentLiveData, currentFiles: [] }
  }
}

/**
 * 读 workspace 的 assetCatalog.ts（纯数据资产目录）注入 codegen prompt 的 [ASSET_CATALOG]。
 * 整文件源码注入（不解析）——assetCatalog.ts 是纯数据 .ts（无 ?url/无注释模板），LLM 读
 * 源码即知可用 asset:<id> + 名称 + tags + 描述，机房场景便能自动选 asset:rack。
 *
 * - workspace 未物化（首次生成边界）：readFileBuffer 返 null → materialize 后重读（此时 dev
 *   未跑，安全；materialize 仅在 workspace 缺失时触发，不与 switchVersion 抢占）。
 * - 非 Electron / 读失败 / materialize 抛错 → 返 ""（codegen 仍可跑，仅无清单，LLM 走 hunyuan/原生）。
 */
async function loadAssetCatalog(sdkDir: string): Promise<string> {
  try {
    if (!sdkDir) return ""
    const api = getDesktopApi()
    if (!api?.readFileBuffer) return ""
    const catalogPath = `${workspaceDir(sdkDir)}/assetsLibrary/assetCatalog.ts`
    let buf = await api.readFileBuffer(catalogPath)
    if (!buf) {
      // workspace 未物化（首次生成）→ 物化后重读；materialize 非 Electron 会抛错，外层 catch 吞
      await materialize(sdkDir)
      buf = await api.readFileBuffer(catalogPath)
    }
    return buf ? new TextDecoder().decode(buf) : ""
  } catch (e) {
    console.warn("[codegen_scene] loadAssetCatalog: 读 workspace assetCatalog 失败", e)
    return ""
  }
}
