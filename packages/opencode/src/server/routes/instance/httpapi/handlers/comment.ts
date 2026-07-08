import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Comment } from "@/comment"

export const commentHandlers = HttpApiBuilder.group(InstanceHttpApi, "comment", (handlers) =>
  Effect.gen(function* () {
    const comment = yield* Comment.Service

    const load = Effect.fn("CommentHttpApi.load")(function* (ctx: { query: { sessionId: string; filePath: string } }) {
      const comments = yield* comment.load(ctx.query.sessionId, ctx.query.filePath)
      return { comments }
    })

    const save = Effect.fn("CommentHttpApi.save")(function* (ctx: { payload: { sessionId: string; filePath: string; comment: Comment.FileComment } }) {
      yield* comment.save(ctx.payload.sessionId, ctx.payload.filePath, ctx.payload.comment)
      return { ok: true }
    })

    const delete_ = Effect.fn("CommentHttpApi.delete")(function* (ctx: { query: { sessionId: string; filePath: string; commentId: string } }) {
      yield* comment.delete(ctx.query.sessionId, ctx.query.filePath, ctx.query.commentId)
      return { ok: true }
    })

    const deleteAttachment = Effect.fn("CommentHttpApi.deleteAttachment")(function* (ctx: { params: { attachmentId: string }; query: { sessionId: string; filePath: string; commentId: string } }) {
      yield* comment.deleteAttachment(ctx.query.sessionId, ctx.query.filePath, ctx.query.commentId, ctx.params.attachmentId)
      return { ok: true }
    })

    const uploadAttachment = Effect.fn("CommentHttpApi.uploadAttachment")(function* (ctx: { payload: { sessionId: string; filePath: string; commentId: string; sourceFilePath: string; filename: string; mime: string; size: number } }) {
      const attachment = yield* comment.uploadAttachment(ctx.payload.sessionId, ctx.payload.filePath, ctx.payload.commentId, {
        sourceFilePath: ctx.payload.sourceFilePath,
        filename: ctx.payload.filename,
        mime: ctx.payload.mime,
        size: ctx.payload.size,
      })
      return { ok: true, attachment }
    })

    return handlers.handle("load", load).handle("save", save).handle("delete", delete_).handle("deleteAttachment", deleteAttachment).handle("uploadAttachment", uploadAttachment)
  }),
)