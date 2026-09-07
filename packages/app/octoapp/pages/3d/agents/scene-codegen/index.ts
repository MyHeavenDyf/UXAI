/**
 * scene_3d_codegen_direct —— 3D codegen Direct 单次直出（无 plan 无自愈）
 *
 * 读 [TYPE_LIST]（纯 type 名数组，无 build_detail——尺寸/坐标/结构全由 LLM 自己设计）
 * + [USER_REQUEST] + [ASSET_CATALOG] + [CURRENT_HANDLERS]/[CURRENT_GROUPS]（modify 时照抄布局），
 * 产 Markdown 代码块（## file: <path> + fenced code）：
 *   - handlers/<type>/<type>.ts（每个 type 一份 ComponentHandler）
 *   - <type>.group.json（每个 type 的根节点清单）
 *   - scene-config.json（camera/lights/scene，host 提取填进 DirectPlan）
 * host 用 parseCodeFiles 解析 + buildHandlersIndex/buildLiveData 确定性合并
 * index.ts / live-data.json（不再由 LLM 写全量，根治 index 合并竞态）。
 * 输出非 JSON，故 schema=undefined 跳过 validateSchema。
 *
 * 旧 3-agent 流水线 plan + pertype/full + 自愈循环已随 direct 落地全清删除
 * （单次 codegen 30-60s 替代 plan+并行/全量+自愈 32-50min）。
 */
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { SceneCreateInput } from "../../workflow/scene-create-input"
import { formatGateFindingsForCodegen, type GateFinding } from "../../utils/scene-gate"
import { formatSyntaxErrorsForCodegen, type SyntaxError } from "../../utils/parse-check"

const DIRECT_AGENT_NAME = "scene_3d_codegen_direct"

export type SceneCodegenDirectInput = SceneCreateInput & {
  /** 本轮要写的 type 名数组（create + modify 合并，LLM 各自处理） */
  types: string[]
  /** 是否 modify（注入各 type 的 [CURRENT_HANDLERS]/[CURRENT_GROUPS]） */
  isModify: boolean
  /** modify 时本轮要写 type 的当前 handler 源码（type -> 源码，照抄布局参数） */
  currentHandlers?: Record<string, string>
  /** modify 时本轮要写 type 的当前分组片段（type -> group JSON） */
  currentGroups?: Record<string, string>
  /** 上一轮语法错（本轮出错 type 的，file:line:col:reason） */
  priorSyntaxErrors?: SyntaxError[]
  /** 上一轮门控失败清单（本轮出错 type 的运行时错） */
  priorGateFindings?: GateFinding[]
  /** 可用资产清单（workspace assetCatalog.ts 源码，注入 [ASSET_CATALOG]） */
  assetCatalog?: string
}

export interface SceneCodegenDirectResult {
  text: string
  childSessionId: string
  error?: string
}

export async function scene_3d_codegen_direct(
  input: SceneCodegenDirectInput,
): Promise<SceneCodegenDirectResult> {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    onSessionCreated,
    userInput,
    types,
    isModify,
    currentHandlers,
    currentGroups,
    priorSyntaxErrors,
    priorGateFindings,
    assetCatalog,
  } = input
  const humanMessage = buildDirectHumanMessage(
    userInput,
    types,
    isModify,
    currentHandlers,
    currentGroups,
    priorSyntaxErrors,
    priorGateFindings,
    assetCatalog,
  )
  const startTime = Date.now()
  const codegenRes = await runChildSession({
    sync,
    modelKey,
    agent: DIRECT_AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    // direct 输出 Markdown 代码块（每个 type 一对 handler + group.json + 1 个 scene-config.json），不传 schema
    schema: undefined,
    // reasoning 模型（GLM-5.2）复杂场景（13-type 上海地图）reasoning 阶段可达 6min+，
    // reasoning 收完到 text 输出之间有组织间隙——默认 180s idle 会在此间隙误杀会话
    // （ses_f85efc69：6min reasoning 89K chars 收完后 text=0 超 180s → idle abort）。
    // 420s 给 reasoning→text 转换留足余量；reasoning 期间靠 resync 周期续命不触发 idle。
    idleTimeoutMs: 420_000,
    onSessionCreated,
    extra: input.extra,
    fileParts: input.fileParts,
  })
  console.log(`[direct] ${types.join(",")} codegen 耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
  logAgentParsed(codegenRes.childSessionId, {
    summary: `direct codegen ${types.length} types 产出 ${codegenRes.text.length} 字符`,
  })
  return { text: codegenRes.text, childSessionId: codegenRes.childSessionId, error: codegenRes.error }
}

function buildDirectHumanMessage(
  userInput: string,
  types: string[],
  isModify: boolean,
  currentHandlers?: Record<string, string>,
  currentGroups?: Record<string, string>,
  priorSyntaxErrors?: SyntaxError[],
  priorGateFindings?: GateFinding[],
  assetCatalog?: string,
): string {
  const lines = [
    `[TYPE_LIST]:`,
    JSON.stringify(types, null, 2),
    ``,
    `[USER_REQUEST]: ${userInput}`,
    ``,
  ]
  if (assetCatalog) {
    lines.push(
      `[ASSET_CATALOG]（下方 assetCatalog.ts 源码；model 路线 src 用 asset:<id>，id 取自清单真实条目，勿臆造）:`,
      "```ts",
      assetCatalog,
      "```",
      ``,
    )
  }
  if (isModify) {
    // [CURRENT_HANDLERS]：按 ## file 分节，只含本轮要写的 type（照抄布局参数）
    const handlerSections = types
      .map((type) => {
        const src = currentHandlers?.[type]
        if (src == null) return null
        return `## file: src/3d/managers/component/handlers/${type}/${type}.ts\n${src.trim()}`
      })
      .filter((s): s is string => s != null)
      .join("\n\n")
    if (handlerSections) {
      lines.push(
        `[CURRENT_HANDLERS]（本轮要写 type 的当前 handler，按 ## file 分节，照抄布局参数，勿擅改）:`,
        handlerSections,
        ``,
      )
    }
    // [CURRENT_GROUPS]：按 type 分节（根节点 id 照抄勿换）
    const groupSections = types
      .map((type) => {
        const g = currentGroups?.[type]
        if (g == null) return null
        return `<type>.group.json（type=${type}）:\n${g.trim()}`
      })
      .filter((s): s is string => s != null)
      .join("\n\n")
    if (groupSections) {
      lines.push(
        `[CURRENT_GROUPS]（本轮要写 type 的当前分组片段，根节点 id 照抄勿换）:`,
        groupSections,
        ``,
      )
    }
  }
  // 语法错 / 门控错喂回（本轮出错 type 的，host 侧已按 type 过滤）
  const syntaxSection = formatSyntaxErrorsForCodegen(priorSyntaxErrors ?? [])
  if (syntaxSection) lines.push(syntaxSection, ``)
  const gateSection = formatGateFindingsForCodegen(priorGateFindings ?? [])
  if (gateSection) lines.push(gateSection, ``)
  return lines.join("\n")
}
