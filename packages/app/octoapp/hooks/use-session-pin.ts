import { useGlobalSDK } from "@/context/global-sdk"

// Remember the "最近" sort_order a session held before it was pinned, so
// unpinning can restore its previous position instead of jumping to the top
// (or bottom) of the list. Persisted per session under its own localStorage
// key so concurrent tabs can't clobber each other through a shared
// read-modify-write blob. Entries are pruned by age (oldest first) once the
// count exceeds the cap, so sessions deleted while pinned can't accumulate.
const PRE_PIN_ORDER_PREFIX = "octo:session-pre-pin-sort-order:"
const PRE_PIN_ORDER_LIMIT = 100
// Earlier iteration stored every session in one blob under this key.
const LEGACY_PRE_PIN_ORDER_KEY = "octo:session-pre-pin-sort-order"

type PrePinEntry = { order: number; at: number }

function store(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    // The localStorage getter itself can throw (sandboxed iframe, storage
    // blocked). Treat it as "no storage" so pin/unpin never breaks.
    return undefined
  }
}

function parseEntry(raw: string | null): PrePinEntry | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === "number" && Number.isFinite(parsed)) return { order: parsed, at: 0 }
    if (parsed && typeof parsed === "object") {
      const { order, at } = parsed as { order?: unknown; at?: unknown }
      if (typeof order === "number" && Number.isFinite(order)) {
        return { order, at: typeof at === "number" && Number.isFinite(at) ? at : 0 }
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

let legacyMigrated = false
function migrateLegacyPrePinOrders() {
  if (legacyMigrated) return
  // Only mark as migrated once storage is actually available, otherwise a
  // transiently-unavailable store would permanently skip the migration.
  const localStorageStore = store()
  if (!localStorageStore) return
  legacyMigrated = true
  try {
    const raw = localStorageStore.getItem(LEGACY_PRE_PIN_ORDER_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      for (const [id, value] of Object.entries(parsed)) {
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          localStorageStore.getItem(PRE_PIN_ORDER_PREFIX + id) === null
        ) {
          localStorageStore.setItem(PRE_PIN_ORDER_PREFIX + id, JSON.stringify({ order: value, at: 0 }))
        }
      }
    }
    localStorageStore.removeItem(LEGACY_PRE_PIN_ORDER_KEY)
    prunePrePinOrders(localStorageStore)
  } catch {
    try {
      localStorageStore.removeItem(LEGACY_PRE_PIN_ORDER_KEY)
    } catch {
      // ignore
    }
  }
}

/** Peek the sort_order to restore when unpinning `sessionID` (undefined if unknown or corrupt). */
export function peekRecentSortOrderBeforePin(sessionID: string): number | undefined {
  migrateLegacyPrePinOrders()
  return parseEntry(store()?.getItem(PRE_PIN_ORDER_PREFIX + sessionID) ?? null)?.order
}

function rememberRecentSortOrderBeforePin(sessionID: string, order: number) {
  const localStorageStore = store()
  if (!localStorageStore) return
  try {
    localStorageStore.setItem(PRE_PIN_ORDER_PREFIX + sessionID, JSON.stringify({ order, at: Date.now() }))
    prunePrePinOrders(localStorageStore)
  } catch {
    // Storage may be unavailable (quota exceeded / private mode). The pin
    // already succeeded server-side, so a memory failure must not reject it.
  }
}

function forgetRecentSortOrderBeforePin(sessionID: string) {
  try {
    store()?.removeItem(PRE_PIN_ORDER_PREFIX + sessionID)
  } catch {
    // ignore
  }
}

function prunePrePinOrders(localStorageStore: Storage) {
  const keys = Object.keys(localStorageStore).filter((key) => key.startsWith(PRE_PIN_ORDER_PREFIX))
  if (keys.length <= PRE_PIN_ORDER_LIMIT) return
  const oldest = keys
    .map((key) => ({ key, at: parseEntry(localStorageStore.getItem(key))?.at ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, keys.length - PRE_PIN_ORDER_LIMIT)
  for (const { key } of oldest) localStorageStore.removeItem(key)
}

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
 * `rememberRecentOrder` (pin) — the session's current "最近" sort_order, saved
 * so unpinning can restore it (non-finite values are ignored).
 * `restoreRecentOrder` (unpin) — the sort_order to write back; callers resolve
 * it as `peekRecentSortOrderBeforePin(id) ?? 0`, so sessions pinned before this
 * memory existed (or on another device) fall back to `0` and merge into the
 * "最近" list by `time.updated`.
 */
export function useSessionPin() {
  const sdk = useGlobalSDK()

  async function togglePin(
    sessionID: string,
    pinned: boolean,
    directory: string,
    options?: { rememberRecentOrder?: number; restoreRecentOrder?: number },
  ) {
    const client = sdk.createClient({ directory })

    if (pinned) {
      await client.session.update({ sessionID, pinned, directory })
      const order = options?.rememberRecentOrder
      if (order !== undefined && Number.isFinite(order)) {
        rememberRecentSortOrderBeforePin(sessionID, order)
      }
    } else {
      await client.session.update({ sessionID, pinned, directory, sort_order: options?.restoreRecentOrder ?? 0 })
      // Only clear the memory once the server confirms the unpin, so a failed
      // request does not lose the remembered position.
      forgetRecentSortOrderBeforePin(sessionID)
    }

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
