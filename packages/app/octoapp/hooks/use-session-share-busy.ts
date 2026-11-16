import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"

const [studioGenerating, setStudioGenerating] = createStore<Record<string, boolean>>({})

export function setStudioSessionGenerating(sessionID: string, generating: boolean) {
  setStudioGenerating(sessionID, generating)
}

export function useSessionShareBusy(session: Accessor<Session | null>) {
  const sync = useGlobalSync()
  return createMemo(() => {
    const current = session()
    if (!current) return false
    const status = sync.child(current.directory)[0].session_status[current.id]
    return (!!status && status.type !== "idle") || !!studioGenerating[current.id]
  })
}
