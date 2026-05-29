import type { ResultTab } from "../components/result-viewer/tab-store"

export interface ArtifactSnapshot {
  id: string
  sessionId: string
  tab: ResultTab
  timestamp: number
  label?: string
}

const STORAGE_PREFIX = "octo:make:snapshots:"

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
    list.unshift(snapshot)
    // Keep at most 50 snapshots per session
    if (list.length > 50) list.length = 50
    writeAll(id, list)
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

  return { snapshots, save, load, remove, restore }
}
