import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Effect } from "effect"
import { Instance } from "@/project/instance"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Project } from "@/project/project"
import z from "zod"
import { ProjectID } from "@/project/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest, runRequest } from "./trace"

// git remote 查询响应:remoteUrl 为空串表示未配置
const GitRemoteResponse = z.object({
  remoteUrl: z.string(),
})

// POST 响应:remoteUrl 始终非空(service 成功后返回 input.url)
const GitRemoteAddedResponse = z.object({
  remoteUrl: z.string(),
})

const GitRemoteInput = z.object({
  url: z.string().min(1).regex(/^(https?:\/\/|git@|ssh:\/\/)/, "Invalid repository URL format"),
})

// 共享 directory 校验:拒绝根路径、空串、盘符根、含 .. 路径分段的路径穿越
// legacy Hono 路由和 HttpApi handler 统一调用
export function validateDirectory(dir: string): boolean {
  if (!dir || dir === "/" || /^[A-Z]:[\\/]?$/i.test(dir)) return false
  if (dir.split(/[\/\\]/).includes("..")) return false
  return true
}

// legacy Hono 路由专用:校验失败时 Effect.fail;Instance.directory 延迟到 Effect 内求值
function resolveDirectoryEffect(query: string | undefined): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const dir = query ?? Instance.directory
    if (!validateDirectory(dir)) {
      yield* Effect.fail(new Error("Invalid directory"))
    }
    return dir
  })
}

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
        const dir = await runRequest(
          "ProjectRoutes.getGitRemote.resolveDir",
          c,
          resolveDirectoryEffect(c.req.query("directory")),
        )
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
                schema: resolver(GitRemoteAddedResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", GitRemoteInput),
      async (c) =>
        jsonRequest("ProjectRoutes.addGitRemote", c, function* () {
          const dir = yield* resolveDirectoryEffect(c.req.query("directory"))
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
