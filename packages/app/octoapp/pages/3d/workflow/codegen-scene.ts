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
import { checkHandlerSyntax, type SyntaxError } from "../utils/parse-check"
import { loadCurrentSceneState, readCodeDirFiles } from "../utils/version-history"
import { getDesktopApi } from "../utils/desktop-api"
import { workspaceDir, materialize } from "../utils/workspace"
import { extractPatchCandidates, looksLikeScalarChange, type PatchCandidate } from "./patch-resolver"
import { patchScene, type PatchOp } from "./patch-scene"
import type { SceneCreateInput } from "./create-scene"
import type { GateFinding, GateResult } from "../utils/scene-gate"

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
  /**
   * 9a 门控执行器（P0.4 自愈循环用，物化后跑）。host 提供（闭包 settleMs 延迟 + 读
   * consoleBuffer）；返回 GateResult 供循环判定——运行时错喂回 codegen 重试（同循环，
   * 最多 3 次）。不传则循环内不跑门控（host 自行跑，旧行为）。
   */
  gateRunner?: (plan: PlanResult, sceneData: Record<string, unknown> | null) => Promise<GateResult>
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
  /** 末轮 9a 门控结果（gateRunner 提供时；undefined=循环内没跑门控，host 自行跑） */
  gatePassed?: boolean
  /** 末轮 9a 门控 findings（失败时 error 级清单，供 host 落失败卡片 + stash 手动重试） */
  gateFindings?: GateFinding[]
  error?: string
}

