import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, type Accessor } from "solid-js"
import { useSessionShareBusy } from "./use-session-share-busy"

export function useSessionShareBlockReason(session: Accessor<Session | null>, enabled: Accessor<boolean> = () => true) {
  const busy = useSessionShareBusy(session)
  return createMemo(() => {
    if (!session() || !enabled()) return undefined
    if (busy()) return "对话正在进行中，请等待结束后再分享"
    return undefined
  })
}
