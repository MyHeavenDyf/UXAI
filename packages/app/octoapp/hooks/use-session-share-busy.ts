import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"

const [studioGenerating, setStudioGenerating] = createStore<Record<string, Record<string, boolean>>>({})

export function setStudioSessionGenerating(sessionID: string, generating: boolean, source = "conversation") {
  setStudioGenerating(sessionID, (current) => ({ ...current, [source]: generating }))
}

export function useSessionShareBusy(session: Accessor<Session | null>) {
  const sync = useGlobalSync()
  return createMemo(() => {
    const current = session()
    if (!current) return false
    const status = sync.child(current.directory)[0].session_status[current.id]
    return (!!status && status.type !== "idle") || Object.values(studioGenerating[current.id] ?? {}).some(Boolean)
  })
}
