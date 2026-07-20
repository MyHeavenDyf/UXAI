import { getDesktopApi } from "./desktop-api"

// agent 名称 → 中文标签映射，用于错误展示时标识出错的 agent 步骤
export const AGENT_LABELS: Record<string, string> = {
  proto_intent_confirm: "意图确认",
  proto_pattern_page: "Pattern 匹配",
  proto_intent: "意图扩展",
  proto_planner_create: "布局规划",
  proto_module_create: "模块生成",
  proto_triage: "需求分析",
  proto_wireframes: "分诊",
  proto_modify: "页面修改",
  proto_planner_modify: "布局修改",
  proto_module_modify: "模块修改",
  proto_intent_audit: "意图审核",
  proto_pattern_block: "模块匹配",
}

/**
 * 持久化的错误对象，存入 proto_error.json。
 * - title:      错误标题（如"认证失败"），由 classifyAIError 生成
 * - agentLabel: agent 中文标签（如"意图确认 · Hero"），用于 UI 展示
 * - agentCallId: 报错 agent 的 childSessionId，用于匹配 InsightTurn 步骤卡片
 */
export type ProtoError = { title: string; agentLabel?: string; agentCallId?: string }

/**
 * 带 agent 标识的错误类型，在标准 Error 上扩展三个字段：
 * - agentName:    agent 原始名称（如 "proto_module_create"）
 * - agentCallId:  报错 agent 的 childSessionId，唯一标识一次调用
 * - agentContext: 补充上下文（如并行的 sectionId），拼入 agentLabel 展示
 */
export type AgentError = Error & { agentName?: string; agentCallId?: string; agentContext?: string }

/**
 * 创建并抛出一个带 agent 标识的错误。
 * 在各 agent 的 JSON 解析失败、手动报错等场景调用，
 * 确保抛出的 Error 携带 agentName + agentCallId 供上层定位。
 */
export function agentThrow(agentName: string, sessionId: string, message: string): never {
  const err = new Error(message) as AgentError
  err.agentName = agentName
  err.agentCallId = sessionId
  throw err
}

/**
 * 包裹一个异步调用，捕获错误后补充 agentName + agentContext 再 re-throw。
 * 作为 workflow 层的安全网：即使内部忘记打标，外层也能兜底。
 * 仅在错误尚未标记时补充，不覆盖已有的 agentName / agentCallId。
 *
 * @param agentName agent 原始名称
 * @param fn        被包裹的异步函数（通常是 agent 调用）
 * @param context   补充上下文（如并行模块的 sectionId），拼入 agentLabel
 */
export function withAgentError<T>(agentName: string, fn: () => Promise<T>, context?: string): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof Error) {
      const augmented = err as AgentError
      if (!augmented.agentName) augmented.agentName = agentName
      if (context && !augmented.agentContext) augmented.agentContext = context
    }
    throw err
  })
}

/**
 * 从错误对象中提取 agent 中文标签。
 * 格式: "布局规划" 或 "模块生成 · Hero"（含 agentContext 时用 · 分隔）。
 */
function agentLabelOf(err: unknown): string | undefined {
  const e = err as AgentError
  if (!e?.agentName) return undefined
  const base = AGENT_LABELS[e.agentName] ?? e.agentName
  const parts = [base]
  if (e.agentContext) parts.push(e.agentContext)
  return parts.join(" · ")
}

/**
 * 将原始错误分类为用户友好的 { title, description }。
 * 按错误消息关键词匹配 7 种类型：认证失败 / Token 超限 / 网络错误 /
 * JSON 解析失败 / 生成异常 / 会话异常 / 生成失败（兜底）。
 * 同时透传 agentLabel 和 agentCallId 供上层存储与展示。
 *
 * @returns title 为空字符串时表示"用户主动取消"，不展示错误
 */
export function classifyAIError(err: unknown): { title: string; description: string; agentLabel?: string; agentCallId?: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === "aborted") return { title: "", description: "" }
  const agentLabel = agentLabelOf(err)
  const agentCallId = (err as AgentError)?.agentCallId
  if (msg.includes("ProviderAuthError") || msg.includes("401") || msg.includes("403") || msg.includes("unauthorized"))
    return { title: "认证失败", description: "API Key 无效或已过期，请检查模型配置", agentLabel, agentCallId }
  if (msg.includes("token") || msg.includes("ContextOverflowError") || msg.includes("MessageOutputLengthError"))
    return { title: "Token 超限", description: "上下文长度超出模型限制，请尝试简化输入内容", agentLabel, agentCallId }
  if (msg.includes("APIError") || msg.includes("fetch") || msg.includes("network") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("timeout"))
    return { title: "网络错误", description: "网络连接异常，请检查网络后重试", agentLabel, agentCallId }
  if (msg.includes("not return valid JSON") || msg.includes("SyntaxError") || msg.includes("Unexpected token") || msg.includes("JSON.parse"))
    return { title: "JSON 解析失败", description: "AI 返回的 Json 数据格式异常，请重试", agentLabel, agentCallId }
  if (msg.includes("element_id") || msg.includes("rootId") || msg.includes("Planner"))
    return { title: "生成异常", description: "AI 生成的组件 ID 不一致，请尝试重新生成", agentLabel, agentCallId }
  if (msg.includes("Failed to create session") || msg.includes("Failed to get") || msg.includes("session"))
    return { title: "会话异常", description: "Session 创建或获取失败，请重试", agentLabel, agentCallId }
  return { title: "生成失败", description: msg.length > 150 ? msg.slice(0, 150) + "..." : msg, agentLabel, agentCallId }
}

// ── 持久化：proto_error.json 读写 ──────────────────────────
// 存储路径: {项目目录}/.octo/design/history/{rootSessionId}/proto_error.json
// 文件格式: { error: string, agent: string, callId: string, createdAt: number }

function errorFilePath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/proto_error.json`
}

/**
 * 将错误信息写入本地 proto_error.json。
 * 在 handleWorkflowError 报错时调用，用于刷新后恢复错误状态。
 */
export async function saveProtoError(dir: string, sessionId: string, error: ProtoError): Promise<void> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  const payload = JSON.stringify({ error: error.title, agent: error.agentLabel, callId: error.agentCallId, createdAt: Date.now() })
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

/**
 * 从本地读取 proto_error.json，恢复错误状态。
 * 兼容旧格式（纯字符串）和新格式（{ error, agent, callId } 对象）。
 * 在切回 session 时调用（sync.session.sync 完成后）。
 */
export async function loadProtoError(dir: string, sessionId: string): Promise<ProtoError | null> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      const data = JSON.parse(new TextDecoder().decode(buf))
      if (typeof data === "string") return { title: data }
      return { title: data.error ?? "", agentLabel: data.agent, agentCallId: data.callId }
    } catch {
      return null
    }
  }
  return null
}

/**
 * 删除 proto_error.json。
 * 在重试 / 新建生成 / halt 时调用，清除旧的错误状态。
 */
export async function clearProtoError(dir: string, sessionId: string): Promise<void> {
  const api = getDesktopApi()
  const path = errorFilePath(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(path).catch(() => {})
  }
}
