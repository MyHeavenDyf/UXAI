/**
 * codegen_scene —— 3-agent handler 代码生成编排（Step 7）
 *
 *   triage（routing=create/modify/chat + types）
 *     → plan（选型 / 选资源 + camera/lights/scene）
 *     → codegen（写 handler .ts + 全量 index.ts + 全量 live-data.json，Markdown 代码块）
 *     → parseCodeFiles + extractSceneData
 *     → onCodeReady（onCodeVersionReady 物化 workspace + 启 51857 + iframe 重载 + SCENE_UPDATE 推分组）
 *
 * 替换旧 8-agent JSON 流水线（create-scene.ts / modify-scene-ai.ts 成孤儿保留，Step 8/9 清理）。
 * 全砍暂停点（intent_confirm / 线框审查）：NL→triage→plan→codegen→预览，代码先行。
 *
 * 发送层渐进迁移：pendingPreviewData 存分组 TreeScene（onCodeVersionReady 回填），不碰 14 个平铺 SceneConfig 文件。
 */
import scene_3d_triage from "../agents/scene-triage"
import scene_3d_plan, { type PlanResult } from "../agents/scene-plan"
import scene_3d_codegen from "../agents/scene-codegen"
import { parseCodeFiles, extractSceneData, type CodeFile } from "../utils/parse-code-files"
import { loadCurrentSceneState, readCodeDirFiles } from "../utils/version-history"
import { getDesktopApi } from "../utils/desktop-api"
import { workspaceDir, materialize } from "../utils/workspace"
import { extractPatchCandidates, looksLikeScalarChange, type PatchCandidate } from "./patch-resolver"
import { patchScene, type PatchOp } from "./patch-scene"
import type { SceneCreateInput } from "./create-scene"
import type { GateFinding } from "../utils/scene-gate"

const RESERVED_TYPES = new Set(["version", "scene", "camera", "lights", "remove"])

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
}

export interface CodegenSceneResult {
  routing: "create" | "modify" | "patch" | "chat"
  reply?: string
  summary?: string
  plan?: PlanResult
  /** triage 输出的 patchOps（routing=patch 时；供 host 跳过 9a 门控等） */
  patchOps?: PatchOp[]
  /** codegen 产出的分组 sceneData（供 host 跑 9a 完整性门控） */
  sceneData?: Record<string, unknown> | null
  error?: string
}

