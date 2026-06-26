import type { Session } from "@opencode-ai/sdk/v2/client"

export async function autoRenameSession(input: {
  client: any
  directory: string
  targetSessionID: string
  userText: string
  modelKey: { providerID: string; modelID: string } | undefined
}): Promise<string | null> {
  const { client, directory, targetSessionID, userText, modelKey } = input
  const ts = await client.session.create({ directory, agent: "title" })
  const tsid = (ts.data as Session | undefined)?.id
  if (!tsid) return null
  try {
    await client.session.prompt({ sessionID: tsid, agent: "title", model: modelKey, parts: [{ type: "text", text: userText }] })
    const res = await client.session.messages({ sessionID: tsid })
    const items = res.data
    let clean: string | null = null
    if (items?.length) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].info.role !== "assistant") continue
        const texts: string[] = []
        for (const p of items[i].parts) {
          if (p.type === "text" && p.text) texts.push(p.text)
        }
        if (texts.length > 0) { clean = texts.join("\n").trim().split("\n")[0].slice(0, 50); break }
      }
    }
    if (clean) {
      await client.session.update({ sessionID: targetSessionID, title: clean }).catch(() => {})
      return clean
    }
    return null
  } finally {
    await client.session.delete({ sessionID: tsid }).catch(() => {})
  }
}
