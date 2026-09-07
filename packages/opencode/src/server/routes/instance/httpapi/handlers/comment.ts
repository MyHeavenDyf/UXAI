import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Comment } from "@/comment"

export const commentHandlers = HttpApiBuilder.group(InstanceHttpApi, "comment", (handlers) =>
  Effect.gen(function* () {
    const load = Effect.fn("CommentHttpApi.load")(function* (ctx: { query: { sessionId: string; commentFilePath: string } }) {
      const comment = yield* Comment.Service
      const comments = yield* comment.load(ctx.query.sessionId, ctx.query.commentFilePath).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { comments }
    })

    const save = Effect.fn("CommentHttpApi.save")(function* (ctx: { payload: { sessionId: string; commentFilePath: string; comment: Comment.FileComment } }) {
      const comment = yield* Comment.Service
      yield* comment.save(ctx.payload.sessionId, ctx.payload.commentFilePath, ctx.payload.comment).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const delete_ = Effect.fn("CommentHttpApi.delete")(function* (ctx: { query: { sessionId: string; commentFilePath: string; commentId: string } }) {
      const comment = yield* Comment.Service
      yield* comment.delete(ctx.query.sessionId, ctx.query.commentFilePath, ctx.query.commentId).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const deleteAttachment = Effect.fn("CommentHttpApi.deleteAttachment")(function* (ctx: { params: { attachmentId: string }; query: { sessionId: string; commentFilePath: string; commentId: string } }) {
      const comment = yield* Comment.Service
      yield* comment.deleteAttachment(ctx.query.sessionId, ctx.query.commentFilePath, ctx.query.commentId, ctx.params.attachmentId).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true }
    })

    const uploadAttachment = Effect.fn("CommentHttpApi.uploadAttachment")(function* (ctx: { payload: { sessionId: string; commentFilePath: string; commentId: string; sourceFilePath: string; filename: string; mime: string; size: number } }) {
      const comment = yield* Comment.Service
      const attachment = yield* comment.uploadAttachment(ctx.payload.sessionId, ctx.payload.commentFilePath, ctx.payload.commentId, {
        sourceFilePath: ctx.payload.sourceFilePath,
        filename: ctx.payload.filename,
        mime: ctx.payload.mime,
        size: ctx.payload.size,
      }).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({}))
      )
      return { ok: true, attachment }
    })

    return handlers.handle("load", load).handle("save", save).handle("delete", delete_).handle("deleteAttachment", deleteAttachment).handle("uploadAttachment", uploadAttachment)
  }),
).pipe(Layer.provide(Comment.defaultLayer))