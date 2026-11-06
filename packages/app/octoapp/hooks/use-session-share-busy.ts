import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, type Accessor } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"

export function useSessionShareBusy(session: Accessor<Session | null>) {
  const sync = useGlobalSync()
  return createMemo(() => {
    const current = session()
    if (!current) return false
    const status = sync.child(current.directory)[0].session_status[current.id]
    return !!status && status.type !== "idle"
  })
}
