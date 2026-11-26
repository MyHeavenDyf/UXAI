import { GlobalBus } from "@/bus/global"
import type { QuestionID } from "./schema"
import type { Request } from "./index"

export interface PendingAsk {
  directory: string
  project?: string
  workspace?: string
  info: Request
}

const pending = new Map<QuestionID, PendingAsk>()

export function trackPendingAsk(id: QuestionID, ask: PendingAsk) {
  pending.set(id, ask)
}

export function untrackPendingAsk(id: QuestionID) {
  pending.delete(id)
}

export function pendingAskCount() {
  return pending.size
}

export function clearPendingAsks() {
  pending.clear()
}

/**
 * Replay all pending question asks on the global event bus.
 *
 * Called when a new global SSE connection is established: a client that was
 * frozen/disconnected when the ask was published never received the
 * question.asked event, and the server waits on the deferred indefinitely
 * (子代理 question 尤其致命——挂起的 task 子会话会永久卡死)。Re-emitting
 * through GlobalBus takes the exact same path as a live ask, so every existing
 * client recovers without changes. Entries are only tracked while unanswered,
 * and clients dedupe by request id, so repeated replays are idempotent.
 */
export function emitPendingAsks() {
  for (const ask of pending.values()) {
    GlobalBus.emit("event", {
      directory: ask.directory,
      project: ask.project,
      workspace: ask.workspace,
      payload: {
        type: "question.asked",
        properties: ask.info,
      },
    })
  }
}
