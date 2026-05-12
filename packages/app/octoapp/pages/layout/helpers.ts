import { getFilename } from "@opencode-ai/core/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

type SessionGroupKey = "today" | "yesterday" | "lastSevenDays" | "earlier"

export type SessionGroup = {
  key: SessionGroupKey
  sessions: Session[]
}

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  pathKey(session.directory) === pathKey(directory) && !session.parentID && !session.time?.archived

export const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

export function groupSessionsByDate(sessions: Session[], now: number): SessionGroup[] {
  const today = new Date(now)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
  const sevenDaysStart = todayStart - 7 * 24 * 60 * 60 * 1000

  const groups: SessionGroup[] = [
    { key: "today", sessions: [] },
    { key: "yesterday", sessions: [] },
    { key: "lastSevenDays", sessions: [] },
    { key: "earlier", sessions: [] },
  ]

  for (const session of sessions) {
    const created = session.time.created
    if (created >= todayStart) {
      groups[0].sessions.push(session)
    } else if (created >= yesterdayStart) {
      groups[1].sessions.push(session)
    } else if (created >= sevenDaysStart) {
      groups[2].sessions.push(session)
    } else {
      groups[3].sessions.push(session)
    }
  }

  return groups.filter(g => g.sessions.length > 0)
}

export const latestRootSession = (stores: SessionStore[], now: number) =>
  stores.flatMap(roots).sort(sortSessions(now))[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = pathKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = pathKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = pathKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
