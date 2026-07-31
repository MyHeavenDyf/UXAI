import type { Session } from "@opencode-ai/sdk/v2/client"
import { createRoot, createEffect } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { getResultFromMessages, extractJson } from '../utils/json-parser'
import { logAgentCall } from "../utils/debug-log"
import { validateSchema } from "../utils/schema-validator"
import { type AgentError } from "../utils/error-msg"

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
    if (message === "aborted") throw err
    return { text: "", childSessionId: parentSessionID, error: message }
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
    if (!result) throw new Error(`[${agent}] 模型未返回有效内容`)
    const sessionId = isRoot ? parentSessionID : childSessionID
    const cleaned = extractJson(result)
    if (schema && cleaned) validateSchema(cleaned, schema, agent)
    logAgentCall(agent, sessionId, promptText, cleaned ? JSON.stringify(cleaned, null, 2) : result)

    const messageError = extractMessageError(sync, childSessionID, knownIds)
    if (messageError) {
      console.error(`[runChildSession] ${agent} 模型返回了错误:`, messageError)
      return { text: result, childSessionId: sessionId, error: messageError }
    }

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
  const msgError = target?.error as Record<string, unknown> | undefined
  if (!msgError) return undefined
  const name = msgError.name as string | undefined
  const msg = msgError.message as string | undefined
  const statusCode = msgError.statusCode as number | undefined
  const isRetryable = msgError.isRetryable as boolean | undefined
  const parts: string[] = []
  if (name) parts.push(`[${name}]`)
  if (msg) parts.push(msg)
  if (statusCode) parts.push(`(HTTP ${statusCode})`)
  if (isRetryable !== undefined) parts.push(isRetryable ? "可重试" : "不可重试")
  return parts.join(" ") || undefined
}

function watchRetryStatus(sync: any, sessionID: string): () => void {
  return createRoot((dispose) => {
    let lastAttempt = 0
    createEffect(() => {
      const status = sync?.data?.session_status?.[sessionID]
      if (!status || status.type !== "retry") return
      if (status.attempt <= lastAttempt) return
      lastAttempt = status.attempt
      showToast({
        title: `模型调用出错（第 ${status.attempt} 次重试中）`,
        description: status.message,
      })
    })
    return dispose
  })
}
