import { GlobalBus } from "@/bus/global"
import type { PermissionID } from "./schema"
import type { Request } from "./index"

export interface PendingAsk {
  directory: string
  project?: string
  workspace?: string
  info: Request
}

const pending = new Map<PermissionID, PendingAsk>()

export function trackPendingAsk(id: PermissionID, ask: PendingAsk) {
  pending.set(id, ask)
}

export function untrackPendingAsk(id: PermissionID) {
  pending.delete(id)
}

export function pendingAskCount() {
  return pending.size
}

export function clearPendingAsks() {
  pending.clear()
}

/**
 * Replay all pending permission asks on the global event bus.
 *
 * Called when a new global SSE connection is established: a client that was
 * frozen/disconnected when the ask was published never received the
 * permission.asked event, and the server waits on the deferred indefinitely.
 * Re-emitting through GlobalBus takes the exact same path as a live ask, so
 * every existing client (old builds included) recovers without changes.
 * Entries are only tracked while unanswered, and clients dedupe by request id,
 * so repeated replays are idempotent.
 */
export function emitPendingAsks() {
  for (const ask of pending.values()) {
    GlobalBus.emit("event", {
      directory: ask.directory,
      project: ask.project,
      workspace: ask.workspace,
      payload: {
        type: "permission.asked",
        properties: ask.info,
      },
    })
  }
}
