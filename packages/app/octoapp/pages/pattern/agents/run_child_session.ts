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
  // LLM 内容通过 SSE 流式推送，服务端 prompt 端点返回 streaming response
  await client.session.promptAsync({
    agent,
    model: modelKey,
    sessionID: childSession.id,
    parts: [{ type: "text", text: promptText }],
  })
  // 轮询等待本 session 执行完毕，取出最终结果
  const result = await getResultFromMessages({ client }, childSession.id, !!aborted)
  const sessionId = isRoot ? parentSessionID : childSession.id
  const cleaned = extractJson(result)
  logAgentCall(agent, sessionId, promptText, cleaned ? JSON.stringify(cleaned, null, 2) : result)
  return { text: result, childSessionId: sessionId }
}
