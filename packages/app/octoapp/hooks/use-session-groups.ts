import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"

export type SessionGroupMapping = Record<string, string>

const keyFor = (dir: string, namespace: string) => `octo:${namespace}-session-groups:${dir}`

function readMapping(dir: string, namespace: string): SessionGroupMapping {
  try {
    const raw = localStorage.getItem(keyFor(dir, namespace))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as SessionGroupMapping) : {}
  } catch {
    return {}
  }
}

function writeMapping(dir: string, namespace: string, mapping: SessionGroupMapping) {
  localStorage.setItem(keyFor(dir, namespace), JSON.stringify(mapping))
}

export function useSessionGroups(dir: () => string | undefined, namespace: string = "make") {
  const [mapping, setMapping] = createStore<SessionGroupMapping>({})

  createEffect(on(dir, (d) => {
    if (!d) return
    setMapping(reconcile(readMapping(d, namespace)))
  }))

  const moveSessionToGroup = (sessionId: string, groupId: string) => {
    const d = dir()
    if (!d) return
    const next = { ...mapping, [sessionId]: groupId }
    writeMapping(d, namespace, next)
    setMapping(reconcile(next))
  }

  const removeSessionFromGroup = (sessionId: string) => {
    const d = dir()
    if (!d) return
    setMapping(
      produce((draft) => {
        delete draft[sessionId]
      }),
    )
    const next = { ...mapping }
    delete next[sessionId]
    writeMapping(d, namespace, next)
  }

  const clearGroup = (groupId: string) => {
    const d = dir()
    if (!d) return
    const next: SessionGroupMapping = {}
    for (const [sid, gid] of Object.entries(mapping)) {
      if (gid !== groupId) next[sid] = gid
    }
    writeMapping(d, namespace, next)
    setMapping(reconcile(next))
  }

  const sessionIdsOfGroup = (groupId: string) =>
    Object.entries(mapping).filter(([, gid]) => gid === groupId).map(([sid]) => sid)

  return { mapping, moveSessionToGroup, removeSessionFromGroup, clearGroup, sessionIdsOfGroup }
}
