import type { Session } from "@opencode-ai/sdk/v2/client"

/** Pick the sibling session to navigate to after deleting `sessionID` from `sessions`. */
export function pickNextSession(sessions: Session[], sessionID: string): Session | undefined {
  const index = sessions.findIndex((s) => s.id === sessionID)
  return index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])
}

/** Extract a human-readable message from an SDK error (prefers `err.data.message`, then `Error.message`). */
export function sessionErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

/** Filter out archived (and optionally agent-mismatched) sessions and sort newest-first by `time.updated`. */
export function sortedActiveSessions(sessions: Session[], agent?: string): Session[] {
  return sessions
    .filter((s) => !s.time?.archived && (!agent || s.agent === agent))
    .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
}
