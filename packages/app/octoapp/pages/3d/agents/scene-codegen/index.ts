/**
 * scene_3d_codegen —— 3D codegen 3-agent 之「生成」
 * 读 plan JSON（[PLAN_JSON]）+ 用户请求（[USER_REQUEST]），modify 时附 [CURRENT_HANDLERS] /
 * [CURRENT_LIVE_DATA]，产 Markdown 代码块（## file: <path> + fenced code）：
 *   - handlers/<type>/<type>.ts（每 type 一份 ComponentHandler）
 *   - handlers/index.ts（全量，模板 5 + 本轮新增）
 *   - public/live-data.json（全量分组 TreeScene + camera/lights/scene）
 * 输出非 JSON，故 schema=undefined 跳过 validateSchema。host 用 parseCodeFiles 解析。
 */
import { runChildSession } from "../run-child-session"
import { logAgentParsed } from "../../utils/debug-log"
import type { SceneCreateInput } from "../../workflow/create-scene"
import type { PlanResult } from "../scene-plan"
import { formatGateFindingsForCodegen, type GateFinding } from "../../utils/scene-gate"
import { formatSyntaxErrorsForCodegen, type SyntaxError } from "../../utils/parse-check"

const AGENT_NAME = "scene_3d_codegen"

export type SceneCodegenInput = SceneCreateInput & {
  /** plan 产物（types 选型 + camera/lights/scene） */
  plan: PlanResult
  /** 是否 modify（注入 [CURRENT_HANDLERS] / [CURRENT_LIVE_DATA]） */
  isModify: boolean
  /** modify 时当前全部 handler 源码（含 index.ts），create 时空字符串 */
  currentHandlers?: string
  /** modify 时当前 live-data.json 内容，create 时空字符串 */
  currentLiveData?: string
  /** 上一轮 9a 门控失败清单（host 喂回），buildHumanMessage 拼 `## 上一轮门控失败清单` 段 */
  priorGateFindings?: GateFinding[]
  /** 上一轮语法检查错误清单（P0.4 自愈循环喂回），拼 `## 上一轮代码错误清单` 段（file:line:col:reason） */
  priorSyntaxErrors?: SyntaxError[]
  /** scoped 重试范围（P0.5）：本轮只需重输出的文件名清单，拼 `## 本轮输出范围` 段；undefined=全量输出 */
  retryScopeFiles?: string[]
  /** 上一轮 live-data.json 未输出/不可解析（P0.8 截断自愈喂回），拼 `## 上一轮问题` 段 */
  liveDataMissing?: boolean
}

export interface SceneCodegenResult {
  /** codegen agent 的原始 Markdown 输出（## file: + fenced code），host 用 parseCodeFiles 解析 */
  text: string
  childSessionId: string
  error?: string
}

export default async function scene_3d_codegen(input: SceneCodegenInput): Promise<SceneCodegenResult> {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    onSessionCreated,
    userInput,
    plan,
    isModify,
    currentHandlers,
    currentLiveData,
    priorGateFindings,
    priorSyntaxErrors,
    retryScopeFiles,
    liveDataMissing,
  } = input
  const humanMessage = buildHumanMessage(
    userInput,
    plan,
    isModify,
    currentHandlers,
    currentLiveData,
    priorGateFindings,
    priorSyntaxErrors,
    retryScopeFiles,
    liveDataMissing,
  )
  console.log("----- 3D 代码生成Agent开始执行 ----- ")
  const startTime = Date.now()
  const codegenRes = await runChildSession({
    sync,
    modelKey,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    // codegen 输出 Markdown 代码块（非 JSON），不传 schema 跳过 validateSchema
    schema: undefined,
    onSessionCreated,
    extra: input.extra,
    fileParts: input.fileParts,
  })
  console.log("----- 3D 代码生成Agent运行结束，耗时：", (Date.now() - startTime) / 1000, "s -----")
  logAgentParsed(codegenRes.childSessionId, { summary: `codegen 产出 ${codegenRes.text.length} 字符` })
  return { text: codegenRes.text, childSessionId: codegenRes.childSessionId, error: codegenRes.error }
}

function buildHumanMessage(
  userInput: string,
  plan: PlanResult,
  isModify: boolean,
  currentHandlers?: string,
  currentLiveData?: string,
  priorGateFindings?: GateFinding[],
  priorSyntaxErrors?: SyntaxError[],
  retryScopeFiles?: string[],
  liveDataMissing?: boolean,
): string {
  const lines = [`[PLAN_JSON]:`, JSON.stringify(plan, null, 2), ``, `[USER_REQUEST]: ${userInput}`, ``]
  if (isModify) {
    lines.push(`[CURRENT_HANDLERS]:`, currentHandlers?.trim() || `（无）`, ``)
    lines.push(`[CURRENT_LIVE_DATA]:`, currentLiveData?.trim() || `（无）`, ``)
  }
  // P0.8 live-data 截断自愈：上一轮输出超长被截断（finish=length），handler 代码块已产出部分
  // 文件但 live-data.json / index.ts 排队尾没轮到，或 live-data 本身截断不可解析。
  if (liveDataMissing) {
    lines.push(
      `## 上一轮问题：public/live-data.json 未输出或不可解析`,
      `上一轮已产出部分 handler .ts 文件（系统将校验后直接复用，勿重复输出），但 public/live-data.json 没有输出或被截断无法解析——最常见原因是上一轮输出超长被截断。`,
      `本轮严格按「## 本轮输出范围」只输出列出的文件；live-data.json 必须完整收尾（以 [PLAN_JSON] 为准：全部 type 分组 + camera / lights / scene），代码块必须闭合。`,
      ``,
    )
  }
  // P0.4 语法自愈：TS 编译器抓的语法错清单（file:line:col:reason），让 LLM 照着精确修
  const syntaxSection = formatSyntaxErrorsForCodegen(priorSyntaxErrors ?? [])
  if (syntaxSection) lines.push(syntaxSection, ``)
  // 9a 门控失败清单喂回（仅重试时非空）：让 codegen 照着修 vue-tsc 错 / 完整性缺 type / 运行时错
  const gateSection = formatGateFindingsForCodegen(priorGateFindings ?? [])
  if (gateSection) lines.push(gateSection, ``)
  // P0.5 scoped 重试：只重输出出错文件，其余 host 端 overlay 复用上一轮（砍 retry 耗时 + 防全量重写引入新错）
  if (retryScopeFiles && retryScopeFiles.length > 0) {
    lines.push(
      `## 本轮输出范围（只改有错的文件）`,
      `上一轮其余文件已校验通过、将由系统直接复用。本轮**只需重新输出以下文件**，不要重复输出未列出的文件：`,
      ...retryScopeFiles.map((f) => `- ${f}`),
      ``,
      `（仅当你判断修复必须连带修改其他文件时，才可将其一并输出，系统按新输出覆盖。）`,
      ``,
    )
  }
  return lines.join("\n")
}