export async function codegen_scene(input: CodegenSceneInput): Promise<CodegenSceneResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated, fileParts, hasScene, sceneDir, sdkDir, onCodeReady, onMaterialize, onEnvMaterialize, priorGateFindings, gateRunner } =
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

  // 4~7. codegen → parse → 语法检查 → merge → 物化 → 门控 自愈循环（P0.4，最多 3 次）：
  //   - 代码错（语法 PARSE_ERROR + 语义 continue/break/return outside）：物化前
  //     ts.createProgram(noLib) 抓（~240ms），file:line:col:reason 喂回 codegen 重写，
  //     不进 materialize→startDev→iframe→门控兜底慢链。语义错（transpileModule 抓不到的）
  //     是高频根因（continue outside loop 实证频发），升级 createProgram 后物化前拦截。
  //   - 运行时错（continue outside loop 等语义错，transpile 不报）：物化后 gateRunner 跑 9a 门控
  //     抓 SCENE_CONSOLE_ERROR，findings 喂回 codegen 重写（重新物化）。
  //   - 两类错共用同一循环：重跑的只是 codegen 步（triage/plan 不重跑），每轮 priorSyntaxErrors /
  //     priorGateFindings 喂回让 LLM 照着修。语法错重试有效（确定性错误+精确行号）；墙钟超时/API 错
  //     不在此重试（P1.2 不变——同模型同 prompt 重试无效）。
  //   - P0.10：scene-not-ready（SCENE_READY 握手超时）已删——握手竞态致误报，失败改靠
  //     SCENE_ERROR/SCENE_CONSOLE_ERROR 确定性事件（runtime-error/scene-build-error 才重试）。
  //   - scoped 重试（P0.5）：重试轮只让 LLM 重输出出错文件（`## 本轮输出范围`），未出错文件 host 端
  //     overlay 复用上一轮（LLM 忽略范围全量输出也兼容——按新输出覆盖同路径，结果一致）。
  //     重试输出 token 随出错文件数收敛，砍 retry 墙钟 + 减少全量重写引入新错。
  const MAX_SELF_HEAL_RETRIES = 3
  const summary = plan.scene_description?.slice(0, 80) || userInput.slice(0, 80)
  let files: CodeFile[] = []
  let sceneData: Record<string, unknown> | null = null
  let priorSyntaxErrors: SyntaxError[] | undefined
  let feedbackGateFindings: GateFinding[] | undefined
  let lastGatePassed: boolean | undefined
  let lastGateFindings: GateFinding[] | undefined
  // scoped 重试（P0.5）：上一轮产物（复用基底）+ 本轮只需重输出的文件名清单（undefined=全量输出）
  let prevRoundFiles: CodeFile[] | undefined
  let retryScopeFiles: string[] | undefined
  // live-data.json 缺失轮的反馈标志（P0.8：6b 截断自愈，见下）
  let liveDataMissing: boolean | undefined

  for (let attempt = 1; attempt <= MAX_SELF_HEAL_RETRIES; attempt++) {
    const retryReason = priorSyntaxErrors
      ? "，喂回语法错误清单自愈"
      : feedbackGateFindings
        ? "，喂回门控失败清单自愈"
        : liveDataMissing
          ? "，补 live-data.json（scoped）"
          : ""
    console.log(`[codegen_scene] ③ codegen 生成代码中…（第 ${attempt}/${MAX_SELF_HEAL_RETRIES} 次${retryReason}）`)
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
      priorGateFindings: attempt === 1 ? priorGateFindings : feedbackGateFindings,
      priorSyntaxErrors,
      retryScopeFiles,
      liveDataMissing,
    })

    // 5+6. 先解析 Markdown → files + sceneData，再判 codegen 失败（API 错误 / 限流 / 超上下文 /
    //       墙钟掐断）——P1.4③ 部分输出抢救需要 parse 结果才能判可恢复性。失败且不可抢救 →
    //       透传 error 给 host，由 handleSubmit 写进 sessionErrors → GenerationCard 持久显示
    //       失败卡片（不靠会消失的 toast）。
    files = parseCodeFiles(codegenRes.text)
    // ⑥0. scoped 重试 overlay（P0.5）：上一轮已校验通过的文件直接复用，LLM 本轮只重输出出错文件
    //     （`## 本轮输出范围` 指定）。LLM 忽略范围全量输出也兼容——按新输出覆盖同路径，结果一致。
    //     live-data.json 未重输出时沿用上一轮（sceneData 从 merged files 抽取，不因 scoped 误报「未输出」）。
    if (retryScopeFiles && prevRoundFiles && files.length > 0) {
      const rawPaths = new Set(files.map((f) => f.path.replace(/\\/g, "/")))
      const merged = overlayCodeFiles(prevRoundFiles, files)
      const reused = merged.filter((f) => !rawPaths.has(f.path.replace(/\\/g, "/"))).length
      files = merged
      console.log(
        `[codegen_scene] ⑥0 scoped 重试 merge：LLM 重输出 ${rawPaths.size} 个文件，复用上一轮 ${reused} 个未出错文件`,
      )
    }
    sceneData = extractSceneData(files)
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
    if (files.length === 0) {
      // 打印原始输出便于诊断（LLM 是否产了代码块 / 是否落在 reasoning / 是否只产自然语言 / 是否 token 截断）
      console.error(
        `[codegen_scene] parseCodeFiles 返回 0 个文件。text.length=${codegenRes.text.length}（若很大且无 ## file: → 疑似 LLM reasoning 占满 output token，代码块未产出）`,
      )
      console.error(`[codegen_scene] 输出前 2000 字符:\n`, codegenRes.text.slice(0, 2000))
      console.error(`[codegen_scene] 输出后 2000 字符（看有无 ## file: 或截断断点）:\n`, codegenRes.text.slice(-2000))
      return { routing: triage.routing, error: "LLM 未输出有效的 ## file: 代码块" }
    }

    // 6b. live-data.json 缺失/不可解析：进 scoped 自愈（P0.8），不再灾难性短路。高发诱因=输出
    //     超长截断（finish=length，实证 ses_f9a31aa61：14 type 场景 reasoning 烧 43K + 正文 20K
    //     打满 output 上限，正文在最后一个 handler 中途掐断，live-data.json/index.ts 排队尾没
    //     轮到）。已写好的 handler 直接复用（prevRoundFiles），scoped 只重输出 live-data.json
    //     （+index.ts 若缺）+ 截断文件——重输出预算只需零头，不再撞上限。
    if (!sceneData) {
      const truncatedErrors = checkHandlerSyntax(files)
      const truncated = [...new Set(truncatedErrors.map((e) => e.file))] // 语法错=截断铁证
      if (attempt < MAX_SELF_HEAL_RETRIES) {
        prevRoundFiles = files
        retryScopeFiles = buildLiveDataScope(files, truncated)
        liveDataMissing = true
        // 截断文件的语法错一并喂回（file:line:col 告诉 LLM 断点），LLM 按清单 + 范围重输出
        priorSyntaxErrors = truncatedErrors.length > 0 ? truncatedErrors : undefined
        console.warn(
          `[codegen_scene] ⑥b live-data.json 未输出/不可解析（第 ${attempt}/${MAX_SELF_HEAL_RETRIES} 次，疑似输出超长截断，截断文件: ${truncated.join(", ") || "无"}）→ scoped 自愈：只重输出 ${retryScopeFiles.join(" + ")}`,
        )
        continue
      }
      console.error("[codegen_scene] extractSceneData 返回 null：LLM 未产 live-data.json 或不可解析")
      return { routing: triage.routing, error: "LLM 未输出 live-data.json 或不可解析" }
    }
    if (liveDataMissing) {
      console.log("[codegen_scene] ⑥b live-data 自愈成功（本轮补齐）")
      liveDataMissing = undefined
    }

    // 6a. 物化前静态代码检查：语法错 + 语义错（continue/break/return outside 等）立即拦截 + 喂回自愈
    const syntaxErrors = checkHandlerSyntax(files)
    if (syntaxErrors.length > 0) {
      if (attempt < MAX_SELF_HEAL_RETRIES) {
        console.warn(
          `[codegen_scene] ⑥a 代码检查 ${syntaxErrors.length} 个错（第 ${attempt}/${MAX_SELF_HEAL_RETRIES} 次），喂回 codegen 自愈重试：`,
          syntaxErrors.map((e) => `${e.file}:${e.line}:${e.column} ${e.message} (code ${e.code})`),
        )
        priorSyntaxErrors = syntaxErrors
        prevRoundFiles = files
        retryScopeFiles = computeSyntaxScope(syntaxErrors, files)
        continue
      }
      const detail = syntaxErrors.map((e) => `${e.file}:${e.line}:${e.column}: ${e.message} (code ${e.code})`).join("；")
      console.error(`[codegen_scene] ⑥a 代码检查 ${MAX_SELF_HEAL_RETRIES} 次仍失败，放弃自愈：`, detail)
      return {
        routing: triage.routing,
        error: `生成的 handler .ts 存在代码错误（已自动重试 ${MAX_SELF_HEAL_RETRIES} 次未修复）：${detail}`,
      }
    }
    if (priorSyntaxErrors) {
      console.log(`[codegen_scene] ⑥a 代码自愈成功（第 ${attempt} 次修复了 ${priorSyntaxErrors.length} 个代码错）`)
      priorSyntaxErrors = undefined // 已修干净，不带陈旧清单进下一轮（gate 重试轮）
    }
    console.log(
      `[codegen_scene] parseCodeFiles 解析到 ${files.length} 个文件:`,
      files.map((f) => f.path),
    )
    console.log(`[codegen_scene] extractSceneData:`, sceneData ? `非空 (keys=${Object.keys(sceneData).join(",")})` : "空")

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

    // 8. 9a 门控（gateRunner 由 host 提供：固定延迟 settleMs + 读 consoleBuffer）。
    //    运行时错（continue outside loop / undefined 访问）喂回 codegen 自愈重试（重新物化）；
    //    无运行时错则通过（P0.10：删 scene-not-ready 握手超时误报，失败靠 SCENE_ERROR/SCENE_CONSOLE_ERROR 确定性事件）。
    if (gateRunner) {
      const gate = await gateRunner(plan, sceneData)
      lastGatePassed = gate.passed
      lastGateFindings = gate.findings
      console.log(`[codegen_scene] ⑧ 9a 门控（第 ${attempt} 次）:`, gate.passed ? "PASS" : "FAIL", gate.findings)
      if (!gate.passed) {
        const retryable = gate.findings.some(
          (f) => f.level === "error" && (f.code === "runtime-error" || f.code === "scene-build-error"),
        )
        if (retryable && attempt < MAX_SELF_HEAL_RETRIES) {
          console.warn(`[codegen_scene] ⑧ 门控失败（运行时错可自愈），第 ${attempt} 次喂回 codegen 重试`)
          feedbackGateFindings = gate.findings
          prevRoundFiles = files
          retryScopeFiles = extractGateScope(gate.findings)
          continue
        }
      }
    }
    break
  }

  return {
    routing: triage.routing,
    summary,
    plan,
    sceneData,
    gatePassed: lastGatePassed,
    gateFindings: lastGateFindings,
  }
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

