import type { Session } from "@opencode-ai/sdk/v2/client"
import { createRoot, createEffect } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { getResultFromMessages, extractJson } from '../utils/json-parser'
import { logAgentCall } from "../utils/debug-log"
import { validateSchema } from "../utils/schema-validator"
import { type AgentError } from "../utils/error-msg"
import { getDesktopApi } from "../utils/desktop-api"

export type RunChildSessionInput = {
  sync?: any
  client: any
  agent: string
  prompt: string
  isRoot?: boolean
  aborted?: boolean
  directory: string
  parentSessionID: string
  extra?: Record<string, unknown>
  modelKey: { providerID: string; modelID: string } | undefined
  onSessionCreated?: (childSessionID: string) => void
  schema?: Record<string, unknown>
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
}

export async function runChildSession(input: RunChildSessionInput): Promise<{ text: string; childSessionId: string; error?: string }> {
  const {
    sync, // 前后端同步功能
    agent, // 当前正在执行的Agent名称
    extra, // 透传到后端的额外数据
    isRoot, // 是否为根节点
    client, // OpenCode SDK Client
    modelKey, // 当前选择的模型
    directory, // 当前工程运行时指定的文件夹
    parentSessionID, // 根节点 Session ID
    prompt: promptText, // 用户输入提示词
    onSessionCreated, // 创建该 Session 时的回调
    aborted, // 是否需要立即停止，暂未用，全部停止另外写了一个方法
    schema, // JSON Schema 校验模型输出
    fileParts, // 文件附件
  } = input

  const tagError = (err: unknown, sessionId: string) => {
    if (err instanceof Error) {
      const e = err as AgentError
      if (!e.agentName) e.agentName = agent
      if (!e.agentCallId) e.agentCallId = sessionId
    }
  }

  try {
    let childSession: Session | undefined
    if (isRoot) {
      // root session 已经在外面创建好了，直接获取
      const result = await client.session.get({ sessionID: parentSessionID })
      childSession = result.data as Session | undefined
    } else {
      // 非 root，创建子 session
      const childResult = await client.session.create({
        directory,
        parentID: parentSessionID,
        agent,
      })
      childSession = childResult.data as Session | undefined
    }
    if (!childSession) throw new Error(`Failed to ${isRoot ? "get" : "create"} session for ${agent}`)

    return await processAgentResult({
      sync,
      agent,
      isRoot,
      client,
      extra,
      modelKey,
      fileParts,
      onSessionCreated,
      childSessionID: childSession.id,
      parentSessionID,
      promptText,
      schema,
      tagError,
    })
  } catch (err) {
    // 优先用 processAgentResult 已标记的真实子 session ID，避免 fallback 到 parentSessionID
    tagError(err, (err as { _childSessionId?: string })?._childSessionId ?? parentSessionID)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runChildSession] ${agent} 执行失败:`, message)
    // 始终 rethrow：让真实错误（欠费/鉴权/超长等）带类型信息传到 workflow 的 classifyAIError，
    // 否则上层只能看到 caller 因 text 为空而抛的 "did not return valid JSON"，真实错误类型被掩盖
    throw err
  }
}

async function processAgentResult(params: {
  sync: any
  client: any
  agent: string
  isRoot?: boolean
  extra?: Record<string, unknown>
  modelKey: { providerID: string; modelID: string } | undefined
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
  onSessionCreated?: (childSessionID: string) => void
  promptText: string
  childSessionID: string
  parentSessionID: string
  schema?: Record<string, unknown>
  tagError: (err: unknown, sessionId: string) => void
}): Promise<{ text: string; childSessionId: string; error?: string }> {
  const { sync, client, agent, isRoot, extra, modelKey, fileParts, onSessionCreated, promptText, childSessionID, parentSessionID, schema, tagError } = params

  if (sync?.session?.sync) await sync.session.sync(childSessionID)
  if (onSessionCreated && !isRoot) onSessionCreated(childSessionID)

  const existingMessages = ((sync?.data?.message?.[childSessionID] ?? []) as Array<Record<string, unknown>>)
  const knownIds = new Set(existingMessages.map((m) => m.id as string))

  await client.session.promptAsync({
    extra,
    agent,
    model: modelKey,
    sessionID: childSessionID,
    parts: [{ type: "text", text: promptText }, ...(fileParts ?? [])],
  })

  const stopWatch = watchRetryStatus(sync, childSessionID)
  try {
    const result = await getResultFromMessages(sync, childSessionID, knownIds)
    const sessionId = isRoot ? parentSessionID : childSessionID
    // 必须先查 assistant 消息上的 .error：欠费/鉴权/超长等不可重试错误会让模型不返回文本，
    // getResultFromMessages 此时会 resolve 空字符串，若先走 "未返回有效内容" 检查，真实错误类型会被掩盖
    debugger
    const messageError = extractMessageError(sync, childSessionID, knownIds)
    if (messageError) {
      console.error(`[runChildSession] ${agent} 模型返回了错误:`, messageError)
      // 抛错而非返回 error 字段：caller 都不读 result.error，只有抛出才能让真实错误类型传到 workflow 的 classifyAIError
      const e = new Error(messageError) as AgentError & { _childSessionId?: string }
      e.agentName = agent
      e.agentCallId = sessionId
      e._childSessionId = sessionId
      throw e
    }
    if (!result) throw new Error(`[${agent}] 模型未返回有效内容`)
    const cleaned = extractJson(result)
    if (schema && cleaned) validateSchema(cleaned, schema, agent)
    logAgentCall(agent, sessionId, promptText, cleaned ? JSON.stringify(cleaned, null, 2) : result)

    return { text: result, childSessionId: sessionId }
  } catch (err) {
    tagError(err, isRoot ? parentSessionID : childSessionID)
    throw err
  } finally {
    stopWatch()
  }
}

function extractMessageError(
  sync: any,
  sessionId: string,
  knownIds: Set<string>,
): string | undefined {
  const messages = (sync?.data?.message?.[sessionId] ?? []) as Array<Record<string, unknown>>
  let target: Record<string, unknown> | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && !knownIds.has(m.id as string)) {
      target = m
      break
    }
  }
  // opencode 错误对象序列化形如 { name, data: {...} }（NamedError.toObject），字段全在 data 下，
  // 直接读 msgError.statusCode / msgError.isRetryable 永远是 undefined —— 这是之前拿不到错误类型的根因
  const msgError = target?.error as { name?: string; data?: Record<string, unknown> } | undefined
  if (!msgError?.name || !msgError.data) return undefined
  return formatMessageError(msgError.name, msgError.data)
}

// 把 { name, data } 信封格式化成带中文标签 + 英文判别符 + provider code + HTTP 状态 + 可重试标记的字符串。
// 保留英文 name（如 APIError / ProviderAuthError）是为了让上层 classifyAIError 的关键词匹配继续生效。
function formatMessageError(name: string, data: Record<string, unknown>): string {
  const message = data.message as string | undefined
  const statusCode = data.statusCode as number | undefined
  const isRetryable = data.isRetryable as boolean | undefined
  const responseBody = data.responseBody as string | undefined
  const providerCode = parseProviderCode(responseBody)
  const label = classifyErrorLabel(name, message, responseBody, providerCode, statusCode)
  const parts: string[] = [`[${label} | ${name}]`]
  if (message) parts.push(message)
  if (providerCode) parts.push(`(${providerCode})`)
  if (statusCode) parts.push(`HTTP ${statusCode}`)
  if (isRetryable !== undefined) parts.push(isRetryable ? "可重试" : "不可重试")
  return parts.join(" ")
}

// 按 DeepSeek 官方错误码（https://api-docs.deepseek.com/zh-cn/quick_start/error_codes）分类：
//   400 格式错误 / 401 认证失败 / 402 余额不足 / 422 参数错误 / 429 速率上限 / 500 服务器故障 / 503 服务器繁忙
// 402 是官方的余额不足码（body code 是通用的 invalid_request_error，message 才是 "Insufficient Balance"），
// 必须同时按 statusCode 和 message 判定，单看 code/responseBody 会漏判
function classifyErrorLabel(
  name: string,
  message: string | undefined,
  responseBody: string | undefined,
  providerCode: string | undefined,
  statusCode: number | undefined,
): string {
  if (name === "ProviderAuthError") return "鉴权失败"
  if (name === "ContextOverflowError") return "上下文超长"
  if (name === "MessageAbortedError") return "已中止"
  if (name === "MessageOutputLengthError") return "输出超长"
  if (name === "StructuredOutputError") return "结构化输出失败"
  if (name === "APIError") {
    const hay = `${providerCode ?? ""} ${message ?? ""} ${responseBody ?? ""}`.toLowerCase()
    // 402 余额不足（DeepSeek）/ insufficient_quota / quota_exceeded（OpenAI 系）/ Free/Go Usage Limit（opencode）
    if (statusCode === 402 || hay.includes("insufficient_quota") || hay.includes("quota_exceeded") || hay.includes("insufficient balance") || hay.includes("余额不足") || hay.includes("freeusagelimit") || hay.includes("gousagelimit")) {
      return "欠费/额度耗尽"
    }
    // 401 认证失败 / 403（DeepSeek 文档未列 403，按通用语义归鉴权）
    if (statusCode === 401 || statusCode === 403 || hay.includes("unauthorized") || hay.includes("authentication")) return "鉴权失败"
    // 400 格式错误
    if (statusCode === 400) return "请求格式错误"
    // 422 参数错误
    if (statusCode === 422) return "请求参数错误"
    // 429 速率上限（通常会重试，落不到这里；若落到说明重试已耗尽）
    if (statusCode === 429) return "限流"
    // 500 服务器故障 / 503 服务器繁忙（通常会重试）
    if (statusCode !== undefined && statusCode >= 500) return "服务端错误"
    return "API错误"
  }
  return "未知错误"
}

// 从 provider 原始响应体里挖 error.code / error.type（如 insufficient_quota、context_length_exceeded）
function parseProviderCode(responseBody: string | undefined): string | undefined {
  if (!responseBody) return undefined
  try {
    const json = JSON.parse(responseBody) as { error?: { code?: string; type?: string } }
    return json?.error?.code ?? json?.error?.type
  } catch {
    return undefined
  }
}

function watchRetryStatus(sync: any, sessionID: string): () => void {
  return createRoot((dispose) => {
    let lastAttempt = 0
    let lastActionReason: string | undefined
    createEffect(() => {
      const status = sync?.data?.session_status?.[sessionID]
      if (!status || status.type !== "retry") return
      // 带 action 的（FreeUsageLimitError / GoUsageLimitError）：这类错误会无限重试，永远落不到 assistantMessage.error，
      // action.reason 是 UI 感知它们的唯一信号；同一 reason 只弹一次，避免重试刷屏
      const action = status.action as
        | { reason?: string; title?: string; message?: string; link?: string }
        | undefined
      if (action?.reason) {
        if (action.reason === lastActionReason) return
        lastActionReason = action.reason
        showToast({
          title: action.title ?? `模型调用出错（第 ${status.attempt} 次重试中）`,
          description: action.message ?? status.message,
          variant: "error",
          persistent: true,
          actions: action.link
            ? [{ label: "前往处理", onClick: () => openExternalUrl(action.link!) }]
            : undefined,
        })
        return
      }
      // 通用可重试错误（429 / 5xx / rate limit）：每次 attempt 递增弹一次
      if (status.attempt <= lastAttempt) return
      lastAttempt = status.attempt
      showToast({
        title: `模型调用出错（第 ${status.attempt} 次重试中）`,
        description: status.message,
        variant: "error",
      })
    })
    return dispose
  })
}

// 唤起系统浏览器打开外链：Electron 走 desktopApi.openLink 避免 webview 导航后无返回入口，web 走 window.open
function openExternalUrl(url: string) {
  const api = getDesktopApi()
  if (typeof api?.openLink === "function") api.openLink(url)
  else window.open(url, "_blank", "noopener")
}
