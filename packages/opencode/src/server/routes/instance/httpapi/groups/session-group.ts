import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { SessionID } from "@/session/schema"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const NamespaceSchema = Schema.Literals(["make", "insight"])

const GroupSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  directory: Schema.String,
  namespace: NamespaceSchema,
  name: Schema.String,
  position: Schema.Number,
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

const ListResultSchema = Schema.Struct({
  groups: Schema.Array(GroupSchema),
  mapping: Schema.Record(Schema.String, Schema.String),
})

const ListQuery = Schema.Struct({
  namespace: NamespaceSchema,
})

const CreatePayload = Schema.Struct({
  namespace: NamespaceSchema,
  name: Schema.String,
})

const IdParams = Schema.Struct({ id: Schema.String })
const RenamePayload = Schema.Struct({ name: Schema.String })
const ReorderPayload = Schema.Struct({ ids: Schema.Array(Schema.String) })
const MapSessionPayload = Schema.Struct({ sessionId: SessionID, groupId: Schema.String })
const UnmapParams = Schema.Struct({ sessionID: SessionID })

const root = "/session-group"
const SessionGroupPaths = {
  list: root,
  create: root,
  rename: `${root}/:id`,
  remove: `${root}/:id`,
  reorder: `${root}/reorder`,
  mapSession: `${root}/mapping`,
  unmapSession: `${root}/mapping/:sessionID`,
} as const

export const SessionGroupApi = HttpApi.make("session-group")
  .add(
    HttpApiGroup.make("session-group")
      .add(
        HttpApiEndpoint.get("list", SessionGroupPaths.list, {
          query: ListQuery,
          success: described(ListResultSchema, "Groups and mappings"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.list",
            summary: "List session groups",
            description: "List all session groups and their session-to-group mappings for a directory + namespace.",
          }),
        ),
        HttpApiEndpoint.post("create", SessionGroupPaths.create, {
          payload: CreatePayload,
          success: described(GroupSchema, "Created group"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.create",
            summary: "Create session group",
            description: "Create a new session group scoped to a directory + namespace.",
          }),
        ),
        HttpApiEndpoint.patch("rename", SessionGroupPaths.rename, {
          params: IdParams,
          payload: RenamePayload,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Renamed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.rename",
            summary: "Rename session group",
            description: "Rename an existing session group.",
          }),
        ),
        HttpApiEndpoint.delete("remove", SessionGroupPaths.remove, {
          params: IdParams,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.remove",
            summary: "Delete session group",
            description: "Delete a session group. Mappings for this group are removed; sessions are untouched.",
          }),
        ),
        HttpApiEndpoint.post("reorder", SessionGroupPaths.reorder, {
          payload: ReorderPayload,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Reordered"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.reorder",
            summary: "Reorder session groups",
            description: "Persist the full ordered list of group IDs.",
          }),
        ),
        HttpApiEndpoint.post("mapSession", SessionGroupPaths.mapSession, {
          payload: MapSessionPayload,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Mapped"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.mapSession",
            summary: "Map session to group",
            description: "Assign a session to a group, replacing any previous assignment.",
          }),
        ),
        HttpApiEndpoint.delete("unmapSession", SessionGroupPaths.unmapSession, {
          params: UnmapParams,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Removed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGroup.unmapSession",
            summary: "Remove session from group",
            description: "Remove a session's group assignment.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session-group",
          description: "Session group management routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode session-group HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for session group management.",
    }),
  )
