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
import { loadCurrentSceneState } from "../utils/version-history"
import { getDesktopApi } from "../utils/desktop-api"
import type { SceneCreateInput } from "./create-scene"
import type { GateFinding } from "../utils/scene-gate"

const RESERVED_TYPES = new Set(["version", "scene", "camera", "lights", "remove"])

export type CodegenSceneInput = SceneCreateInput & {
  /** 是否已有场景（host 据 lastSceneObjects.length 预判；triage 做最终 routing） */
  hasScene: boolean
  /** 场景历史目录（sceneHistoryDir()），供读当前状态 + codeDir */
  sceneDir: string
  /** codegen 产物回调 → onCodeVersionReady（物化 + 预览） */
  onCodeReady: (files: CodeFile[], sceneData: Record<string, unknown> | null, summary: string) => Promise<void>
  /** 上一轮 9a 门控失败清单（来自 handleRetry 喂回），注入 codegen 让其照着修 */
  priorGateFindings?: GateFinding[]
}

export interface CodegenSceneResult {
  routing: "create" | "modify" | "chat"
  reply?: string
  summary?: string
  plan?: PlanResult
  /** codegen 产出的分组 sceneData（供 host 跑 9a 完整性门控） */
  sceneData?: Record<string, unknown> | null
  error?: string
}

export async function codegen_scene(input: CodegenSceneInput): Promise<CodegenSceneResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated, fileParts, hasScene, sceneDir, onCodeReady, priorGateFindings } =
    input

  // 1. 取当前场景 type 清单（modify 时供 triage 判哪些 type 可改 / 继承）
  const currentTypes = hasScene ? await loadCurrentTypes(sceneDir, rootSession) : []

  // 2. triage：判 routing + types
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
  })
  if (triage.routing === "chat") {
    return { routing: "chat", reply: triage.reply }
  }

  const isModify = triage.routing === "modify"
  // attachment_description 注入用户输入（供 plan / codegen 参考）
  const effectiveUserInput = triage.attachment_description
    ? `[参考内容]: ${triage.attachment_description}\n[用户需求]: ${userInput}`
    : userInput

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
  })

  // 4. codegen：写 handler .ts + 全量 index + 全量 live-data
  //    modify 时从 codeDir 读当前 handler 源码 + live-data 注入 [CURRENT_HANDLERS]/[CURRENT_LIVE_DATA]（create 时不走此路）
  const { currentHandlers, currentLiveData } = isModify
    ? await loadCurrentCode(sceneDir, rootSession)
    : { currentHandlers: "", currentLiveData: "" }

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

  // 5. codegen 失败（API 错误 / 限流 / 超上下文 / LLM 未产文本）→ 透传 error 给 host，
  //    由 handleSubmit 写进 sessionErrors → GenerationCard 持久显示失败卡片（不靠会消失的 toast）。
  if (codegenRes.error) {
    console.error("[codegen_scene] ③ codegen 失败:", codegenRes.error)
    return { routing: triage.routing, error: codegenRes.error }
  }
  // 6. 解析 Markdown → files + sceneData
  const files = parseCodeFiles(codegenRes.text)
  const sceneData = extractSceneData(files)
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

  // 7. 物化 + 预览（onCodeVersionReady：workspace.switchVersion + wsNonce++ + 回填 pendingPreviewData）
  const summary = plan.scene_description?.slice(0, 80) || userInput.slice(0, 80)
  await onCodeReady(files, sceneData, summary)
  return { routing: triage.routing, summary, plan, sceneData }
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
 * modify 时从当前版本 codeDir 读全部 handler .ts 源码 + live-data，
 * 注入 codegen 的 [CURRENT_HANDLERS] / [CURRENT_LIVE_DATA]（供保留未受影响 type）。
 * - currentLiveData：优先取 state.mergedSceneConfig（内存状态，落盘时 = sceneData）。
 * - currentHandlers：读 codeDir 全部 .ts 文件，按 `## file: <path>\n<content>` 拼接（与 codegen 输出格式一致）。
 * 无 codeDir / 非 Electron / 读失败 → 返回空（codegen 盲生成 plan types，可能丢未受影响 type，边界可接受）。
 */
async function loadCurrentCode(
  sceneDir: string,
  sid: string,
): Promise<{ currentHandlers: string; currentLiveData: string }> {
  const state = await loadCurrentSceneState(sceneDir, sid)
  // live-data：优先从内存状态取（onCodeVersionReady 落盘时 mergedSceneConfig = sceneData）
  const currentLiveData = state?.mergedSceneConfig ? JSON.stringify(state.mergedSceneConfig, null, 2) : ""

  const codeDir = state?.codeDir
  const api = getDesktopApi()
  if (!codeDir || !api?.listDirectory || !api?.readFileBuffer) {
    if (!codeDir) {
      console.warn("[codegen_scene] loadCurrentCode: 无 codeDir，modify 无法注入旧 handler（旧版本或落盘失败）")
    }
    return { currentHandlers: "", currentLiveData }
  }
  try {
    const entries = await api.listDirectory(codeDir)
    const tsFiles = entries
      .filter((e) => e.type === "file" && e.path.endsWith(".ts"))
      .map((e) => ({ path: e.path.replace(/\\/g, "/") }))
      .sort((a, b) => a.path.localeCompare(b.path))
    const blocks: string[] = []
    for (const f of tsFiles) {
      const buf = await api.readFileBuffer(`${codeDir}/${f.path}`)
      if (!buf) continue
      blocks.push(`## file: ${f.path}\n${new TextDecoder().decode(buf)}`)
    }
    return { currentHandlers: blocks.join("\n\n"), currentLiveData }
  } catch (e) {
    console.warn("[codegen_scene] loadCurrentCode: 读 codeDir 失败", e)
    return { currentHandlers: "", currentLiveData }
  }
}
