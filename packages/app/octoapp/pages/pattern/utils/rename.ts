import type { Session } from "@opencode-ai/sdk/v2/client"
import { getResultFromMessages } from "./json-parser"

export async function autoRenameSession(input: {
  sync: any
  client: any
  directory: string
  targetSessionID: string
  userText: string
  modelKey: { providerID: string; modelID: string } | undefined
}): Promise<string | null> {
  const { sync, client, directory, targetSessionID, userText, modelKey } = input
  const ts = await client.session.create({ directory, agent: "title" })
  const tsid = (ts.data as Session | undefined)?.id
  if (!tsid) return null
  try {
    if (sync?.session?.sync) await sync.session.sync(tsid)
    const existing = ((sync?.data?.message?.[tsid] ?? []) as Array<Record<string, unknown>>)
    const knownIds = new Set(existing.map((m) => m.id as string))
    await client.session.promptAsync({
      sessionID: tsid,
      agent: "title",
      model: modelKey,
      parts: [{ type: "text", text: userText }],
    })
    const raw = await getResultFromMessages(sync, tsid, knownIds)
    const clean = raw.trim().split("\n")[0].slice(0, 50)
    if (clean) {
      await client.session.update({ sessionID: targetSessionID, title: clean }).catch(() => {})
      return clean
    }
    return null
  } finally {
    await client.session.delete({ sessionID: tsid }).catch(() => {})
  }
}
