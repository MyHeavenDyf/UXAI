import { Session } from "@/session/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

// insight 专用接口组(SPEC-INS-013)。独立成组(照 groups/studio.ts 样板),不碰 session 组。
const root = "/insight"

export const InsightPaths = {
  sessions: `${root}/sessions`,
  files: `${root}/files`,
  upload: `${root}/upload`,
  uploadFolder: `${root}/upload-folder`,
} as const

export const InsightSessionListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

export const InsightSessionListResult = Schema.Struct({
  items: Schema.Array(Session.Info),
  total: Schema.Number,
})

// SPEC-INS-014 §10:列 <projectDir>/insight/<sessionId>/{uploads,outputs}/。
export const InsightFileCategory = Schema.Union([Schema.Literal("uploads"), Schema.Literal("outputs")])

export const InsightFileListQuery = Schema.Struct({
  sessionId: Schema.String,
  category: InsightFileCategory,
  // 子路径(相对 uploads 根):非空时列 <uploads>/<path>/ 下的文件+文件夹,支持文件夹导航。
  path: Schema.optional(Schema.String),
})

export const InsightFileEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  size: Schema.Number,
  mtime: Schema.Number,
  isFolder: Schema.Boolean,
  // 相对 uploads 根的路径(文件夹导航 / 面包屑用);outputs 段无子目录,留空即可。
  relativePath: Schema.String,
})

export const InsightFileListResult = Schema.Struct({
  files: Schema.Array(InsightFileEntry),
})

// 上传(对齐 artifact/upload:base64 content,撞名加后缀,path 指定子文件夹)。
const InsightUploadPayload = Schema.Struct({
  sessionId: Schema.String,
  filename: Schema.String,
  content: Schema.String,
  path: Schema.optional(Schema.String),
})

const InsightUploadFileSchema = Schema.Struct({
  relativePath: Schema.String,
  content: Schema.String,
})

const InsightUploadFolderPayload = Schema.Struct({
  sessionId: Schema.String,
  folderName: Schema.String,
  files: Schema.Array(InsightUploadFileSchema),
  path: Schema.optional(Schema.String),
})

const InsightUploadFolderResult = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  fileCount: Schema.Number,
  mtime: Schema.Number,
})

export const InsightApi = HttpApi.make("insight")
  .add(
    HttpApiGroup.make("insight")
      .add(
        HttpApiEndpoint.get("listSessions", InsightPaths.sessions, {
          query: InsightSessionListQuery,
          success: described(InsightSessionListResult, "Insight sessions page"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "insight.sessions.list",
            summary: "List insight sessions (paged)",
            description:
              "List octo_insight sessions for a directory, agent-filtered server-side, with total count for pagination.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("listFiles", InsightPaths.files, {
          query: InsightFileListQuery,
          success: described(InsightFileListResult, "Insight session files"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "insight.files.list",
            summary: "List insight session files",
            description:
              "List files under <projectDir>/insight/<sessionId>/<category>/ (category: uploads|outputs). SPEC-INS-014 §10.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("upload", InsightPaths.upload, {
          payload: InsightUploadPayload,
          success: described(InsightFileEntry, "Uploaded insight file"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "insight.files.upload",
            summary: "Upload insight file",
            description: "Upload a base64 file to <projectDir>/insight/<sessionId>/uploads/[path]/. Auto-renames on conflict.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("uploadFolder", InsightPaths.uploadFolder, {
          payload: InsightUploadFolderPayload,
          success: described(InsightUploadFolderResult, "Uploaded insight folder"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "insight.files.uploadFolder",
            summary: "Upload insight folder",
            description: "Upload a folder (preserving structure) to <projectDir>/insight/<sessionId>/uploads/[path]/.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "insight",
          description: "Insight-specific instance routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode insight HttpApi",
      version: "0.0.1",
      description: "Insight-specific HttpApi surface for the insight module.",
    }),
  )
