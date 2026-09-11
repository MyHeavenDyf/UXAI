import { Effect, Layer, Context } from "effect"
import { eq, and, asc, inArray } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { SessionGroupTable, SessionGroupMappingTable, type SessionGroupNamespace } from "./session-group.sql"
import type { SessionID } from "./schema"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "session-group" })

export type Group = {
  id: string
  project_id: ProjectID
  directory: string
  namespace: SessionGroupNamespace
  name: string
  position: number
  time_created: number
  time_updated: number
}

export type SessionGroupMapping = Record<string, string>

export type ListResult = {
  groups: Group[]
  mapping: SessionGroupMapping
}

export interface Interface {
  readonly list: (
    directory: string,
    namespace: SessionGroupNamespace,
  ) => Effect.Effect<ListResult, never>
  readonly create: (input: {
    projectID: ProjectID
    directory: string
    namespace: SessionGroupNamespace
    name: string
  }) => Effect.Effect<Group, never>
  readonly rename: (id: string, name: string) => Effect.Effect<void, never>
  readonly remove: (id: string) => Effect.Effect<void, never>
  readonly reorder: (ids: readonly string[]) => Effect.Effect<void, never>
  readonly mapSession: (sessionID: SessionID, groupID: string) => Effect.Effect<void, never>
  readonly unmapSession: (sessionID: SessionID) => Effect.Effect<void, never>
  readonly clearGroup: (groupID: string) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGroup") {}

function fromRow(row: typeof SessionGroupTable.$inferSelect): Group {
  return {
    id: row.id,
    project_id: row.project_id,
    directory: row.directory,
    namespace: row.namespace as SessionGroupNamespace,
    name: row.name,
    position: row.position,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    return Service.of({
      list: (directory, namespace) =>
        Effect.sync(() => {
          const rows = Database.use((db) =>
            db
              .select()
              .from(SessionGroupTable)
              .where(and(eq(SessionGroupTable.directory, directory), eq(SessionGroupTable.namespace, namespace)))
              .orderBy(asc(SessionGroupTable.position), asc(SessionGroupTable.time_created))
              .all(),
          )
          const groups = (rows ?? []).map(fromRow)
          const groupIds = groups.map((g) => g.id)
          const mapping: SessionGroupMapping = {}
          if (groupIds.length > 0) {
            const mappingRows = Database.use((db) =>
              db.select().from(SessionGroupMappingTable).where(inArray(SessionGroupMappingTable.group_id, groupIds)).all(),
            )
            for (const row of mappingRows ?? []) mapping[row.session_id as string] = row.group_id
          }
          return { groups, mapping }
        }),

      create: (input) =>
        Effect.sync(() => {
          const now = Date.now()
          const id = crypto.randomUUID()
          const maxPosRow = Database.use((db) =>
            db
              .select({ max: SessionGroupTable.position })
              .from(SessionGroupTable)
              .where(
                and(
                  eq(SessionGroupTable.directory, input.directory),
                  eq(SessionGroupTable.namespace, input.namespace),
                ),
              )
              .all(),
          )
          const maxPos = maxPosRow?.reduce((acc, r) => Math.max(acc, r.max ?? -1), -1) ?? -1
          Database.use((db) =>
            db
              .insert(SessionGroupTable)
              .values({
                id,
                project_id: input.projectID,
                directory: input.directory,
                namespace: input.namespace,
                name: input.name,
                position: maxPos + 1,
                time_created: now,
                time_updated: now,
              })
              .run(),
          )
          log.debug("created group", { id, name: input.name, namespace: input.namespace })
          return {
            id,
            project_id: input.projectID,
            directory: input.directory,
            namespace: input.namespace,
            name: input.name,
            position: maxPos + 1,
            time_created: now,
            time_updated: now,
          }
        }),

      rename: (id, name) =>
        Effect.sync(() => {
          Database.use((db) =>
            db
              .update(SessionGroupTable)
              .set({ name, time_updated: Date.now() })
              .where(eq(SessionGroupTable.id, id))
              .run(),
          )
        }),

      remove: (id) =>
        Effect.sync(() => {
          Database.use((db) => db.delete(SessionGroupTable).where(eq(SessionGroupTable.id, id)).run())
        }),

      reorder: (ids) =>
        Effect.sync(() => {
          const now = Date.now()
          Database.use((db) => {
            for (let i = 0; i < ids.length; i++) {
              db.update(SessionGroupTable).set({ position: i, time_updated: now }).where(eq(SessionGroupTable.id, ids[i])).run()
            }
          })
        }),

      mapSession: (sessionID, groupID) =>
        Effect.sync(() => {
          const now = Date.now()
          Database.use((db) =>
            db
              .insert(SessionGroupMappingTable)
              .values({ session_id: sessionID, group_id: groupID, time_created: now, time_updated: now })
              .onConflictDoUpdate({
                target: SessionGroupMappingTable.session_id,
                set: { group_id: groupID, time_updated: now },
              })
              .run(),
          )
        }),

      unmapSession: (sessionID) =>
        Effect.sync(() => {
          Database.use((db) =>
            db.delete(SessionGroupMappingTable).where(eq(SessionGroupMappingTable.session_id, sessionID)).run(),
          )
        }),

      clearGroup: (groupID) =>
        Effect.sync(() => {
          Database.use((db) =>
            db.delete(SessionGroupMappingTable).where(eq(SessionGroupMappingTable.group_id, groupID)).run(),
          )
        }),
    })
  }),
)

export const defaultLayer = layer

export * as SessionGroup from "./session-group"
