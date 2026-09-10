import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"

export type MakeGroup = {
  id: string
  name: string
  created_at: number
}

const keyFor = (dir: string, namespace: string) => `octo:${namespace}-groups:${dir}`

function readGroups(dir: string, namespace: string): MakeGroup[] {
  try {
    const raw = localStorage.getItem(keyFor(dir, namespace))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MakeGroup[]) : []
  } catch {
    return []
  }
}

function writeGroups(dir: string, namespace: string, groups: MakeGroup[]) {
  localStorage.setItem(keyFor(dir, namespace), JSON.stringify(groups))
}

export function useMakeGroups(dir: () => string | undefined, namespace: string = "make") {
  const [groups, setGroups] = createStore<MakeGroup[]>([])

  createEffect(on(dir, (d) => {
    if (!d) return
    setGroups(reconcile(readGroups(d, namespace), { key: "id" }))
  }))

  const addGroup = (name: string): string | undefined => {
    const d = dir()
    if (!d) return
    const group: MakeGroup = { id: crypto.randomUUID(), name, created_at: Date.now() }
    writeGroups(d, namespace, [group, ...groups])
    setGroups(produce((draft) => { draft.unshift(group) }))
    return group.id
  }

  const renameGroup = (id: string, name: string) => {
    const d = dir()
    if (!d) return
    const next = groups.map(g => g.id === id ? { ...g, name } : g)
    writeGroups(d, namespace, next)
    setGroups(reconcile(next, { key: "id" }))
  }

  const removeGroup = (id: string) => {
    const d = dir()
    if (!d) return
    const next = groups.filter(g => g.id !== id)
    writeGroups(d, namespace, next)
    setGroups(reconcile(next, { key: "id" }))
  }

  return { groups, addGroup, renameGroup, removeGroup }
}
