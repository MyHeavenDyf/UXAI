import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { runRequest } from "./trace"
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

// Accept the pre-rename `filePath` field name by rewriting it to
// `commentFilePath` before validation. Keeping the rewrite out of the zod
// schemas means the alias never leaks into the OpenAPI/SDK surface.
const legacyCommentFilePathAlias = createMiddleware(async (c, next) => {
  const contentType = c.req.header("Content-Type") ?? ""
  const json = /^application\/(?:[a-z0-9.-]+\+)?json/i.test(contentType)
  const url = new URL(c.req.url)
  const queryAlias = url.searchParams.get("filePath")
  const queryRewritten = queryAlias !== null && !url.searchParams.has("commentFilePath")
  if (queryRewritten) url.searchParams.set("commentFilePath", queryAlias)

  let body: string | undefined
  let changed = queryRewritten
  if (json) {
    body = await c.req.raw.clone().text()
    try {
      const data = JSON.parse(body) as Record<string, unknown>
      if (data && typeof data === "object" && typeof data.filePath === "string" && typeof data.commentFilePath !== "string") {
        data.commentFilePath = data.filePath
        body = JSON.stringify(data)
        changed = true
      }
    } catch {
      // Malformed JSON: leave it for the validator to report.
    }
  }

  if (changed) {
    const headers = new Headers(c.req.raw.headers)
    if (body !== undefined) headers.delete("content-length")
    c.req.raw = new Request(url.toString(), { method: c.req.raw.method, headers, body })
  }
  await next()
})

export const CommentRoutes = lazy(() =>
  new Hono()
    .use(legacyCommentFilePathAlias)
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
        sessionId: z.string(),
        commentFilePath: z.string(),
      })),
      async (c) => {
        const { sessionId, commentFilePath } = c.req.valid("query")
        
        return runRequest("comment.load", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          const comments = yield* comment.load(sessionId, commentFilePath)
          
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
        sessionId: z.string(),
        commentFilePath: z.string(),
        comment: FileCommentSchema,
      })),
      async (c) => {
        const { sessionId, commentFilePath, comment } = c.req.valid("json")
        
        return runRequest("comment.save", c, Effect.gen(function* () {
          const commentService = yield* Comment.Service
          yield* commentService.save(sessionId, commentFilePath, comment)
          
          return c.json({ ok: true })
        }))
      }
    )
    .delete(
      "/file",
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
      validator("query", z.object({
        sessionId: z.string(),
        commentFilePath: z.string(),
        commentId: z.string(),
      })),
      async (c) => {
        const { sessionId, commentFilePath, commentId } = c.req.valid("query")
        
        return runRequest("comment.delete", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          yield* comment.delete(sessionId, commentFilePath, commentId)
          
          return c.json({ ok: true })
        }))
      }
    )
    // Legacy path (commentId as a path param) kept for backward compatibility;
    // hidden from the OpenAPI document.
    .delete(
      "/file/:commentId",
      describeRoute({
        hide: true,
        summary: "Delete comment (legacy path)",
        description: "Delete a comment using the pre-rename path parameter.",
        operationId: "comment.deleteLegacy",
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
        sessionId: z.string(),
        commentFilePath: z.string(),
      })),
      async (c) => {
        const { commentId } = c.req.valid("param")
        const { sessionId, commentFilePath } = c.req.valid("query")
        
        return runRequest("comment.deleteLegacy", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          yield* comment.delete(sessionId, commentFilePath, commentId)
          
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
        sessionId: z.string(),
        commentFilePath: z.string(),
        commentId: z.string(),
        sourceFilePath: z.string(),
        filename: z.string(),
        mime: z.string(),
        size: z.number(),
      })),
      async (c) => {
        const { sessionId, commentFilePath, commentId, sourceFilePath, filename, mime, size } = c.req.valid("json")
        
        return runRequest("comment.uploadAttachment", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          
          const attachment = yield* comment.uploadAttachment(sessionId, commentFilePath, commentId, {
            sourceFilePath,
            filename,
            mime,
            size,
          })
          
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
        sessionId: z.string(),
        commentFilePath: z.string(),
        commentId: z.string(),
      })),
      async (c) => {
        const { attachmentId } = c.req.valid("param")
        const { sessionId, commentFilePath, commentId } = c.req.valid("query")
        
        return runRequest("comment.deleteAttachment", c, Effect.gen(function* () {
          const comment = yield* Comment.Service
          yield* comment.deleteAttachment(sessionId, commentFilePath, commentId, attachmentId)
          
          return c.json({ ok: true })
        }))
      }
    )
)
