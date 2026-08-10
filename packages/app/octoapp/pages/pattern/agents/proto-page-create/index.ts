import { extractJson } from '../../utils/json-parser';
import { runChildSession } from '../run-child-session';
import { logAgentParsed } from "../../utils/debug-log";
import { PAGE_CREATE_FORMAT } from "./schema";
import { agentThrow } from "../../utils/error-msg";

const AGENT_NAME = "proto_page_create";

type BlockPattern = {
  name?: string
  patternId: string
  description?: string
  // 预制好的完整 A2UI 子树：{ state, rootId, elements }
  content?: any
}

type ProtoPageCreateInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户需求（已含附件描述）
  userInput: string
  // 透传到工具 ctx.extra 的数据（如 designSystem）
  extra?: Record<string, unknown>
  // 用户选中的模块模板（block patterns）
  patterns?: BlockPattern[]
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_page_create(input: ProtoPageCreateInput) {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput,
    patterns,
    onSessionCreated
  } = input

  const humanMessage = buildHumanMessage(userInput, patterns)
  console.log("----- 整页生成Agent开始执行 ----- ");
  const startTime = Date.now()
  // 执行整页生成
  const moduleResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
    extra: input.extra,
    schema: PAGE_CREATE_FORMAT.schema,
  })
  console.log("----- 整页生成Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 拦底层错误：moduleResult.error 携带 opencode 报错（限流/超限/网络/认证等）
  if (moduleResult.error) {
    logAgentParsed(moduleResult.childSessionId, { error: moduleResult.error, raw: moduleResult.text })
    agentThrow(AGENT_NAME, moduleResult.childSessionId, `Page generation error: ${moduleResult.error}`)
  }
  // 模型正常返回但输出无法解析为 JSON 的错误
  const pageJson = extractJson(moduleResult.text)
  if (!pageJson) {
    logAgentParsed(moduleResult.childSessionId, { error: "Failed to parse JSON", raw: moduleResult.text })
    agentThrow(AGENT_NAME, moduleResult.childSessionId, "Page JSON did not return valid JSON")
  }
  const returnValue = { ui_json: pageJson }
  logAgentParsed(moduleResult.childSessionId, returnValue)
  return returnValue
}

// 组装整页生成的输入文本
function buildHumanMessage(userInput: string, patterns?: BlockPattern[]): string {
  let patternsSection = ""
  if (patterns && patterns.length > 0) {
    const blocks = patterns.map((p, i) => ({
      name: p.name ?? `模块模板${i + 1}`,
      patternId: p.patternId,
      description: p.description ?? "",
      content: p.content,
    }))
    patternsSection = `

  [选中的模块模板 (Selected Block Patterns):] ==================================
  以下每个模板是预制好的 A2UI 子树（含 state/rootId/elements）。必须把每个模板嵌入最终页面：
  - 其 elements 全部并入页面 elements 数组；
  - 其 state 并入页面 state；
  - 其 root 作为页面中某个容器的子节点；
  - 把其中的占位数据改写为贴合业务的真实 mock 数据，但结构与组件用法保持不变；
  - 如有 id 冲突则重命名，保证整页 id 唯一。

  ${JSON.stringify(blocks, null, 2)}`
  }
  return `请根据以下需求，一次性生成完整的 A2UI 页面 JSON（state -> rootId -> elements）：

  [用户需求:] ==================================
  ${userInput}${patternsSection}

  请先调用 *load_components_docs* 工具查询所需组件 API，然后生成整页 JSON。`
}
