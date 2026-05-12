import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { migrate as drizzleMigrate } from "drizzle-orm/node-sqlite/migrator"

export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  const db = drizzle({ client: sqlite })
  return db
}

type JournalEntry = { sql: string; timestamp: number; name: string }

export function migrate(
  db: ReturnType<typeof drizzle>,
  config: JournalEntry[] | { migrationsFolder: string },
) {
  if (Array.isArray(config)) {
    const migrations = config.map((d) => ({
      sql: d.sql.split("--> statement-breakpoint"),
      folderMillis: d.timestamp,
      hash: "",
      bps: true,
      name: d.name,
    }))
    const anyDb = db as any
    return anyDb.dialect.migrate(migrations, anyDb.session, {})
  }
  return drizzleMigrate(db, config)
}
