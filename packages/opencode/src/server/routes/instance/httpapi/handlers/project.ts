import { AppRuntime } from "@/effect/app-runtime"
import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpApiError } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { markInstanceForReload } from "../lifecycle"

// 优先从请求 URL 取 directory query 参数;不可用时 fallback 到 InstanceState.context
function directoryFromRequestOrContext() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
    const fromQuery = url.searchParams.get("directory")
    if (fromQuery) return fromQuery
    const ctx = yield* InstanceState.context
    return ctx.directory
  })
}

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    // 查询当前实例目录的 origin 远程仓库地址;InstanceState 不可时 fallback 到 query 参数
    const getGitRemote = Effect.fn("ProjectHttpApi.getGitRemote")(function* () {
      const dir = yield* directoryFromRequestOrContext()
      return yield* svc.getGitRemote({ directory: dir }).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    // 关联远程代码仓:传 url,由 Service 层完成 git init(如需)+ remote add/set-url
    const addGitRemote = Effect.fn("ProjectHttpApi.addGitRemote")(function* (ctx: {
      payload: { url: string }
    }) {
      const dir = yield* directoryFromRequestOrContext()
      return yield* svc.addGitRemote({ directory: dir, url: ctx.payload.url }).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID })
    })

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("getGitRemote", getGitRemote)
      .handle("addGitRemote", addGitRemote)
      .handle("update", update)
  }),
)
