import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

const migrated = new Set<string>()
const inFlight = new Map<string, Promise<void>>()

const groupsKey = (dir: string, namespace: string) => `octo:${namespace}-groups:${dir}`
const mappingKey = (dir: string, namespace: string) => `octo:${namespace}-session-groups:${dir}`

export function migrateLocalGroupsToDB(opts: {
  dir: string
  namespace: string
  client: OpencodeClient
}): Promise<void> {
  const key = `${opts.dir}:${opts.namespace}`
  const existing = inFlight.get(key)
  if (existing) return existing
  if (migrated.has(key)) return Promise.resolve()
  const p = doMigrate(opts).finally(() => {
    inFlight.delete(key)
    migrated.add(key)
  })
  inFlight.set(key, p)
  return p
}

async function doMigrate({ dir, namespace, client }: {
  dir: string
  namespace: string
  client: OpencodeClient
}) {
  const gKey = groupsKey(dir, namespace)
  const mKey = mappingKey(dir, namespace)

  let localGroups: Array<{ id: string; name: string }> = []
  let localMapping: Record<string, string> = {}
  try {
    const raw = localStorage.getItem(gKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) localGroups = parsed
    }
  } catch {}
  try {
    const raw = localStorage.getItem(mKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") localMapping = parsed
    }
  } catch {}

  if (localGroups.length === 0) {
    localStorage.removeItem(mKey)
    return
  }

  const listResult = await client.sessionGroup.list({ namespace: namespace as "make" | "insight" })
  const dbGroups = listResult.data?.groups ?? []
  if (dbGroups.length > 0) {
    localStorage.removeItem(gKey)
    localStorage.removeItem(mKey)
    return
  }

  const idMap = new Map<string, string>()
  for (const g of localGroups) {
    const result = await client.sessionGroup.create({ namespace: namespace as "make" | "insight", name: g.name })
    if (result.data) idMap.set(g.id, result.data.id)
  }

  for (const [sessionId, oldGroupId] of Object.entries(localMapping)) {
    const newId = idMap.get(oldGroupId)
    if (newId) await client.sessionGroup.mapSession({ sessionId, groupId: newId })
  }

  localStorage.removeItem(gKey)
  localStorage.removeItem(mKey)
}
