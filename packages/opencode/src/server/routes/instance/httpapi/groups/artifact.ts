import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const ArtifactFileSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  relativePath: Schema.String,
  sessionId: Schema.String,
  kind: Schema.String,
  isFolder: Schema.Boolean,
  size: Schema.Number,
  mtime: Schema.Number,
  mime: Schema.String,
})

const ArtifactListQuery = Schema.Struct({
  sessionId: Schema.String,
  category: Schema.optional(Schema.Union([Schema.Literal("generated"), Schema.Literal("uploaded")])),
  path: Schema.optional(Schema.String),
  recursive: Schema.optional(Schema.Boolean),
})

const ArtifactContentQuery = Schema.Struct({
  path: Schema.String,
})

const ArtifactDeleteQuery = Schema.Struct({
  path: Schema.String,
})

const ArtifactRenamePayload = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
})

const ArtifactArchivePayload = Schema.Struct({
  files: Schema.Array(Schema.String),
})

const ArtifactDeleteBatchPayload = Schema.Struct({
  files: Schema.Array(Schema.String),
})

const ArtifactUploadPayload = Schema.Struct({
  sessionId: Schema.String,
  filename: Schema.String,
  content: Schema.String,
  path: Schema.optional(Schema.String),
})

const FolderUploadFileSchema = Schema.Struct({
  relativePath: Schema.String,
  content: Schema.String,
})

const ArtifactUploadFolderPayload = Schema.Struct({
  sessionId: Schema.String,
  folderName: Schema.String,
  files: Schema.Array(FolderUploadFileSchema),
  path: Schema.optional(Schema.String),
})

const ArtifactUploadFolderResponseSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  relativePath: Schema.String,
  sessionId: Schema.String,
  kind: Schema.String,
  isFolder: Schema.Boolean,
  fileCount: Schema.Number,
  mtime: Schema.Number,
})

const ArtifactServeQuery = Schema.Struct({
  sessionId: Schema.String,
  path: Schema.String,
})

const ArtifactPaths = {
  list: "/artifact/list",
  content: "/artifact/content",
  file: "/artifact/file",
  rename: "/artifact/rename",
  archive: "/artifact/archive",
  deleteBatch: "/artifact/delete-batch",
  upload: "/artifact/upload",
  uploadFolder: "/artifact/upload-folder",
  serve: "/artifact/serve",
} as const

export const ArtifactApi = HttpApi.make("artifact")
  .add(
    HttpApiGroup.make("artifact")
      .add(
        HttpApiEndpoint.get("list", ArtifactPaths.list, {
          query: ArtifactListQuery,
          success: described(Schema.Struct({ files: Schema.Array(ArtifactFileSchema) }), "Artifact files and folders"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.list",
            summary: "List artifacts",
            description: "List artifact files and folders. 'category=generated' returns root files (excluding upload-files); 'category=uploaded' returns files in upload-files directory. Use 'path' to navigate subfolders within the category root.",
          }),
        ),
        HttpApiEndpoint.get("content", ArtifactPaths.content, {
          query: ArtifactContentQuery,
          success: described(
            Schema.Struct({
              content: Schema.String,
              mimeType: Schema.String,
              encoding: Schema.optional(Schema.Literal("base64")),
            }),
            "Artifact content",
          ),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.read",
            summary: "Read artifact",
            description: "Read the content of an artifact file.",
          }),
        ),
        HttpApiEndpoint.delete("delete", ArtifactPaths.file, {
          query: ArtifactDeleteQuery,
          success: described(Schema.Struct({ ok: Schema.Boolean }), "Deleted"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.delete",
            summary: "Delete artifact",
            description: "Delete a single artifact file.",
          }),
        ),
        HttpApiEndpoint.post("rename", ArtifactPaths.rename, {
          payload: ArtifactRenamePayload,
          success: described(Schema.Struct({ name: Schema.String, path: Schema.String, kind: Schema.String, mime: Schema.String }), "Renamed file info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.rename",
            summary: "Rename artifact",
            description: "Rename an artifact file.",
          }),
        ),
        HttpApiEndpoint.post("archive", ArtifactPaths.archive, {
          payload: ArtifactArchivePayload,
          success: described(Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/zip" })), "ZIP archive"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.archive",
            summary: "Archive artifacts",
            description: "Create a ZIP archive of selected artifact files.",
          }),
        ),
        HttpApiEndpoint.post("deleteBatch", ArtifactPaths.deleteBatch, {
          payload: ArtifactDeleteBatchPayload,
          success: described(Schema.Struct({ ok: Schema.Boolean, deleted: Schema.Number }), "Deleted count"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.deleteBatch",
            summary: "Batch delete artifacts",
            description: "Delete multiple artifact files.",
          }),
        ),
        HttpApiEndpoint.post("upload", ArtifactPaths.upload, {
          payload: ArtifactUploadPayload,
          success: described(ArtifactFileSchema, "Uploaded file info"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.upload",
            summary: "Upload artifact",
            description: "Upload a file to the artifact directory. Auto-renames if file exists. Use 'path' to upload to a subfolder.",
          }),
        ),
        HttpApiEndpoint.post("uploadFolder", ArtifactPaths.uploadFolder, {
          payload: ArtifactUploadFolderPayload,
          success: described(ArtifactUploadFolderResponseSchema, "Uploaded folder info"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.uploadFolder",
            summary: "Upload folder",
            description: "Upload a folder with all its contents to the artifact directory. Preserves directory structure.",
          }),
        ),
        HttpApiEndpoint.get("serve", ArtifactPaths.serve, {
          query: ArtifactServeQuery,
          success: described(Schema.String.pipe(HttpApiSchema.asText({ contentType: "*" })), "Artifact file content"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.serve",
            summary: "Serve artifact file",
            description: "Serve artifact file with bridge scripts injected for HTML files. Used for iframe preview with relative path support.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "artifact",
          description: "Artifact file management routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode artifact HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for artifact file management.",
    }),
  )