import type { Session } from "@opencode-ai/sdk/v2/client"
import { getResultFromMessages, extractJson } from '../utils/json_parser'
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
  modelKey: { providerID: string; modelID: string } | undefined
  onSessionCreated?: (childSessionID: string) => void
  extra?: Record<string, unknown>
}

export async function runChildSession(input: RunChildSessionInput): Promise<{ text: string; childSessionId: string }> {
  const { 
    sync, // 前后端同步功能
    agent, // 当前正在执行的Agent名称
    isRoot, // 是否为根节点
    client, // OpenCode SDK Client
    modelKey, // 当前选择的模型
    directory, // 当前工程运行时指定的文件夹
    parentSessionID, // 根节点 Session ID
    prompt: promptText, // 用户输入提示词
    extra, // 透传到后端的额外数据
    onSessionCreated, // 创建该 Session 时的回调
    aborted // 是否需要立即停止，暂未用，全部停止另外写了一个方法
  } = input
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
    agent,
    model: modelKey,
    sessionID: childSession.id,
    parts: [{ type: "text", text: promptText }],
    extra,
  })
  // 监听 reactive store，等待新 assistant 消息完成
  const result = await getResultFromMessages(sync, childSession.id, knownIds)
  const sessionId = isRoot ? parentSessionID : childSession.id
  const cleaned = extractJson(result)
  logAgentCall(agent, sessionId, promptText, cleaned ? JSON.stringify(cleaned, null, 2) : result)
  return { text: result, childSessionId: sessionId }
}
