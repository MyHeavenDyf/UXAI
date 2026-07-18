import type { Session, OutputFormat } from "@opencode-ai/sdk/v2/client"
import { createRoot, createEffect } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { getResultFromMessages, extractJson } from '../utils/json-parser'
import { logAgentCall } from "../utils/debug-log"

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
  format?: OutputFormat
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
    format, // 结构化输出格式，如 { type: "json_schema", schema: {...} }
    fileParts, // 文件附件
  } = input

  try {
    debugger
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
    // 判断 session 是否获取/创建完毕
    if (!childSession) throw new Error(`Failed to ${isRoot ? "get" : "create"} session for ${agent}`)
    // 让前端同步拉取这个子 session 的数据到本地状态，让前后端挂钩起来
    if (sync?.session?.sync) await sync.session.sync(childSession.id)
    // 创建时回调, 如果是根节点，则不在返回创建回调
    if (onSessionCreated && !isRoot) onSessionCreated(childSession.id)
    // 记录 promptAsync 之前已存在的消息 ID，用于区分新生成的 assistant 消息
    const existingMessages = ((sync?.data?.message?.[childSession.id] ?? []) as Array<Record<string, unknown>>)
    const knownIds = new Set(existingMessages.map((m) => m.id as string))
    // LLM 内容通过 SSE 流式推送，服务端 prompt 端点返回 streaming response
    await client.session.promptAsync({
      extra,
      agent,
      format,
      model: modelKey,
      sessionID: childSession.id,
      parts: [{ type: "text", text: promptText }, ...(fileParts ?? [])],
    })
    // 监控 session_status，后端 model 调用重试时弹出 toast
    const stopWatch = watchRetryStatus(sync, childSession.id)
    // 监听 reactive store，等待新 assistant 消息完成（3分钟超时）
    const result = await getResultFromMessages(sync, childSession.id, knownIds)
    if (!result) throw new Error(`[${agent}] 模型未返回有效内容`)
    const sessionId = isRoot ? parentSessionID : childSession.id
    const cleaned = extractJson(result)
    logAgentCall(agent, sessionId, promptText, cleaned ? JSON.stringify(cleaned, null, 2) : result)

    // 检查 assistant message 是否携带错误
    const messageError = extractMessageError(sync, childSession.id, knownIds)
    if (messageError) {
      console.error(`[runChildSession] ${agent} 模型返回了错误:`, messageError)
      return { text: result, childSessionId: sessionId, error: messageError }
    }

    return { text: result, childSessionId: sessionId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runChildSession] ${agent} 执行失败:`, message)
    return { text: "", childSessionId: parentSessionID, error: message }
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
