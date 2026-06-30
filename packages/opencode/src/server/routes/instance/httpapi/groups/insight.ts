import { Session } from "@/session/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

// insight 专用接口组(SPEC-INS-013)。独立成组(照 groups/studio.ts 样板),不碰 session 组。
const root = "/insight"

export const InsightPaths = {
  sessions: `${root}/sessions`,
} as const

export const InsightSessionListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

export const InsightSessionListResult = Schema.Struct({
  items: Schema.Array(Session.Info),
  total: Schema.Number,
})

export const InsightApi = HttpApi.make("insight")
  .add(
    HttpApiGroup.make("insight")
      .add(
        HttpApiEndpoint.get("listSessions", InsightPaths.sessions, {
          query: InsightSessionListQuery,
          success: described(InsightSessionListResult, "Insight sessions page"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "insight.sessions.list",
            summary: "List insight sessions (paged)",
            description:
              "List octo_insight sessions for a directory, agent-filtered server-side, with total count for pagination.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "insight",
          description: "Insight-specific instance routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode insight HttpApi",
      version: "0.0.1",
      description: "Insight-specific HttpApi surface for the insight module.",
    }),
  )