export async function codegen_scene(input: CodegenSceneInput): Promise<CodegenSceneResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated, fileParts, hasScene, sceneDir, sdkDir, onCodeReady, onMaterialize, onEnvMaterialize, priorGateFindings } =
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
  })
  if (triage.routing === "chat") {
    return { routing: "chat", reply: triage.reply }
  }

  // 2.5. patch 短路：基于原场景局部改材质/transform，不进 plan/codegen（不重生成、不丢物体）。
  //      1B：只要 triage 吐了 patchOps（哪怕 routing=modify 也吐了——prompt 要求标量改动必出 patchOps）
  //      → 优先 patchScene（host 决定，不依赖 triage routing 判断的可靠性）。
  //      校验失败（__id 不在候选 / handler 无骨架）→ 不物化，fallback 进下面 plan/codegen。
  //      1C 兜底：triage 把标量改动误判 modify（没吐 patchOps）但请求像标量改动 + 有候选
  //      → 约束再问 triage force-patch（从候选选 __id 出 patchOps）；再问仍无 patchOps / patch 失败 → 落 plan/codegen。
  const patchSummary = userInput.trim().slice(0, 60) || "patch"
  if (triage.patchOps.length > 0) {
    console.log(
      `[codegen_scene] ① patch 短路（${triage.patchOps.length} ops，routing=${triage.routing}，不进 plan/codegen）…`,
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
      return { routing: "patch", summary: patchSummary, patchOps: triage.patchOps }
    }
    console.warn(`[codegen_scene] patch 失败，fallback 进 plan/codegen：${patchRes.error}`, patchRes.skipped)
    // 落到下面 plan/codegen（isModify=true，用 triage.types.modify 作 fallback hint）
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
        return { routing: "patch", summary: patchSummary, patchOps: reTriage.patchOps }
      }
      console.warn(`[codegen_scene] 兜底再问 patch 失败，fallback plan/codegen：${patchRes.error}`, patchRes.skipped)
    } else if (reTriage.routing === "chat") {
      // 兜底再问判为闲聊（极少见）：透传，不进 codegen
      return { routing: "chat", reply: reTriage.reply }
    }
  }

  // patch 失败 fallback 时也走 modify 路径（codegen 注入 [CURRENT_HANDLERS] 保留未受影响 type）
  const isModify = triage.routing === "modify" || triage.routing === "patch"
  // attachment_description 注入用户输入（供 plan / codegen 参考）
  const effectiveUserInput = triage.attachment_description
    ? `[参考内容]: ${triage.attachment_description}\n[用户需求]: ${userInput}`
    : userInput

  // 2.5. 读 workspace 资产清单（注入 plan 的 [可用资产清单]，让 LLM 选 asset:<id>，如机房选 asset:rack）
  const assetCatalog = await loadAssetCatalog(sdkDir)

  // 3. plan：选型 + 选资源 + camera/lights/scene
  console.log("[codegen_scene] ② plan 选型中…")
  const plan = await scene_3d_plan({
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput: effectiveUserInput,
    onSessionCreated,
    fileParts,
    types: triage.types,
    isModify,
    currentTypes,
    assetCatalog,
  })

  // 4. codegen：写 handler .ts + 全量 index + 全量 live-data
  //    modify 时从 codeDir 读当前 handler 源码 + live-data 注入 [CURRENT_HANDLERS]/[CURRENT_LIVE_DATA]（create 时不走此路）
  // 复用 1.7 读的 currentCode（modify/patch-fallback 路径；patch 成功短路不至此，currentCode 非空）
  const currentLiveData = isModify && currentCode ? currentCode.currentLiveData : ""

  console.log("[codegen_scene] ③ codegen 生成代码中…")
  const codegenRes = await scene_3d_codegen({
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput: effectiveUserInput,
    onSessionCreated,
    fileParts,
    plan,
    isModify,
    currentHandlers,
    currentLiveData,
    priorGateFindings,
  })

  // 5+6. 先解析 Markdown → files + sceneData，再判 codegen 失败（API 错误 / 限流 / 超上下文 /
  //       墙钟掐断）——P1.4③ 部分输出抢救需要 parse 结果才能判可恢复性。失败且不可抢救 →
  //       透传 error 给 host，由 handleSubmit 写进 sessionErrors → GenerationCard 持久显示
  //       失败卡片（不靠会消失的 toast）。
  const files = parseCodeFiles(codegenRes.text)
  const sceneData = extractSceneData(files)
  if (codegenRes.error) {
    // 部分输出抢救：墙钟掐断时已收代码块仍可物化。modify 靠 6c host merge 补全 LLM 漏输出
    // 的 handler；create 无上一轮可 merge，要求 plan.types 全部有 handler 文件
    // （缺 = index.ts 注册不存在的文件 → vite import 崩，[[3d-gate-handler-mismatch]]）。
    // live-data.json 截断（sceneData null）不可抢救——它是 SCENE_UPDATE payload 必需。
    const recoverable =
      files.length > 0 &&
      sceneData !== null &&
      (isModify ? (currentCode?.currentFiles?.length ?? 0) > 0 : hasAllTypeHandlers(files, plan.types))
    if (recoverable) {
      console.warn(
        `[codegen_scene] ③ codegen 报错（${codegenRes.error}）但部分输出可抢救：${files.length} 个文件 → 继续物化（modify 靠 6c merge / create 已核 handler 齐全）`,
      )
    } else {
      console.error("[codegen_scene] ③ codegen 失败:", codegenRes.error)
      return { routing: triage.routing, error: codegenRes.error }
    }
  }
  console.log(
    `[codegen_scene] parseCodeFiles 解析到 ${files.length} 个文件:`,
    files.map((f) => f.path),
  )
  console.log(`[codegen_scene] extractSceneData:`, sceneData ? `非空 (keys=${Object.keys(sceneData).join(",")})` : "空")
  if (files.length === 0) {
    // 打印原始输出便于诊断（LLM 是否产了代码块 / 是否落在 reasoning / 是否只产自然语言 / 是否 token 截断）
    console.error(
      `[codegen_scene] parseCodeFiles 返回 0 个文件。text.length=${codegenRes.text.length}（若很大且无 ## file: → 疑似 LLM reasoning 占满 output token，代码块未产出）`,
    )
    console.error(`[codegen_scene] 输出前 2000 字符:\n`, codegenRes.text.slice(0, 2000))
    console.error(`[codegen_scene] 输出后 2000 字符（看有无 ## file: 或截断断点）:\n`, codegenRes.text.slice(-2000))
    return { routing: triage.routing, error: "LLM 未输出有效的 ## file: 代码块" }
  }

  // 6b. 灾难性短路：LLM 产了代码块但无 live-data.json（或不可解析）→ 不物化预览，直接报错
  if (!sceneData) {
    console.error("[codegen_scene] extractSceneData 返回 null：LLM 未产 live-data.json 或不可解析")
    return { routing: triage.routing, error: "LLM 未输出 live-data.json 或不可解析" }
  }

  // 6c. modify 时 host 端 merge 保全量：LLM 常只输出受影响 type handler + index + live-data，
  //     漏未受影响 type 的 handler .ts（但 index.ts 全量注册它们）→ switchVersion materialize 重建
  //     workspace 清空 + overlay 只铺 LLM 输出 → 缺 floor/walls/ceiling.ts → vite import 崩
  //     （[[3d-gate-handler-mismatch]]）。补回 LLM 没输出的上一轮 handler 文件（以 LLM 输出为准，
  //     只补缺失不覆盖 LLM 重写的；多余 handler 文件 index 不 import 则不加载，无害）。read+merge
  //     保全量同 patch 路线（readCodeDirFiles 全量 → patch → 重组全量）模式，确定性不靠 LLM。
  if (isModify && currentCode?.currentFiles && currentCode.currentFiles.length > 0) {
    const llmPaths = new Set(files.map((f) => f.path.replace(/\\/g, "/")))
    let added = 0
    for (const f of currentCode.currentFiles) {
      const p = f.path.replace(/\\/g, "/")
      if (!llmPaths.has(p)) {
        files.push(f)
        added += 1
      }
    }
    if (added > 0) {
      console.log(
        `[codegen_scene] ⑥c merge 补回 ${added} 个未受影响 type handler（LLM 漏输出，host 保全量防 vite import 崩）`,
      )
    }
  }

  // 6d. modify 时 host 端 merge 场景级保留键（camera/lights/scene，G2 修复）
  //     LLM 重写 live-data 时常顺手改 camera/lights/scene（加小车不该动相机灯光 → 场景级漂移）。
  //     modify 语义=改物体不动场景级 env；合法 env 改动走 patch 路径 set_light/set_camera/set_scene op（M-3①），
  //     不经 codegen modify。故 modify 物化前把上一轮 mergedSceneConfig 的三保留键完整覆盖回 LLM 输出
  //     —— sceneData（SCENE_UPDATE payload，iframe 消费）+ live-data.json 文件（overlay/版本恢复重读）两处都改。
  //     完整覆盖非字段级 merge：LLM 改的场景级值全是误改，整体用旧值替换（字段级 merge 会残留误改）。
  //     镜像 6c handler merge 范式（host 端确定性 merge，不靠 LLM 自觉），同 [[3d-gate-handler-mismatch]] 思路。
  if (isModify && sceneData && currentCode?.currentLiveData) {
    let prevMerged: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(currentCode.currentLiveData)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        prevMerged = parsed as Record<string, unknown>
      }
    } catch {
      // currentLiveData 不可解析（旧版本边界）→ 跳过 merge 不崩
    }
    if (prevMerged) {
      const envKeys = ["camera", "lights", "scene"] as const
      const allPresent = envKeys.every((k) => prevMerged![k] !== undefined)
      if (allPresent) {
        // 覆盖回 sceneData（SCENE_UPDATE payload）
        for (const k of envKeys) sceneData[k] = prevMerged[k]
        // 同步覆盖回 live-data.json 文件内容（overlay/版本恢复路径）
        const ldFile = files.find(
          (f) => f.path === "public/live-data.json" || f.path.replace(/\\/g, "/").endsWith("/live-data.json"),
        )
        if (ldFile) {
          try {
            const ldParsed = JSON.parse(ldFile.content) as Record<string, unknown>
            for (const k of envKeys) ldParsed[k] = prevMerged[k]
            ldFile.content = JSON.stringify(ldParsed, null, 2)
          } catch {
            // live-data.json 文件不可解析（LLM 输出异常）→ sceneData 已改，文件留 LLM 原值（reload 时 iframe 仍优先 SCENE_UPDATE）
          }
        }
        console.log(
          `[codegen_scene] ⑥d merge 场景级保留键 camera/lights/scene（modify 不该改 env，覆盖回上一轮值防漂移）`,
        )
      }
    }
  }

  // 7. 物化 + 预览
  const summary = plan.scene_description?.slice(0, 80) || userInput.slice(0, 80)
  // modify 走轻量物化（materializePatch：只 overlay 变动文件，不 materialize 重建 workspace 清空，
  //   保留上一轮未受影响 type handler——「只改变动的地方其他不变」，非全清空重写；也避开 switchVersion
  //   的 stopDev+materialize+startDev 慢路径/240s 卡顿，见 [[3d-commit-hang-startdev]]）。
  //   冷启动（dev 没跑）时 materializePatch 内部降级 onCodeVersionReady（switchVersion materialize 重建），
  //   此时 6c merge 补的全量 files 防缺文件（也保版本恢复时 codeDir 归档全量）。
  //   create 仍走 onCodeVersionReady（需 materialize 建模板基底 buildings/roads/water/example/model + startDev）。
  if (isModify) {
    await onMaterialize(files, summary, sceneData)
  } else {
    await onCodeReady(files, sceneData, summary)
  }
  return { routing: triage.routing, summary, plan, sceneData }
}

