import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

// 普通工作区 → 代码工作区原地升级(设计记录:opencode_modify/workspace-upgrade-normal-to-code.md)。
// 独立成组(照 groups/insight.ts 样板),不碰 control-plane 概念的 groups/workspace.ts。
// operationId 用两段式 workspaceUpgrade.*:SDK 生成 client.workspaceUpgrade.preview/run。
const root = "/workspace-upgrade"

export const WorkspaceUpgradePaths = {
  preview: `${root}/preview`,
  run: `${root}/run`,
} as const

// directory = 要升级的工作区目录(前端 Persist store 里 kindOf==="normal" 的那个);
// 同时作为 query 参数传同名 directory 用于 instance 路由(busy 检查依赖目标实例的状态表)。
export const WorkspaceUpgradePayload = Schema.Struct({
  directory: Schema.String,
})

// 失败要把**原因**带回前端(toast 文案「升级失败：<原因>」),stage 对应
// [octo:ws-upgrade] failed 日志的同名字段。
export class ApiWorkspaceUpgradeError extends Schema.ErrorClass<ApiWorkspaceUpgradeError>("WorkspaceUpgradeError")(
  {
    name: Schema.Literal("WorkspaceUpgradeError"),
    data: Schema.Struct({
      stage: Schema.String,
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const WorkspaceUpgradePreviewResult = Schema.Struct({
  // 有产物文件待迁移的会话数
  sessions: Schema.Number,
  files: Schema.Number,
  bytes: Schema.Number,
  studioSkipped: Schema.Number,
})

export const WorkspaceUpgradeRunResult = Schema.Struct({
  migratedSessions: Schema.Number,
  movedFiles: Schema.Number,
  movedBytes: Schema.Number,
  skippedStudio: Schema.Number,
  backupPath: Schema.optional(Schema.String),
})

export const WorkspaceUpgradeApi = HttpApi.make("workspace-upgrade")
  .add(
    HttpApiGroup.make("workspace-upgrade")
      .add(
        HttpApiEndpoint.post("preview", WorkspaceUpgradePaths.preview, {
          payload: WorkspaceUpgradePayload,
          success: described(WorkspaceUpgradePreviewResult, "Workspace upgrade preview"),
          error: ApiWorkspaceUpgradeError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "workspaceUpgrade.preview",
            summary: "Preview normal-to-code workspace upgrade",
            description:
              "Count sessions with artifact files under .octo/<sessionId>/outputs for the given workspace directory, plus total files/bytes. Studio sessions (octo_studio) are excluded and counted separately. Read-only.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("run", WorkspaceUpgradePaths.run, {
          payload: WorkspaceUpgradePayload,
          success: described(WorkspaceUpgradeRunResult, "Workspace upgrade result"),
          error: ApiWorkspaceUpgradeError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "workspaceUpgrade.run",
            summary: "Run normal-to-code workspace upgrade",
            description:
              "Back up the database (VACUUM INTO), copy artifact files from .octo/<sessionId>/outputs into <workspace>/output/ (flat, renamed with a 12-char session-id timestamp prefix), then rewrite message/part path references in one transaction with read-back verification. Original .octo outputs are never deleted. Studio sessions are skipped.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "workspace-upgrade",
          description: "Normal-to-code workspace in-place upgrade routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode workspace-upgrade HttpApi",
      version: "0.0.1",
      description: "Workspace upgrade HttpApi surface for migrating normal workspaces to code workspaces.",
    }),
  )
