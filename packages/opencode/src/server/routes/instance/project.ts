import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "@/project/instance"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Project } from "@/project/project"
import z from "zod"
import { ProjectID } from "@/project/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest, runRequest } from "./trace"

// git remote 查询/关联接口的响应与请求体 schema
const GitRemoteResponse = z.object({
  remoteUrl: z.string().nullable(),
})

const GitRemoteInput = z.object({
  url: z.string().min(1),
})

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with OpenCode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = Project.list()
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that OpenCode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        const dir = Instance.directory
        const prev = Instance.project
        const next = await runRequest(
          "ProjectRoutes.initGit",
          c,
          Project.Service.use((svc) => svc.initGit({ directory: dir, project: prev })),
        )
        if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return c.json(next)
        await InstanceRuntime.reloadInstance({ directory: dir, worktree: dir, project: next })
        return c.json(next)
      },
    )
    // 查询当前项目的 origin 远程仓库地址(未配置时 remoteUrl 为 null)
    .get(
      "/git/remote",
      describeRoute({
        summary: "Get git remote URL",
        description: "Retrieve the origin remote URL for the current project, or null if not configured.",
        operationId: "project.getGitRemote",
        responses: {
          200: {
            description: "Git remote URL",
            content: {
              "application/json": {
                schema: resolver(GitRemoteResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        // 优先从 query 参数取 directory,避免 onboarding 阶段实例尚未加载时 Instance.directory 抛错
        const dir = c.req.query("directory") || Instance.directory
        const result = await runRequest(
          "ProjectRoutes.getGitRemote",
          c,
          Project.Service.use((svc) => svc.getGitRemote({ directory: dir })),
        )
        return c.json(result)
      },
    )
    // 关联远程代码仓:自动 git init(如需)+ remote add/set-url origin
    .post(
      "/git/remote",
      describeRoute({
        summary: "Add or update git remote",
        description:
          "Initialize git (if needed) and add or update the origin remote URL for the current project.",
        operationId: "project.addGitRemote",
        responses: {
          200: {
            description: "Git remote URL",
            content: {
              "application/json": {
                schema: resolver(GitRemoteResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", GitRemoteInput),
      async (c) =>
        jsonRequest("ProjectRoutes.addGitRemote", c, function* () {
          // 优先从 query 参数取 directory,避免 onboarding 阶段实例尚未加载时 Instance.directory 抛错
          const dir = c.req.query("directory") || Instance.directory
          const body = c.req.valid("json") as z.infer<typeof GitRemoteInput>
          const svc = yield* Project.Service
          return yield* svc.addGitRemote({ directory: dir, url: body.url })
        }),
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.UpdateInput.omit({ projectID: true })),
      async (c) =>
        jsonRequest("ProjectRoutes.update", c, function* () {
          const projectID = c.req.valid("param").projectID
          const body = c.req.valid("json")
          const svc = yield* Project.Service
          return yield* svc.update({ ...body, projectID })
        }),
    ),
)