/** scoped 重试 overlay（P0.5）：上一轮产物为基底，新输出按路径覆盖；未重输出的文件沿用上一轮版本。 */
function overlayCodeFiles(base: CodeFile[], overlay: CodeFile[]): CodeFile[] {
  const byPath = new Map<string, CodeFile>()
  for (const f of base) byPath.set(f.path.replace(/\\/g, "/"), f)
  for (const f of overlay) byPath.set(f.path.replace(/\\/g, "/"), f)
  return [...byPath.values()]
}

/** 语法错 scoped 范围：出错文件名去重。全部 .ts 都出错时 scoped 无收益（等于全量）→ 返 undefined。 */
function computeSyntaxScope(syntaxErrors: SyntaxError[], files: CodeFile[]): string[] | undefined {
  const scope = [...new Set(syntaxErrors.map((e) => e.file))]
  const tsBasenames = new Set(
    files.filter((f) => f.path.endsWith(".ts")).map((f) => f.path.replace(/\\/g, "/").split("/").pop() ?? ""),
  )
  if (scope.length >= tsBasenames.size) return undefined
  return scope
}

/** live-data 缺失轮 scoped 范围（P0.8）：live-data.json + index.ts（缺时）+ 截断文件（语法错铁证）。 */
function buildLiveDataScope(files: CodeFile[], truncatedFiles: string[]): string[] {
  const scope = ["public/live-data.json"]
  const hasIndex = files.some((f) => f.path.replace(/\\/g, "/").endsWith("handlers/index.ts"))
  if (!hasIndex) scope.push("src/3d/managers/component/handlers/index.ts")
  return [...scope, ...truncatedFiles]
}

/** 门控运行时错 scoped 范围：从 findings message 抽 `.ts` 文件名（console 报错带 vite URL/栈定位）。
 *  抽不到（如纯完整性缺 type，不指向文件）→ 返 undefined 走全量输出。 */
function extractGateScope(findings: GateFinding[]): string[] | undefined {
  const names = new Set<string>()
  for (const f of findings) {
    if (f.level !== "error" || (f.code !== "runtime-error" && f.code !== "scene-build-error")) continue
    for (const m of f.message.matchAll(/([\w./\\-]+\.ts)\b/g)) {
      const name = m[1].split(/[\\/]/).pop()
      if (name) names.add(name)
    }
  }
  return names.size > 0 ? [...names] : undefined
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
