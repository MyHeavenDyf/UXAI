import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { migrateLocalGroupsToDB } from "./migrate-groups"

export type SessionGroupMapping = Record<string, { groupId: string; position: number }>

export function useSessionGroups(dir: () => string | undefined, namespace: string = "make") {
  const globalSDK = useGlobalSDK()
  const [mapping, setMapping] = createStore<SessionGroupMapping>({})

  createEffect(
    on(dir, async (d) => {
      if (!d) {
        setMapping(reconcile({}))
        return
      }
      const client = globalSDK.createClient({ directory: d })
      await migrateLocalGroupsToDB({ dir: d, namespace, client })
      const result = await client.sessionGroup.list({ namespace: namespace as "make" | "insight" })
      const data = result.data
      const raw = data?.mapping ?? {}
      const cleaned: SessionGroupMapping = {}
      for (const [k, v] of Object.entries(raw)) cleaned[k] = { groupId: v.groupId, position: Number(v.position) }
      setMapping(reconcile(cleaned))
    }, { defer: true }),
  )

  const moveSessionToGroup = async (sessionId: string, groupId: string, position?: number) => {
    const d = dir()
    if (!d) return
    setMapping(produce((draft) => { draft[sessionId] = { groupId, position: position ?? 0 } }))
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.mapSession({ sessionId, groupId, position })
  }

  const removeSessionFromGroup = async (sessionId: string) => {
    const d = dir()
    if (!d) return
    setMapping(produce((draft) => { delete draft[sessionId] }))
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.unmapSession({ sessionID: sessionId })
  }

  const clearGroup = (groupId: string) => {
    setMapping(produce((draft) => {
      for (const sid of Object.keys(draft)) {
        if (draft[sid]?.groupId === groupId) delete draft[sid]
      }
    }))
  }

  const reorderGroupSessions = async (groupId: string, sessionIds: string[]) => {
    const d = dir()
    if (!d) return
    setMapping(produce((draft) => {
      for (let i = 0; i < sessionIds.length; i++) {
        if (draft[sessionIds[i]]?.groupId === groupId) draft[sessionIds[i]].position = i
      }
    }))
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.reorderSessions({ groupId, sessionIds })
  }

  const sessionIdsOfGroup = (groupId: string) =>
    Object.entries(mapping).filter(([, v]) => v?.groupId === groupId).map(([sid]) => sid)

  return { mapping, moveSessionToGroup, removeSessionFromGroup, clearGroup, reorderGroupSessions, sessionIdsOfGroup }
}
