import type { Session } from "@opencode-ai/sdk/v2/client"
import { getResultFromMessages } from '../utils/json_parser'

export type RunChildSessionInput = {
  client: any
  directory: string
  parentSessionID: string
  agent: string
  modelKey: { providerID: string; modelID: string } | undefined
  prompt: string
  sync?: any
  onSessionCreated?: (childSessionID: string) => void
  aborted?: boolean
}

export async function runChildSession(input: RunChildSessionInput): Promise<string> {
  const { client, directory, parentSessionID, agent, modelKey, prompt: promptText, sync, onSessionCreated, aborted } = input

  const childResult = await client.session.create({
    directory,
    parentID: parentSessionID,
    agent,
  })
  const childSession = childResult.data as Session | undefined
  if (!childSession) throw new Error(`Failed to create child session for ${agent}`)

  if (sync?.session?.sync) await sync.session.sync(childSession.id)
  if (onSessionCreated) onSessionCreated(childSession.id)

  // promptAsync: fire-and-forget, LLM 内容通过 SSE 流式推送
  // 服务端 prompt 端点返回 streaming response，SDK client 无法直接解析为 JSON
  await client.session.promptAsync({
    sessionID: childSession.id,
    agent,
    ...(modelKey ? { model: modelKey } : {}),
    parts: [{ type: "text", text: promptText }],
  })

  // 轮询等待 assistant 回复完成
  return getResultFromMessages({ client }, childSession.id, !!aborted)
}