/** create 路径部分输出抢救门槛：plan.types 每个 type 都有对应 handler 文件（缺 = index.ts 注册不存在的文件 → vite import 崩）。 */
function hasAllTypeHandlers(files: CodeFile[], types: PlanResult["types"]): boolean {
  const got = new Set(files.map((f) => f.path.replace(/\\/g, "/").split("/").pop()?.replace(/\.ts$/, "") ?? ""))
  const missing = types.filter((t) => !got.has(t.type))
  if (missing.length > 0) {
    console.warn(`[codegen_scene] 部分输出缺 handler 文件: ${missing.map((t) => t.type).join(",")} → create 放弃抢救`)
    return false
  }
  return true
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
 * 注入 codegen 的 [CURRENT_HANDLERS] / [CURRENT_LIVE_DATA]（供保留未受影响 type）。
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
 * 读 workspace 的 assetCatalog.ts（纯数据资产目录）注入 plan prompt 的 [可用资产清单]。
 * 整文件源码注入（不解析）——assetCatalog.ts 是纯数据 .ts（无 ?url/无注释模板），LLM 读
 * 源码即知可用 asset:<id> + 名称 + tags + 描述，机房场景便能自动选 asset:rack。
 *
 * - workspace 未物化（首次生成边界）：readFileBuffer 返 null → materialize 后重读（此时 dev
 *   未跑，安全；materialize 仅在 workspace 缺失时触发，不与 switchVersion 抢占）。
 * - 非 Electron / 读失败 / materialize 抛错 → 返 ""（plan 仍可跑，仅无清单，LLM 走 hunyuan/原生）。
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
