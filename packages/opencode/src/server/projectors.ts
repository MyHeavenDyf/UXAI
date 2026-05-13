import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { SessionCategoryTable } from "@/session/session-category.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as SyncEvent.Event<typeof Session.Event.Updated>["data"]).sessionID
        const row = Database.use((db) =>
          db
            .select({ session: SessionTable, category: SessionCategoryTable.category })
            .from(SessionTable)
            .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
            .where(eq(SessionTable.id, id))
            .get(),
        )

        if (!row) return data

        return {
          sessionID: id,
          info: Session.fromRow(row.session, row.category ?? undefined),
        }
      }
      return data
    },
  })
}

initProjectors()
