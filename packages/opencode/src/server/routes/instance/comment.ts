import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { jsonRequest, runRequest } from "./trace"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { Comment, type CommentAttachment } from "@/comment"

const CommentPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

const CommentAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number(),
  filePath: z.string(),
  uploadedAt: z.number(),
})

const FileCommentSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  elementId: z.string(),
  selector: z.string(),
  contentSignature: z.string().optional(),
  nativeId: z.string().optional(),
  label: z.string(),
  text: z.string(),
  position: CommentPositionSchema,
  htmlHint: z.string(),
  note: z.string(),
  attachments: z.array(CommentAttachmentSchema).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  commenterAccount: z.string().optional(),
  commenterName: z.string().optional(),
  commenterAvatar: z.string().optional(),
})

// scope=project(代码工作�?�?sessionId 可缺�?标注按项目级存储);否则必填�?
// 直接内联各字段的 z.object(...).refine(...) 写法(泛型封装会让 refine 回调的类型推导失�?�?
const scopeRefine = (v: { sessionId?: string; scope?: "project" }) => v.scope === "project" || !!v.sessionId
const SCOPE_REFINE_MESSAGE = "sessionId is required unless scope=project"

export const CommentRoutes = lazy(() =>
  new Hono()
    .get(
      "/file",
      describeRoute({
        summary: "Load comments for artifact file",
        description: "Load all comments associated with an artifact file from .comments.json",
        operationId: "comment.load",
        responses: {
          200: {
            description: "Comments loaded successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  comments: z.array(FileCommentSchema),
                })),
              },
            },
          },
        },
      }),
      validator("query", z.object({
        sessionId: z.string().optional(),
        scope: z.enum(["project"]).optional(),
        filePath: z.string(),
      }).refine(scopeRefine, { message: SCOPE_REFINE_MESSAGE })),
      async (c) => {
        const { sessionId, filePath, scope } = c.req.valid("query")

        return runRequest("comment.load", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          const comments = yield* comment.load(sessionId ?? "", filePath, scope)

          return c.json({ comments })
        }))
      }
    )
    .post(
      "/file",
      describeRoute({
        summary: "Save comment",
        description: "Create or update a comment for an artifact file",
        operationId: "comment.save",
        responses: {
          200: {
            description: "Comment saved successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  ok: z.boolean(),
                })),
              },
            },
          },
        },
      }),
      validator("json", z.object({
        sessionId: z.string().optional(),
        scope: z.enum(["project"]).optional(),
        filePath: z.string(),
        comment: FileCommentSchema,
      }).refine(scopeRefine, { message: SCOPE_REFINE_MESSAGE })),
      async (c) => {
        const { sessionId, filePath, comment, scope } = c.req.valid("json")

        return runRequest("comment.save", c, Effect.gen(function* () {
          const commentService = yield* Comment.Service
          yield* commentService.save(sessionId ?? "", filePath, comment, scope)

          return c.json({ ok: true })
        }))
      }
    )
    .delete(
      "/file/:commentId",
      describeRoute({
        summary: "Delete comment",
        description: "Delete a comment and its attachments",
        operationId: "comment.delete",
        responses: {
          200: {
            description: "Comment deleted successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  ok: z.boolean(),
                })),
              },
            },
          },
        },
      }),
      validator("param", z.object({
        commentId: z.string(),
      })),
      validator("query", z.object({
        sessionId: z.string().optional(),
        scope: z.enum(["project"]).optional(),
        filePath: z.string(),
      }).refine(scopeRefine, { message: SCOPE_REFINE_MESSAGE })),
      async (c) => {
        const { commentId } = c.req.valid("param")
        const { sessionId, filePath, scope } = c.req.valid("query")

        return runRequest("comment.delete", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          yield* comment.delete(sessionId ?? "", filePath, commentId, scope)

          return c.json({ ok: true })
        }))
      }
    )
    .post(
      "/file/attachment",
      describeRoute({
        summary: "Upload comment attachment",
        description: "Upload an attachment file for a comment (copy from source path)",
        operationId: "comment.uploadAttachment",
        responses: {
          200: {
            description: "Attachment uploaded successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  ok: z.boolean(),
                  attachment: CommentAttachmentSchema.optional(),
                })),
              },
            },
          },
        },
      }),
      validator("json", z.object({
        sessionId: z.string().optional(),
        scope: z.enum(["project"]).optional(),
        filePath: z.string(),
        commentId: z.string(),
        sourceFilePath: z.string(),
        filename: z.string(),
        mime: z.string(),
        size: z.number(),
      }).refine(scopeRefine, { message: SCOPE_REFINE_MESSAGE })),
      async (c) => {
        const { sessionId, filePath, commentId, sourceFilePath, filename, mime, size, scope } = c.req.valid("json")

        return runRequest("comment.uploadAttachment", c, Effect.gen(function* () {
          const comment = yield* Comment.Service

          const attachment = yield* comment.uploadAttachment(sessionId ?? "", filePath, commentId, {
            sourceFilePath,
            filename,
            mime,
            size,
          }, scope)

          return c.json({ ok: true, attachment })
        }))
      }
    )
    .delete(
      "/file/attachment/:attachmentId",
      describeRoute({
        summary: "Delete comment attachment",
        description: "Delete an attachment file from a comment",
        operationId: "comment.deleteAttachment",
        responses: {
          200: {
            description: "Attachment deleted successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  ok: z.boolean(),
                })),
              },
            },
          },
        },
      }),
      validator("param", z.object({
        attachmentId: z.string(),
      })),
      validator("query", z.object({
        sessionId: z.string().optional(),
        scope: z.enum(["project"]).optional(),
        filePath: z.string(),
        commentId: z.string(),
      }).refine(scopeRefine, { message: SCOPE_REFINE_MESSAGE })),
      async (c) => {
        const { attachmentId } = c.req.valid("param")
        const { sessionId, filePath, commentId, scope } = c.req.valid("query")

        return runRequest("comment.deleteAttachment", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          yield* comment.deleteAttachment(sessionId ?? "", filePath, commentId, attachmentId, scope)

          return c.json({ ok: true })
        }))
      }
    )
)