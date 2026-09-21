import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { readFileSync } from "fs"
import path from "path"
import { resumableMigrations } from "@/storage/db"

test("session message migration resumes after its table was created", () => {
  const sqlite = new Database(":memory:")
  sqlite.exec("CREATE TABLE session (id text PRIMARY KEY)")
  sqlite.exec("CREATE TABLE session_entry (id text PRIMARY KEY)")
  sqlite.exec("CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)")

  sqlite.exec(
    readFileSync(path.join(import.meta.dirname, "../../migration/20260427172553_slow_nightmare/migration.sql"), "utf-8").replaceAll(
      "--> statement-breakpoint",
      "",
    ),
  )

  expect(sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_entry'").all()).toEqual([])
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'session_message_%'").all()).toHaveLength(3)
  sqlite.exec("ALTER TABLE session ADD path text")

  expect(
    resumableMigrations(drizzle({ client: sqlite }), [
      { name: "20260428004200_add_session_path", timestamp: 0, sql: "ALTER TABLE `session` ADD `path` text;" },
    ]),
  ).toEqual([{ name: "20260428004200_add_session_path", timestamp: 0, sql: "SELECT 1;" }])
})
