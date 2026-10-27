import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, createResource, type Accessor } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useSessionShareBusy } from "./use-session-share-busy"

export function useSessionShareBlockReason(session: Accessor<Session | null>, enabled: Accessor<boolean> = () => true) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const busy = useSessionShareBusy(session)
  const [children] = createResource(
    () => {
      const current = session()
      return enabled() && current ? `${current.directory}\0${current.id}` : undefined
    },
    async (key) => {
      const parts = key.split("\0")
      return (await sdk.client.session.children({ sessionID: parts[1], directory: parts[0] }, { throwOnError: true })).data ?? []
    },
  )
  return createMemo(() => {
    const current = session()
    if (!current || !enabled()) return undefined
    if (busy()) return "对话正在进行中，请等待结束后再分享"
    if (sync.child(current.directory)[0].session.some((item) => item.parentID === current.id)) return "该对话包含子对话，暂不支持分享"
    if (children.loading) return "正在检查子对话，请稍候"
    if (children.error) return "无法检查子对话，请关闭后重试"
    if (children()?.length) return "该对话包含子对话，暂不支持分享"
    return undefined
  })
}
