import { useGlobalSDK } from "@/context/global-sdk"

/**
 * Shared pin/unpin logic for sessions.
 *
 * The caller is responsible for any optimistic UI updates and for re-fetching
 * the session list afterwards; this hook only performs the server-side update
 * and, when pinning, re-orders pinned sessions so the newly pinned session
 * appears first.
 *
 * `pinned` is the DESIRED new state (not the current state) so callers can
 * pass the value computed before their optimistic store mutation — avoids
 * reading a stale/mutated proxy inside the hook.
 */
export function useSessionPin() {
  const sdk = useGlobalSDK()

  async function togglePin(sessionID: string, pinned: boolean, directory: string) {
    const client = sdk.createClient({ directory })
    await client.session.update({
      sessionID,
      pinned,
      directory,
    })

    if (pinned) {
      const listResult = await client.session.list({ directory })
      const sessions = (listResult.data ?? []) as { id: string; pinned: boolean; sort_order: number | string }[]
      const pinnedIds = sessions
        .filter((s) => s.pinned && s.id !== sessionID)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((s) => s.id)
      await client.session.reorder({
        ids: [sessionID, ...pinnedIds],
        directory,
      })
    }

    return pinned
  }

  return { togglePin }
}
