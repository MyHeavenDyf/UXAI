import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ApiBadRequestError, ApiInternalServerError } from "../errors"

const root = "/project"
const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Info.fields.icon),
  commands: Schema.optional(Project.Info.fields.commands),
})

export const ProjectApi = HttpApi.make("project")
  .add(
    HttpApiGroup.make("project")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: described(Schema.Array(Project.Info), "List of projects"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.list",
            summary: "List all projects",
            description: "Get a list of projects that have been opened with OpenCode.",
          }),
        ),
        HttpApiEndpoint.get("current", `${root}/current`, {
          success: described(Project.Info, "Current project information"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.current",
            summary: "Get current project",
            description: "Retrieve the currently active project that OpenCode is working with.",
          }),
        ),
        HttpApiEndpoint.post("initGit", `${root}/git/init`, {
          success: described(Project.Info, "Project information after git initialization"),
          error: [ApiBadRequestError, ApiInternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.initGit",
            summary: "Initialize git repository",
            description: "Create a git repository for the current project and return the refreshed project info.",
          }),
        ),
        // 查询当前项目的 origin 远程仓库地址(未配置时返回空串)
        HttpApiEndpoint.get("getGitRemote", `${root}/git/remote`, {
          success: described(
            Schema.Struct({ remoteUrl: Schema.String }),
            "Origin remote URL (empty string if not configured)",
          ),
          error: [ApiBadRequestError, ApiInternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.getGitRemote",
            summary: "Get git remote URL",
            description:
              "Retrieve the origin remote URL for the current project, or empty string if not configured.",
          }),
        ),
        // 关联远程代码仓:自动 git init(如需)+ remote add/set-url origin
        HttpApiEndpoint.post("addGitRemote", `${root}/git/remote`, {
          payload: Schema.Struct({ url: Schema.String }),
          success: described(
            Schema.Struct({ remoteUrl: Schema.String }),
            "Origin remote URL after add/update",
          ),
          error: [ApiBadRequestError, ApiInternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.addGitRemote",
            summary: "Add or update git remote",
            description:
              "Initialize git (if needed) and add or update the origin remote URL for the current project.",
          }),
        ),
        HttpApiEndpoint.patch("update", `${root}/:projectID`, {
          params: { projectID: ProjectID },
          payload: UpdatePayload,
          success: described(Project.Info, "Updated project information"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.update",
            summary: "Update project",
            description: "Update project properties such as name, icon, and commands.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "project",
          description: "Experimental HttpApi project routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
