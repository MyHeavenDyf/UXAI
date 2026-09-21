import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { fetchSessionGroupList } from "./migrate-groups"

export type MakeGroup = {
  id: string
  name: string
  created_at: number
}

// Module-level singleton store per namespace. The store must survive component
// unmount (e.g. navigating away from /make to /studio and back) so that groups
// created earlier don't vanish when the provider re-mounts with an already-
// resolved dir (which would otherwise skip the deferred initial fetch). All
// callers (sidebar via context + header kebab) share this one store.
//
// Note: the store is keyed by namespace only. When the project directory changes
// the effect below clears stale data before fetching the new project's groups,
// so a previous project's groups are never displayed after the new fetch
// completes. Keeping the namespace-level singleton avoids losing optimistic
// updates during navigation.
type GroupStore = { groups: MakeGroup[]; setGroups: SetStoreFunction<MakeGroup[]> }
const groupStores = new Map<string, GroupStore>()
function getGroupStore(namespace: string): GroupStore {
  let s = groupStores.get(namespace)
  if (!s) {
    const [groups, setGroups] = createStore<MakeGroup[]>([])
    s = { groups, setGroups }
    groupStores.set(namespace, s)
  }
  return s
}

export function useMakeGroups(dir: () => string | undefined, namespace: string = "make") {
  const globalSDK = useGlobalSDK()
  const { groups, setGroups } = getGroupStore(namespace)

  createEffect(
    on(dir, async (d) => {
      if (!d) {
        setGroups(reconcile([], { key: "id" }))
        return
      }
      // Clear stale data immediately so a previous project's groups are not
      // visible while the new list is loading.
      setGroups(reconcile([], { key: "id" }))
      const client = globalSDK.createClient({ directory: d })
      const data = await fetchSessionGroupList({ dir: d, namespace, client })
      if (dir() !== d) return
      const gs: MakeGroup[] = (data?.groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        created_at: g.time_created as number,
      }))
      setGroups(reconcile(gs, { key: "id" }))
    }, { defer: true }),
  )

  const addGroup = async (name: string): Promise<string | undefined> => {
    const d = dir()
    if (!d) return
    const client = globalSDK.createClient({ directory: d })
    const result = await client.sessionGroup.create({ namespace: namespace as "make" | "insight", name })
    const g = result.data
    if (!g) return
    const group: MakeGroup = { id: g.id, name: g.name, created_at: g.time_created as number }
    setGroups(produce((draft) => { draft.unshift(group) }))
    return group.id
  }

  const renameGroup = async (id: string, name: string) => {
    const d = dir()
    if (!d) return
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.rename({ id, name })
    setGroups(produce((draft) => {
      const item = draft.find((g) => g.id === id)
      if (item) item.name = name
    }))
  }

  const removeGroup = async (id: string) => {
    const d = dir()
    if (!d) return
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.remove({ id })
    setGroups(produce((draft) => {
      const idx = draft.findIndex((g) => g.id === id)
      if (idx !== -1) draft.splice(idx, 1)
    }))
  }

  const moveGroup = async (sourceId: string, targetId: string, position: "before" | "after") => {
    const d = dir()
    if (!d || sourceId === targetId) return
    const source = groups.find((g) => g.id === sourceId)
    if (!source) return
    const next = groups.filter((g) => g.id !== sourceId)
    const targetIdx = next.findIndex((g) => g.id === targetId)
    if (targetIdx === -1) return
    const insertIdx = position === "before" ? targetIdx : targetIdx + 1
    next.splice(insertIdx, 0, source)
    setGroups(reconcile(next, { key: "id" }))
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.reorder({ ids: next.map((g) => g.id) })
  }

  return { groups, addGroup, renameGroup, removeGroup, moveGroup }
}
