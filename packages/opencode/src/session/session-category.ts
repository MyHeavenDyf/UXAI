import { Effect, Layer, Context } from "effect"
import { eq, and, inArray } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { SessionCategoryTable, type SessionCategory } from "./session-category.sql"
import { SessionTable } from "./session.sql"
import type { SessionID } from "./schema"
import type { Info } from "./session"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "session-category" })

const AGENT_TO_CATEGORY: Record<string, SessionCategory> = {
  octo_ai: "dev",
  build: "dev",
  octo_design: "design",
  octo_make: "prototype",
  octo_insight: "analysis",
  octo_canva: "creative",
  plan: "planning",
}

export function agentToCategory(agentName: string): SessionCategory {
  return AGENT_TO_CATEGORY[agentName] ?? "dev"
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<SessionCategory | undefined, never>
  readonly set: (sessionID: SessionID, category: SessionCategory) => Effect.Effect<void, never>
  readonly categorize: (sessionID: SessionID, agentName: string) => Effect.Effect<void, never>
  readonly listByCategory: (
    category: SessionCategory,
    input?: { projectID?: ProjectID; limit?: number },
  ) => Effect.Effect<Info[], never>
  readonly listCategories: (sessionIDs: SessionID[]) => Effect.Effect<Map<SessionID, SessionCategory>, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCategory") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    return Service.of({
      get: (sessionID: SessionID) =>
        Effect.sync(() => {
          const row = Database.use((db) =>
            db.select().from(SessionCategoryTable).where(eq(SessionCategoryTable.session_id, sessionID)).get(),
          )
          return row?.category
        }),

      set: (sessionID: SessionID, category: SessionCategory) =>
        Effect.sync(() => {
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
        }),

      categorize: (sessionID: SessionID, agentName: string) =>
        Effect.sync(() => {
          const category = agentToCategory(agentName)
          log.debug("categorizing session", { sessionID, agentName, category })
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
        }),

      listByCategory: (category: SessionCategory, input?: { projectID?: ProjectID; limit?: number }) =>
        Effect.sync(() => {
          const limit = input?.limit ?? 100
          const conditions = [eq(SessionCategoryTable.category, category)]

          if (input?.projectID) {
            conditions.push(eq(SessionTable.project_id, input.projectID))
          }

          const rows = Database.use((db) =>
            db
              .select({ session: SessionTable })
              .from(SessionCategoryTable)
              .innerJoin(SessionTable, eq(SessionCategoryTable.session_id, SessionTable.id))
              .where(and(...conditions))
              .limit(limit)
              .all(),
          )

          return (rows ?? []).map((r) => r.session as unknown as Info)
        }),

      listCategories: (sessionIDs: SessionID[]) =>
        Effect.sync(() => {
          if (sessionIDs.length === 0) return new Map<SessionID, SessionCategory>()

          const rows = Database.use((db) =>
            db
              .select()
              .from(SessionCategoryTable)
              .where(inArray(SessionCategoryTable.session_id, sessionIDs))
              .all(),
          )

          const result = new Map<SessionID, SessionCategory>()
          for (const row of rows ?? []) {
            result.set(row.session_id, row.category)
          }
          return result
        }),
    })
  }),
)

export const defaultLayer = layer

export * as SessionCategoryService from "./session-category"
