// Executed by independent Bun processes: unlike the shared test preload, this uses a real file DB.
import { sql } from "drizzle-orm"
import { Database } from "../../src/storage/db"
import {
  ArtifactTurnTable as Turns,
  ArtifactScanTable as Scans,
  ArtifactEventTable as Events,
} from "../../src/tracking/artifact.sql"
import { replay } from "../../src/tracking/store"
import { recoverScans } from "../../src/tracking/scanner"

if (process.argv[2] === "seed") {
  Database.use((db) => {
    db.insert(Turns)
      .values({
        message_id: "msg_origin",
        session_id: "ses_origin",
        root_message_id: "msg_origin",
        root_session_id: "ses_origin",
        directory: process.cwd(),
        account: "original",
        owner: "server",
        created_at: 1000,
      })
      .run()
    db.run(
      sql`INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES ('restart-project', '.', '[]', 1, 1)`,
    )
    db.run(
      sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_origin', 'restart-project', 'test', '.', 'test', 'test', 1, 1)`,
    )
    db.run(
      sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_assistant', 'ses_origin', 1000, 1000, ${JSON.stringify({ role: "assistant", parentID: "msg_origin" })})`,
    )
    db.run(
      sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_result', 'msg_assistant', 'ses_origin', 1000, 1000, ${JSON.stringify({ type: "tool", tool: "write", state: { status: "completed", input: { filePath: "report.md" }, metadata: {}, time: { end: 1500 } } })})`,
    )
    db.insert(Scans)
      .values({
        message_id: "msg_origin",
        diagnostic: "observed",
        updated_at: 2000,
        baseline: JSON.stringify({
          snapshot: { complete: true, files: {}, sources: {} },
          observed: { complete: true, files: { "script.md": { digest: "observed-content", bytes: 10 } }, sources: {} },
          occurredAt: 2000,
          tool: "powershell",
        }),
      })
      .run()
  })
} else {
  replay()
  recoverScans()
  console.log(`recovered=${Database.use((db) => db.select().from(Events).all()).length}`)
}
Database.close()
