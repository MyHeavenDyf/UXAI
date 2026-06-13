import { Database } from "@/storage/db"
import { eq, and, gte, isNull, desc, like, inArray, lt, or, sql } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { SessionTable, PartTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { SessionCategoryTable } from "./session-category.sql"
import { agentToCategory } from "./session-category"
import { fromRow, type Info, type GlobalInfo, type ListInput } from "./session"
import type { SessionID } from "./schema"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "session-category-query" })

export function getWithCategory(id: SessionID): Info | null {
  const row = Database.use((db) =>
    db
      .select({ session: SessionTable, category: SessionCategoryTable.category })
      .from(SessionTable)
      .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
      .where(eq(SessionTable.id, id))
      .get(),
  )
  if (!row) return null
  try {
    return fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)
  } catch (err) {
    log.error("session-get:bad-row", { sessionID: id, error: String(err) })
    return null
  }
}

export function childrenWithCategory(parentID: SessionID): Info[] {
  const rows = Database.use((db) =>
    db
      .select({ session: SessionTable, category: SessionCategoryTable.category })
      .from(SessionTable)
      .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
      .where(and(eq(SessionTable.parent_id, parentID)))
      .all(),
  )
  return rows.flatMap((row) => {
    try {
      return [fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)]
    } catch (err) {
      log.error("session-children:skip-bad-row", { sessionID: row.session.id, error: String(err) })
      return []
    }
  })
}

export function* listByProjectWithCategory(
  input: ListInput & { projectID: ProjectID },
): Generator<Info> {
  const conditions = [eq(SessionTable.project_id, input.projectID)]

  if (input.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (input.path !== undefined) {
    if (input.path) {
      const conds = [eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`)]
      conditions.push(
        input.directory
          ? or(...conds, and(isNull(SessionTable.path), eq(SessionTable.directory, input.directory))!)!
          : or(...conds)!,
      )
    }
  } else if (input.scope !== "project") {
    if (input.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
  }
  if (input.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input.limit ?? 100

  const rows = Database.use((db) =>
    db
      .select({ session: SessionTable, category: SessionCategoryTable.category })
      .from(SessionTable)
      .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
      .where(
        input.category
          ? and(...conditions, sql`${SessionCategoryTable.category} = ${input.category}`)
          : and(...conditions),
      )
      .orderBy(desc(SessionTable.time_updated))
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    try {
      yield fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)
    } catch (err) {
      log.error("session-list:skip-bad-row", { sessionID: row.session.id, error: String(err) })
    }
  }
}

export function* listGlobalWithCategory(input?: {
  directory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}): Generator<GlobalInfo> {
  const conditions: (ReturnType<typeof sql> | ReturnType<typeof eq> | ReturnType<typeof gte> | ReturnType<typeof isNull> | ReturnType<typeof lt> | ReturnType<typeof like>)[] = []

  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input?.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input?.cursor) {
    conditions.push(lt(SessionTable.time_updated, input.cursor))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }
  if (!input?.archived) {
    conditions.push(isNull(SessionTable.time_archived))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) => {
    const base = db
      .select({ session: SessionTable, category: SessionCategoryTable.category })
      .from(SessionTable)
      .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
    const query =
      conditions.length > 0
        ? base.where(and(...conditions))
        : base
    return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
  })

  const ids = [...new Set(rows.map((row) => row.session.project_id))]
  const projects = new Map<string, GlobalInfo["project"]>()

  if (ids.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(inArray(ProjectTable.id, ids))
        .all(),
    )
    for (const item of items) {
      projects.set(item.id, {
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
      })
    }
  }

  for (const row of rows) {
    try {
      const project = projects.get(row.session.project_id) ?? null
      yield { ...fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined), project }
    } catch (err) {
      log.error("session-global-list:skip-bad-row", { sessionID: row.session.id, error: String(err) })
    }
  }
}

export function getAllWithCategory(): Info[] {
  return Database.use((db) =>
    db
      .select({ session: SessionTable, category: SessionCategoryTable.category })
      .from(SessionTable)
      .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
      .all(),
  ).flatMap((row) => {
    try {
      return [fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)]
    } catch (err) {
      log.error("session-all:skip-bad-row", { sessionID: row.session.id, error: String(err) })
      return []
    }
  })
}

export function insertCategory(sessionID: SessionID, agentName: string): void {
  const category = agentToCategory(agentName)
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(SessionCategoryTable)
      .values({ session_id: sessionID, category, time_created: now, time_updated: now })
      .onConflictDoUpdate({
        target: SessionCategoryTable.session_id,
        set: { category, time_updated: now },
      })
      .run(),
  )
}

export function syncOnAgentSwitch(
  db: Parameters<Parameters<typeof Database.use>[0]>[0],
  sessionID: SessionID,
  agentName: string,
  timestamp: number,
): void {
  const category = agentToCategory(agentName)
  db.insert(SessionCategoryTable)
    .values({ session_id: sessionID, category, time_created: timestamp, time_updated: timestamp })
    .onConflictDoNothing({ target: SessionCategoryTable.session_id })
    .run()
}
