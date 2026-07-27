import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const CommentPositionSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
})

const CommentAttachmentSchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  filePath: Schema.String,
  uploadedAt: Schema.Number,
})

const FileCommentSchema = Schema.Struct({
  id: Schema.String,
  filePath: Schema.String,
  elementId: Schema.String,
  selector: Schema.String,
  contentSignature: Schema.optional(Schema.String),
  nativeId: Schema.optional(Schema.String),
  label: Schema.String,
  text: Schema.String,
  position: CommentPositionSchema,
  htmlHint: Schema.String,
  note: Schema.String,
  attachments: Schema.optional(Schema.Array(CommentAttachmentSchema)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  commenterAccount: Schema.optional(Schema.String),
  commenterName: Schema.optional(Schema.String),
  commenterAvatar: Schema.optional(Schema.String),
})

const CommentLoadQuery = Schema.Struct({
  sessionId: Schema.String,
  commentFilePath: Schema.String,
})

const CommentSavePayload = Schema.Struct({
  sessionId: Schema.String,
  commentFilePath: Schema.String,
  comment: FileCommentSchema,
})

const CommentDeleteQuery = Schema.Struct({
  sessionId: Schema.String,
  commentFilePath: Schema.String,
  commentId: Schema.String,
})

const CommentAttachmentDeleteQuery = Schema.Struct({
  sessionId: Schema.String,
  commentFilePath: Schema.String,
  commentId: Schema.String,
})

const CommentAttachmentDeleteParams = Schema.Struct({
  attachmentId: Schema.String,
})

const CommentAttachmentUploadPayload = Schema.Struct({
  sessionId: Schema.String,
  commentFilePath: Schema.String,
  commentId: Schema.String,
  sourceFilePath: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
})

const CommentPaths = {
  load: "/comment/file",
  save: "/comment/file",
  delete: "/comment/file",
  attachmentUpload: "/comment/file/attachment",
  attachmentDelete: "/comment/file/attachment/:attachmentId",
} as const

export const CommentApi = HttpApi.make("comment")
  .add(
    HttpApiGroup.make("comment")
      .add(
        HttpApiEndpoint.get("load", CommentPaths.load, {
          query: CommentLoadQuery,
          success: described(Schema.Struct({ comments: Schema.Array(FileCommentSchema) }), "Comments for file"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "comment.load",
            summary: "Load comments",
            description: "Load all comments for an artifact file.",
          }),
        ),
        HttpApiEndpoint.post("save", CommentPaths.save, {
          payload: CommentSavePayload,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Saved"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "comment.save",
            summary: "Save comment",
            description: "Save or update a comment.",
          }),
        ),
        HttpApiEndpoint.delete("delete", CommentPaths.delete, {
          query: CommentDeleteQuery,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Deleted"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "comment.delete",
            summary: "Delete comment",
            description: "Delete a comment.",
          }),
        ),
        HttpApiEndpoint.delete("deleteAttachment", CommentPaths.attachmentDelete, {
          params: CommentAttachmentDeleteParams,
          query: CommentAttachmentDeleteQuery,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "comment.deleteAttachment",
            summary: "Delete comment attachment",
            description: "Delete an attachment file from a comment.",
          }),
        ),
        HttpApiEndpoint.post("uploadAttachment", CommentPaths.attachmentUpload, {
          payload: CommentAttachmentUploadPayload,
          success: described(Schema.Struct({ ok: Schema.Boolean, attachment: Schema.optional(CommentAttachmentSchema) }), "Uploaded"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "comment.uploadAttachment",
            summary: "Upload comment attachment",
            description: "Upload an attachment file for a comment (copy from source path).",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "comment",
          description: "Comment management routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode comment HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for comment management.",
    }),
  )