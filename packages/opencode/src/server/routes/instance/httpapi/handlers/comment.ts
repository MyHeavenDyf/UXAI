import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Comment } from "@/comment"

// `filePath` is the pre-rename alias for `commentFilePath`.
function resolveCommentFilePath(input: { commentFilePath?: string; filePath?: string }): string | undefined {
  return input.commentFilePath ?? input.filePath
}

export const commentHandlers = HttpApiBuilder.group(InstanceHttpApi, "comment", (handlers) =>
  Effect.gen(function* () {
    const load = Effect.fn("CommentHttpApi.load")(function* (ctx: {
      query: { sessionId: string; commentFilePath?: string; filePath?: string }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const comments = yield* comment.load(ctx.query.sessionId, commentFilePath).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { comments }
    })

    const save = Effect.fn("CommentHttpApi.save")(function* (ctx: {
      payload: { sessionId: string; commentFilePath?: string; filePath?: string; comment: Comment.FileComment }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.payload)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      yield* comment.save(ctx.payload.sessionId, commentFilePath, ctx.payload.comment).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const delete_ = Effect.fn("CommentHttpApi.delete")(function* (ctx: {
      query: { sessionId: string; commentFilePath?: string; filePath?: string; commentId: string }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      yield* comment.delete(ctx.query.sessionId, commentFilePath, ctx.query.commentId).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

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
      query: { sessionId: string; commentFilePath?: string; filePath?: string; commentId: string }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.query)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      yield* comment.deleteAttachment(ctx.query.sessionId, commentFilePath, ctx.query.commentId, ctx.params.attachmentId).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const uploadAttachment = Effect.fn("CommentHttpApi.uploadAttachment")(function* (ctx: {
      payload: {
        sessionId: string
        commentFilePath?: string
        filePath?: string
        commentId: string
        sourceFilePath: string
        filename: string
        mime: string
        size: number
      }
    }) {
      const commentFilePath = resolveCommentFilePath(ctx.payload)
      if (!commentFilePath) return yield* new HttpApiError.BadRequest({})
      const comment = yield* Comment.Service
      const attachment = yield* comment.uploadAttachment(ctx.payload.sessionId, commentFilePath, ctx.payload.commentId, {
        sourceFilePath: ctx.payload.sourceFilePath,
        filename: ctx.payload.filename,
        mime: ctx.payload.mime,
        size: ctx.payload.size,
      }).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true, attachment }
    })

    return handlers.handle("load", load).handle("save", save).handle("delete", delete_).handle("deleteLegacy", deleteLegacy).handle("deleteAttachment", deleteAttachment).handle("uploadAttachment", uploadAttachment)
  }),
).pipe(Layer.provide(Comment.defaultLayer))