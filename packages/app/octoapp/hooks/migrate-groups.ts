import type { OpencodeClient, SessionGroupListResponse } from "@opencode-ai/sdk/v2/client"

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
  const p = doMigrate(opts)
    .then(() => { migrated.add(key) })
    .catch(() => { /* partial failure: leave migrated unset so the next launch retries */ })
    .finally(() => { inFlight.delete(key) })
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
  if (listResult.error) throw new Error("failed to list session groups")
  const dbGroups = listResult.data?.groups ?? []

  const idMap = new Map<string, string>()
  for (const g of localGroups) {
    const existing = dbGroups.find((d) => d.name === g.name)
    if (existing) { idMap.set(g.id, existing.id); continue }
    const result = await client.sessionGroup.create({ namespace: namespace as "make" | "insight", name: g.name })
    if (result.error || !result.data) throw new Error(`failed to create group: ${g.name}`)
    idMap.set(g.id, result.data.id)
  }

  for (const [sessionId, oldGroupId] of Object.entries(localMapping)) {
    const newId = idMap.get(oldGroupId)
    if (!newId) throw new Error(`missing group mapping for ${oldGroupId}`)
    const r = await client.sessionGroup.mapSession({ sessionId, groupId: newId })
    if (r.error || !r.data) throw new Error(`failed to map session: ${sessionId}`)
  }

  localStorage.removeItem(gKey)
  localStorage.removeItem(mKey)
}

// Deduplicated session-group list fetch. Both useMakeGroups and useSessionGroups
// call this with the same dir+namespace; only the first call makes the network
// request, the second reuses the in-flight Promise.
const listInFlight = new Map<string, Promise<SessionGroupListResponse | undefined>>()

export function fetchSessionGroupList(opts: {
  dir: string
  namespace: string
  client: OpencodeClient
}): Promise<SessionGroupListResponse | undefined> {
  const key = `${opts.dir}:${opts.namespace}`
  const existing = listInFlight.get(key)
  if (existing) return existing
  const p = (async () => {
    await migrateLocalGroupsToDB(opts)
    const result = await opts.client.sessionGroup.list({ namespace: opts.namespace as "make" | "insight" })
    return result.data
  })()
  listInFlight.set(key, p)
  p.finally(() => { listInFlight.delete(key) })
  return p
}
