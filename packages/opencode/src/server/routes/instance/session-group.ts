import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { SessionGroup } from "@/session/session-group"
import { SessionID } from "@/session/schema"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { errors } from "../../error"

const NamespaceSchema = z.enum(["make", "insight"])

const GroupSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  directory: z.string(),
  namespace: NamespaceSchema,
  name: z.string(),
  position: z.number(),
  time_created: z.number(),
  time_updated: z.number(),
})

const ListResultSchema = z.object({
  groups: z.array(GroupSchema),
  mapping: z.record(z.string(), z.object({
    groupId: z.string(),
    position: z.number(),
  })),
})

export const SessionGroupRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List session groups",
        description: "List all session groups and their session-to-group mappings for a directory + namespace.",
        operationId: "sessionGroup.list",
        responses: {
          200: {
            description: "Groups and mappings",
            content: {
              "application/json": {
                schema: resolver(ListResultSchema),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          namespace: NamespaceSchema.meta({ description: "Group namespace (make/insight)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return jsonRequest("SessionGroupRoutes.list", c, function* () {
          const svc = yield* SessionGroup.Service
          return yield* svc.list(Instance.directory, query.namespace)
        })
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session group",
        description: "Create a new session group scoped to a directory + namespace.",
        operationId: "sessionGroup.create",
        responses: {
          200: {
            description: "Created group",
            content: {
              "application/json": {
                schema: resolver(GroupSchema),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          namespace: NamespaceSchema,
          name: z.string().min(1).max(50),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return jsonRequest("SessionGroupRoutes.create", c, function* () {
          const svc = yield* SessionGroup.Service
          return yield* svc.create({
            projectID: Instance.project.id,
            directory: Instance.directory,
            namespace: body.namespace,
            name: body.name,
          })
        })
      },
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Rename session group",
        description: "Rename an existing session group.",
        operationId: "sessionGroup.rename",
        responses: {
          200: {
            description: "Renamed",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      validator("json", z.object({ name: z.string().min(1).max(50) })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return jsonRequest("SessionGroupRoutes.rename", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.rename(params.id, body.name)
          return { ok: true }
        })
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete session group",
        description: "Delete a session group. Session-to-group mappings for this group are removed (sessions themselves are untouched).",
        operationId: "sessionGroup.remove",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        return jsonRequest("SessionGroupRoutes.remove", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.remove(params.id)
          return { ok: true }
        })
      },
    )
    .post(
      "/reorder",
      describeRoute({
        summary: "Reorder session groups",
        description: "Persist the full ordered list of group IDs for a directory + namespace.",
        operationId: "sessionGroup.reorder",
        responses: {
          200: {
            description: "Reordered",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ ids: z.array(z.string()) })),
      async (c) => {
        const body = c.req.valid("json")
        return jsonRequest("SessionGroupRoutes.reorder", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.reorder(body.ids)
          return { ok: true }
        })
      },
    )
    .post(
      "/mapping",
      describeRoute({
        summary: "Map session to group",
        description: "Assign a session to a group. Replaces any previous group assignment for that session.",
        operationId: "sessionGroup.mapSession",
        responses: {
          200: {
            description: "Mapped",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          sessionId: SessionID.zod,
          groupId: z.string(),
          position: z.number().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return jsonRequest("SessionGroupRoutes.mapSession", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.mapSession(body.sessionId, body.groupId, body.position)
          return { ok: true }
        })
      },
    )
    .post(
      "/reorder-sessions",
      describeRoute({
        summary: "Reorder sessions within a group",
        description: "Update the position of sessions within a group.",
        operationId: "sessionGroup.reorderSessions",
        responses: {
          200: {
            description: "Reordered",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          groupId: z.string(),
          sessionIds: z.array(z.string()),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return jsonRequest("SessionGroupRoutes.reorderSessions", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.reorderSessions(body.groupId, body.sessionIds)
          return { ok: true }
        })
      },
    )
    .delete(
      "/mapping/:sessionID",
      describeRoute({
        summary: "Remove session from group",
        description: "Remove a session's group assignment.",
        operationId: "sessionGroup.unmapSession",
        responses: {
          200: {
            description: "Removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const params = c.req.valid("param")
        return jsonRequest("SessionGroupRoutes.unmapSession", c, function* () {
          const svc = yield* SessionGroup.Service
          yield* svc.unmapSession(params.sessionID)
          return { ok: true }
        })
      },
    ),
)
