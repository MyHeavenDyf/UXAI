import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const ArtifactFileSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  sessionId: Schema.String,
  kind: Schema.String,
  size: Schema.Number,
  mtime: Schema.Number,
  mime: Schema.String,
})

const ArtifactListQuery = Schema.Struct({
  sessionId: Schema.String,
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
})

const ArtifactPaths = {
  list: "/artifact/list",
  content: "/artifact/content",
  file: "/artifact/file",
  rename: "/artifact/rename",
  archive: "/artifact/archive",
  deleteBatch: "/artifact/delete-batch",
  upload: "/artifact/upload",
} as const

export const ArtifactApi = HttpApi.make("artifact")
  .add(
    HttpApiGroup.make("artifact")
      .add(
        HttpApiEndpoint.get("list", ArtifactPaths.list, {
          query: ArtifactListQuery,
          success: described(Schema.Struct({ files: Schema.Array(ArtifactFileSchema) }), "Artifact files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.list",
            summary: "List artifacts",
            description: "List all artifact files in .octo/artifacts/make/<sessionId> directory.",
          }),
        ),
        HttpApiEndpoint.get("content", ArtifactPaths.content, {
          query: ArtifactContentQuery,
          success: described(Schema.Struct({ content: Schema.String, mimeType: Schema.String }), "Artifact content"),
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
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "artifact.upload",
            summary: "Upload artifact",
            description: "Upload a file to the artifact directory. Auto-renames if file exists.",
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