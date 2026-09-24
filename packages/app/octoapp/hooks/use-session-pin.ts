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
 *
 * `sortOrder` — when unpinning, pass the desired sort_order (typically
 * `session.time.updated`) so the server stays in sync with the optimistic
 * local update. Without this the server retains the stale pinned sort_order
 * and a subsequent refetch would scramble the list.
 */
export function useSessionPin() {
  const sdk = useGlobalSDK()

  async function togglePin(sessionID: string, pinned: boolean, directory: string, sortOrder?: number) {
    const client = sdk.createClient({ directory })
    await client.session.update({
      sessionID,
      pinned,
      directory,
      ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
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
