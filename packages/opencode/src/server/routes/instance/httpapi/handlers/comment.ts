import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Comment } from "@/comment"

// `filePath` is the pre-rename alias for `commentFilePath`.
function resolveCommentFilePath(input: { commentFilePath?: string; filePath?: string }): string | undefined {
  return input.commentFilePath ?? input.filePath
}

// scope=project(代码工作区)时 sessionId 可缺省;session scope 必须提供 sessionId
const requireScope = (req: { sessionId?: string; scope?: "project" }) =>
  Effect.gen(function* () {
    const sessionId = req.sessionId ?? ""
    if (req.scope !== "project" && sessionId === "") {
      yield* new HttpApiError.BadRequest({})
    }
    return { sessionId, scope: req.scope }
  })

export const commentHandlers = HttpApiBuilder.group(InstanceHttpApi, "comment", (handlers) =>
  Effect.gen(function* () {
    const load = Effect.fn("CommentHttpApi.load")(function* (ctx: {
      query: { sessionId?: string; commentFilePath?: string; filePath?: string; scope?: "project" }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const { sessionId, scope } = yield* requireScope(ctx.query)
      const comments = yield* comment.load(sessionId, commentFilePath, scope).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { comments }
    })

    const save = Effect.fn("CommentHttpApi.save")(function* (ctx: {
      payload: { sessionId?: string; commentFilePath?: string; filePath?: string; comment: Comment.FileComment; scope?: "project" }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.payload)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const { sessionId, scope } = yield* requireScope(ctx.payload)
      yield* comment.save(sessionId, commentFilePath, ctx.payload.comment, scope).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const delete_ = Effect.fn("CommentHttpApi.delete")(function* (ctx: {
      query: { sessionId?: string; commentFilePath?: string; filePath?: string; commentId: string; scope?: "project" }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const { sessionId, scope } = yield* requireScope(ctx.query)
      yield* comment.delete(sessionId, commentFilePath, ctx.query.commentId, scope).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    // Legacy path (commentId as a path param); sessionId required, no scope
    // (legacy clients don't know about project scope).
    const deleteLegacy = Effect.fn("CommentHttpApi.deleteLegacy")(function* (ctx: {
      params: { commentId: string }
      query: { sessionId: string; commentFilePath?: string; filePath?: string }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      yield* comment.delete(ctx.query.sessionId, commentFilePath, ctx.params.commentId).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const deleteAttachment = Effect.fn("CommentHttpApi.deleteAttachment")(function* (ctx: {
      params: { attachmentId: string }
      query: { sessionId?: string; commentFilePath?: string; filePath?: string; commentId: string; scope?: "project" }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const { sessionId, scope } = yield* requireScope(ctx.query)
      yield* comment.deleteAttachment(sessionId, commentFilePath, ctx.query.commentId, ctx.params.attachmentId, scope).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const uploadAttachment = Effect.fn("CommentHttpApi.uploadAttachment")(function* (ctx: {
      payload: {
        sessionId?: string
        commentFilePath?: string
        filePath?: string
        commentId: string
        sourceFilePath: string
        filename: string
        mime: string
        size: number
        scope?: "project"
      }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.payload)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const { sessionId, scope } = yield* requireScope(ctx.payload)
      const attachment = yield* comment.uploadAttachment(sessionId, commentFilePath, ctx.payload.commentId, {
        sourceFilePath: ctx.payload.sourceFilePath,
        filename: ctx.payload.filename,
        mime: ctx.payload.mime,
        size: ctx.payload.size,
      }, scope).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true, attachment }
    })

    return handlers.handle("load", load).handle("save", save).handle("delete", delete_).handle("deleteLegacy", deleteLegacy).handle("deleteAttachment", deleteAttachment).handle("uploadAttachment", uploadAttachment)
  }),
).pipe(Layer.provide(Comment.defaultLayer))
