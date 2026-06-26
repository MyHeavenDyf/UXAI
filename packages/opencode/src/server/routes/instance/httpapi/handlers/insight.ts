import * as InstanceState from "@/effect/instance-state"
import { listInsightSessions } from "@/session/session-insight-query"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InsightSessionListQuery } from "../groups/insight"

export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const listSessions = Effect.fn("InsightHttpApi.listSessions")(function* (ctx: {
      query: typeof InsightSessionListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return listInsightSessions({
        projectID: instance.project.id,
        directory: ctx.query.directory ?? instance.directory,
        limit: ctx.query.limit ?? 100,
        offset: ctx.query.offset ?? 0,
      })
    })

    return handlers.handle("listSessions", listSessions)
  }),
)
