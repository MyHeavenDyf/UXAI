import type { Session } from "@opencode-ai/sdk/v2/client"
import { getResultFromMessages } from '../utils/json_parser'

export type RunChildSessionInput = {
  // 前后端同步
  sync?: any
  // OpenCode SDK Client
  client: any
  // 当前正在执行的 Agent 名称
  agent: string
  // 组装好的 prompt
  prompt: string
  // 是否为根节点
  isRoot?: boolean
  // 是否需要立即停止
  aborted?: boolean
  // 当前工程运行时指定的文件夹
  directory: string
  // 根节点 Session ID
  parentSessionID: string
  // 当前选择的模型
  modelKey: { providerID: string; modelID: string } | undefined
  // 创建该 Session 时的回调
  onSessionCreated?: (childSessionID: string) => void
}

/**
 * 通用子 session 执行器 —— 领域无关,与 pattern/agents/run_child_session.ts 同构。
 * 负责:建/取子 session → 同步流 → promptAsync(SSE) → 轮询取最终结果文本。
 */
export async function runChildSession(input: RunChildSessionInput): Promise<string> {
  const {
    sync,
    agent,
    isRoot,
    client,
    modelKey,
    directory,
    parentSessionID,
    prompt: promptText,
    onSessionCreated,
    aborted,
  } = input
  let childSession: Session | undefined

  if (isRoot) {
    // root session 已在外面创建,直接获取
    const result = await client.session.get({ sessionID: parentSessionID })
    childSession = result.data as Session | undefined
  } else {
    // 非 root,创建子 session
    const childResult = await client.session.create({ directory, parentID: parentSessionID, agent })
    childSession = childResult.data as Session | undefined
  }

  if (!childSession) throw new Error(`Failed to ${isRoot ? "get" : "create"} session for ${agent}`)

  // 同步子 session 数据到本地状态
  if (sync?.session?.sync) await sync.session.sync(childSession.id)
  // 创建回调(根节点不回调)
  if (onSessionCreated && !isRoot) onSessionCreated(childSession.id)

  // LLM 内容通过 SSE 流式推送
  await client.session.promptAsync({
    agent,
    model: modelKey,
    sessionID: childSession.id,
    parts: [{ type: "text", text: promptText }],
  })

  // 轮询等待执行完毕,取出最终结果
  return getResultFromMessages({ client }, childSession.id, !!aborted)
}
