import { Effect, Schema, Context, Layer } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Instance, type InstanceContext } from "@/project/instance"
import * as InstanceState from "@/effect/instance-state"

const log = Log.create({ service: "comment" })

const CommentPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
})

const CommentAttachment = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  filePath: Schema.String,
  uploadedAt: Schema.Number,
})

const FileComment = Schema.Struct({
  id: Schema.String,
  filePath: Schema.String,
  elementId: Schema.String,
  selector: Schema.String,
  contentSignature: Schema.optional(Schema.String),
  nativeId: Schema.optional(Schema.String),
  label: Schema.String,
  text: Schema.String,
  position: CommentPosition,
  htmlHint: Schema.String,
  note: Schema.String,
  attachments: Schema.optional(Schema.Array(CommentAttachment)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  commenterAccount: Schema.optional(Schema.String),
  commenterName: Schema.optional(Schema.String),
  commenterAvatar: Schema.optional(Schema.String),
})

export type CommentAttachment = Schema.Schema.Type<typeof CommentAttachment>
export type FileComment = Schema.Schema.Type<typeof FileComment>
export type CommentPosition = Schema.Schema.Type<typeof CommentPosition>

type Interface = {
  load: (sessionId: string, filePath: string) => Effect.Effect<FileComment[], PlatformError, AppFileSystem.Service>
  save: (sessionId: string, filePath: string, comment: FileComment) => Effect.Effect<void, PlatformError, AppFileSystem.Service>
  delete: (sessionId: string, filePath: string, commentId: string) => Effect.Effect<void, PlatformError, AppFileSystem.Service>
  uploadAttachment: (sessionId: string, filePath: string, commentId: string, file: { sourceFilePath: string; filename: string; mime: string; size: number }) => Effect.Effect<CommentAttachment, PlatformError, AppFileSystem.Service>
  deleteAttachment: (sessionId: string, filePath: string, commentId: string, attachmentId: string) => Effect.Effect<void, PlatformError, AppFileSystem.Service>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Comment") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

const getCommentsFilePath = (sessionId: string, commentFilePath: string, instance: InstanceContext): string => {
  const safeFolderName = commentFilePath.replace(/[/\\]/g, "_")
  
  return path.join(
    instance.directory,
    ".octo",
    sessionId,
    "comments",
    safeFolderName,
    "comments.json"
  )
}

const getAttachmentDir = (sessionId: string, commentFilePath: string, commentId: string, instance: InstanceContext): string => {
  const safeFolderName = commentFilePath.replace(/[/\\]/g, "_")
  
  return path.join(
    instance.directory,
    ".octo",
    sessionId,
    "comments",
    safeFolderName,
    commentId
  )
}

const load = Effect.fn("Comment.load")(function* (sessionId: string, commentFilePath: string) {
  const instance = yield* InstanceState.context
  const commentsPath = getCommentsFilePath(sessionId, commentFilePath, instance)
  
  const exists = yield* fs.exists(commentsPath)
  if (!exists) {
    log.debug("Comments file does not exist", { path: commentsPath })
    return []
  }

  const content = yield* fs.readFileString(commentsPath)
  const comments = yield* Effect.sync(() => JSON.parse(content) as FileComment[]).pipe(
    Effect.catch((err) => {
      log.warn("Failed to parse comments file, resetting", { path: commentsPath, error: String(err) })
      return Effect.gen(function* () {
        yield* fs.remove(commentsPath).pipe(Effect.catch(() => Effect.void))
        return []
      })
    })
  )
  
  log.debug("Loaded comments", { count: comments.length, path: commentsPath })
  return comments
})

const save = Effect.fn("Comment.save")(function* (sessionId: string, commentFilePath: string, comment: FileComment) {
  const instance = yield* InstanceState.context
  const commentsPath = getCommentsFilePath(sessionId, commentFilePath, instance)
  
  const comments = yield* load(sessionId, commentFilePath)
  const mutableComments = [...comments]
  
  const now = Date.now()
  const index = mutableComments.findIndex(c => c.id === comment.id)
  
  if (index >= 0) {
    mutableComments[index] = { ...comment, updatedAt: now }
  } else {
    mutableComments.push({ ...comment, createdAt: now, updatedAt: now })
  }

  const commentsDir = path.dirname(commentsPath)
  yield* fs.makeDirectory(commentsDir, { recursive: true })
  
  yield* fs.writeFileString(commentsPath, JSON.stringify(mutableComments, null, 2))
})

const deleteComment = Effect.fn("Comment.delete")(function* (sessionId: string, commentFilePath: string, commentId: string) {
  const instance = yield* InstanceState.context
  const commentsPath = getCommentsFilePath(sessionId, commentFilePath, instance)
  
  const comments = yield* load(sessionId, commentFilePath)
  const filtered = comments.filter(c => c.id !== commentId)
  
  yield* fs.writeFileString(commentsPath, JSON.stringify(filtered, null, 2))
  
  const attachmentDir = getAttachmentDir(sessionId, commentFilePath, commentId, instance)
  const attachExists = yield* fs.exists(attachmentDir)
  if (attachExists) {
    yield* fs.remove(attachmentDir, { recursive: true })
    log.debug("Deleted attachment directory", { dir: attachmentDir })
  }
  
  log.debug("Deleted comment", { id: commentId })
})

const uploadAttachment = Effect.fn("Comment.uploadAttachment")(function* (
  sessionId: string,
  commentFilePath: string,
  commentId: string,
  file: { sourceFilePath: string; filename: string; mime: string; size: number }
) {
  const instance = yield* InstanceState.context
  const attachmentDir = getAttachmentDir(sessionId, commentFilePath, commentId, instance)
  yield* fs.makeDirectory(attachmentDir, { recursive: true })
  
  const attachmentId = crypto.randomUUID()
  const ext = path.extname(file.filename)
  const attachmentFilename = `${attachmentId}${ext}`
  const attachmentPath = path.join(attachmentDir, attachmentFilename)
  
  yield* fs.copyFile(file.sourceFilePath, attachmentPath)
  
  const relativePath = path.relative(instance.directory, attachmentPath)
  
  const attachment: CommentAttachment = {
    id: attachmentId,
    filename: file.filename,
    mime: file.mime,
    size: file.size,
    filePath: relativePath,
    uploadedAt: Date.now()
  }
  
  const comments = yield* load(sessionId, commentFilePath)
  const mutableComments = [...comments]
  const commentIndex = mutableComments.findIndex(c => c.id === commentId)
  
  if (commentIndex >= 0) {
    const comment = mutableComments[commentIndex]
    const mutableAttachments = [...(comment.attachments || [])]
    mutableAttachments.push(attachment)
    mutableComments[commentIndex] = { ...comment, attachments: mutableAttachments }
    
    const commentsPath = getCommentsFilePath(sessionId, commentFilePath, instance)
    yield* fs.writeFileString(commentsPath, JSON.stringify(mutableComments, null, 2))
  }
  
  log.debug("Uploaded attachment", { 
    attachmentId, 
    filename: file.filename, 
    size: file.size,
    sourcePath: file.sourceFilePath,
    destPath: attachmentPath 
  })
  
  return attachment
})

const deleteAttachment = Effect.fn("Comment.deleteAttachment")(function* (
  sessionId: string,
  commentFilePath: string,
  commentId: string,
  attachmentId: string
) {
  const instance = yield* InstanceState.context
  const attachmentDir = getAttachmentDir(sessionId, commentFilePath, commentId, instance)
  
  const files = yield* fs.readDirectory(attachmentDir)
  const attachmentFile = files.find((f: string) => f.startsWith(attachmentId))
  
  if (attachmentFile) {
    const attachmentPath = path.join(attachmentDir, attachmentFile)
    yield* fs.remove(attachmentPath)
    log.debug("Deleted attachment file", { path: attachmentPath })
  }
  
  const comments = yield* load(sessionId, commentFilePath)
  const mutableComments = [...comments]
  const commentIndex = mutableComments.findIndex(c => c.id === commentId)
  
  if (commentIndex >= 0) {
    const comment = mutableComments[commentIndex]
    const filteredAttachments = (comment.attachments || []).filter((a: CommentAttachment) => a.id !== attachmentId)
    mutableComments[commentIndex] = { ...comment, attachments: filteredAttachments }
    
    const commentsPath = getCommentsFilePath(sessionId, commentFilePath, instance)
    yield* fs.writeFileString(commentsPath, JSON.stringify(mutableComments, null, 2))
  }
  
  log.debug("Deleted attachment", { attachmentId, commentId })
})

    return Service.of({
      load,
      save,
      delete: deleteComment,
      uploadAttachment,
      deleteAttachment
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Comment from "."