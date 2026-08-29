import type { ResultTab } from "../components/result-viewer/tab-store"

export interface ArtifactSnapshot {
  id: string
  sessionId: string
  tab: ResultTab
  timestamp: number
  label?: string
}

const STORAGE_PREFIX = "octo:make:snapshots:"
const MAX_SNAPSHOTS_PER_FILE = 5

function getKey(sessionId: string): string {
  return STORAGE_PREFIX + sessionId
}

function readAll(sessionId: string): ArtifactSnapshot[] {
  try {
    const raw = localStorage.getItem(getKey(sessionId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeAll(sessionId: string, snapshots: ArtifactSnapshot[]) {
  localStorage.setItem(getKey(sessionId), JSON.stringify(snapshots))
}

export function clearSessionSnapshots(sessionId: string) {
  localStorage.removeItem(getKey(sessionId))
}

export function createSnapshotStore(sessionId: () => string | undefined) {
  const snapshots = (): ArtifactSnapshot[] => {
    const id = sessionId()
    if (!id) return []
    return readAll(id)
  }

  function save(tab: ResultTab) {
    const id = sessionId()
    if (!id) return
    const list = readAll(id)
    const snapshot: ArtifactSnapshot = {
      id: crypto.randomUUID(),
      sessionId: id,
      tab: { ...tab },
      timestamp: Date.now(),
      label: tab.title,
    }
    
    const fileKey = tab.filePath || tab.id
    
    const groups = new Map<string, ArtifactSnapshot[]>()
    for (const s of list) {
      const sKey = s.tab.filePath || s.tab.id
      const group = groups.get(sKey) || []
      group.push(s)
      groups.set(sKey, group)
    }
    
    const currentGroup = groups.get(fileKey) || []
    currentGroup.unshift(snapshot)
    if (currentGroup.length > MAX_SNAPSHOTS_PER_FILE) {
      currentGroup.length = MAX_SNAPSHOTS_PER_FILE
    }
    groups.set(fileKey, currentGroup)
    
    const newList: ArtifactSnapshot[] = []
    for (const [, group] of groups) {
      let trimmed = group
      if (group.length > MAX_SNAPSHOTS_PER_FILE) {
        trimmed = group.slice(0, MAX_SNAPSHOTS_PER_FILE)
      }
      newList.push(...trimmed)
    }
    
    writeAll(id, newList)
  }

  function load(id: string): ArtifactSnapshot | undefined {
    const sid = sessionId()
    if (!sid) return undefined
    return readAll(sid).find((s) => s.id === id)
  }

  function remove(id: string) {
    const sid = sessionId()
    if (!sid) return
    const list = readAll(sid).filter((s) => s.id !== id)
    writeAll(sid, list)
  }

  function restore(id: string): ResultTab | undefined {
    const snapshot = load(id)
    return snapshot?.tab
  }

  function restoreLatestByTabId(tabId: string): ResultTab | undefined {
    const sid = sessionId()
    if (!sid) return undefined
    return readAll(sid).find((s) => s.tab.id === tabId)?.tab
  }

  return { snapshots, save, load, remove, restore, restoreLatestByTabId }
}
