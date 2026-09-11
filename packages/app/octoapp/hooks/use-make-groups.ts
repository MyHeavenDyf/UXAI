import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { migrateLocalGroupsToDB } from "./migrate-groups"

export type MakeGroup = {
  id: string
  name: string
  created_at: number
}

export function useMakeGroups(dir: () => string | undefined, namespace: string = "make") {
  const globalSDK = useGlobalSDK()
  const [groups, setGroups] = createStore<MakeGroup[]>([])

  createEffect(
    on(dir, async (d) => {
      if (!d) {
        setGroups(reconcile([], { key: "id" }))
        return
      }
      const client = globalSDK.createClient({ directory: d })
      await migrateLocalGroupsToDB({ dir: d, namespace, client })
      const result = await client.sessionGroup.list({ namespace: namespace as "make" | "insight" })
      const data = result.data
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
