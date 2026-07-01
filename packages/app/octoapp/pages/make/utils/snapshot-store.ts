import type { ResultTab } from "../components/result-viewer/tab-store"

export interface ArtifactSnapshot {
  id: string
  sessionId: string
  tab: ResultTab
  timestamp: number
  label?: string
}

const STORAGE_PREFIX = "octo:make:snapshots:"
const MAX_SNAPSHOTS_PER_FILE = 10

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
    const fileGroup: ArtifactSnapshot[] = []
    const otherSnapshots: ArtifactSnapshot[] = []
    
    for (const s of list) {
      const sKey = s.tab.filePath || s.tab.id
      if (sKey === fileKey) {
        fileGroup.push(s)
      } else {
        otherSnapshots.push(s)
      }
    }
    
    fileGroup.unshift(snapshot)
    if (fileGroup.length > MAX_SNAPSHOTS_PER_FILE) {
      fileGroup.length = MAX_SNAPSHOTS_PER_FILE
    }
    
    const newList = [...fileGroup, ...otherSnapshots]
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