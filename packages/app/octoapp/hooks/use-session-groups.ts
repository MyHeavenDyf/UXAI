import { createEffect, on } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { migrateLocalGroupsToDB } from "./migrate-groups"

export type SessionGroupMapping = Record<string, string>

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
      setMapping(reconcile(data?.mapping ?? {}))
    }, { defer: true }),
  )

  const moveSessionToGroup = async (sessionId: string, groupId: string) => {
    const d = dir()
    if (!d) return
    setMapping(produce((draft) => { draft[sessionId] = groupId }))
    const client = globalSDK.createClient({ directory: d })
    await client.sessionGroup.mapSession({ sessionId, groupId })
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
        if (draft[sid] === groupId) delete draft[sid]
      }
    }))
  }

  const sessionIdsOfGroup = (groupId: string) =>
    Object.entries(mapping).filter(([, gid]) => gid === groupId).map(([sid]) => sid)

  return { mapping, moveSessionToGroup, removeSessionFromGroup, clearGroup, sessionIdsOfGroup }
}
