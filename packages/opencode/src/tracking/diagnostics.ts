import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import {
  ArtifactEventTable as Events,
  ArtifactObservationTable as Observations,
  ArtifactScanTable as Scans,
  ArtifactTaskTable as Tasks,
  ArtifactTurnTable as Turns,
} from "./artifact.sql"

export function diagnostics(messageID?: string, limit = 100) {
  const size = Math.max(1, Math.min(limit, 200))
  return Database.use((db) => ({
    turns: db
      .select()
      .from(Turns)
      .where(messageID ? eq(Turns.root_message_id, messageID) : undefined)
      .limit(size)
      .all(),
    tasks: db
      .select()
      .from(Tasks)
      .where(messageID ? eq(Tasks.message_id, messageID) : undefined)
      .limit(size)
      .all(),
    observations: db
      .select()
      .from(Observations)
      .where(messageID ? eq(Observations.message_id, messageID) : undefined)
      .orderBy(Observations.updated_at)
      .limit(size)
      .all(),
    scans: db
      .select()
      .from(Scans)
      .where(messageID ? eq(Scans.message_id, messageID) : undefined)
      .limit(size)
      .all(),
    events: db
      .select({
        id: Events.id,
        message_id: Events.message_id,
        state: Events.state,
        attempts: Events.attempts,
        next_at: Events.next_at,
        reason: Events.reason,
        created_at: Events.created_at,
      })
      .from(Events)
      .where(messageID ? eq(Events.message_id, messageID) : undefined)
      .orderBy(Events.created_at)
      .limit(size)
      .all(),
  }))
}

export * as ArtifactDiagnostics from "./diagnostics"
