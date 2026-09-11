import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SessionGroup } from "@/session/session-group"
import { SessionID } from "@/session/schema"
import * as InstanceState from "@/effect/instance-state"

export const sessionGroupHandlers = HttpApiBuilder.group(InstanceHttpApi, "session-group", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* SessionGroup.Service

    const list = Effect.fn("SessionGroupHttpApi.list")(function* (ctx: {
      query: { namespace: "make" | "insight" }
    }) {
      const directory = (yield* InstanceState.context).directory
      return yield* svc.list(directory, ctx.query.namespace)
    })

    const create = Effect.fn("SessionGroupHttpApi.create")(function* (ctx: {
      payload: { namespace: "make" | "insight"; name: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* svc.create({
        projectID: instance.project.id,
        directory: instance.directory,
        namespace: ctx.payload.namespace,
        name: ctx.payload.name,
      })
    })

    const rename = Effect.fn("SessionGroupHttpApi.rename")(function* (ctx: {
      params: { id: string }
      payload: { name: string }
    }) {
      yield* svc.rename(ctx.params.id, ctx.payload.name)
      return { ok: true }
    })

    const remove = Effect.fn("SessionGroupHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      yield* svc.remove(ctx.params.id)
      return { ok: true }
    })

    const reorder = Effect.fn("SessionGroupHttpApi.reorder")(function* (ctx: { payload: { ids: readonly string[] } }) {
      yield* svc.reorder(ctx.payload.ids)
      return { ok: true }
    })

    const mapSession = Effect.fn("SessionGroupHttpApi.mapSession")(function* (ctx: {
      payload: { sessionId: string; groupId: string }
    }) {
      yield* svc.mapSession(ctx.payload.sessionId as SessionID, ctx.payload.groupId)
      return { ok: true }
    })

    const unmapSession = Effect.fn("SessionGroupHttpApi.unmapSession")(function* (ctx: {
      params: { sessionID: string }
    }) {
      yield* svc.unmapSession(ctx.params.sessionID as SessionID)
      return { ok: true }
    })

    return handlers
      .handle("list", list)
      .handle("create", create)
      .handle("rename", rename)
      .handle("remove", remove)
      .handle("reorder", reorder)
      .handle("mapSession", mapSession)
      .handle("unmapSession", unmapSession)
  }),
).pipe(Layer.provide(SessionGroup.defaultLayer))
