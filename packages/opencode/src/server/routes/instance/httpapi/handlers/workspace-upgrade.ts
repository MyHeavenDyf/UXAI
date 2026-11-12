import * as InstanceState from "@/effect/instance-state"
import { SessionStatus } from "@/session/status"
import {
  collectUpgradeTargets,
  logWorkspaceUpgradeFailure,
  previewWorkspaceUpgrade,
  runWorkspaceUpgrade,
  WorkspaceUpgradeError,
  type UpgradeStage,
} from "@/session/workspace-upgrade"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import path from "path"
import { InstanceHttpApi } from "../api"
import { ApiWorkspaceUpgradeError, WorkspaceUpgradePayload } from "../groups/workspace-upgrade"

function upgradeFailure(stage: UpgradeStage, message: string) {
  logWorkspaceUpgradeFailure(stage, message)
  return new ApiWorkspaceUpgradeError({ name: "WorkspaceUpgradeError", data: { stage, message } })
}

export const workspaceUpgradeHandlers = HttpApiBuilder.group(InstanceHttpApi, "workspace-upgrade", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const statusSvc = yield* SessionStatus.Service

    // 目标目录必须真实存在且是目录(同 chat-migration 的守卫:传个不存在/打错的路径就中止,
    // 不能对着一个空气目录跑文件扫描)。空串和相对路径在 resolve 之前挡掉——path.resolve
    // 对两者都会兜底到进程 cwd。只做字符串规范化、故意不 realpath:directory 全链路原样透传,
    // 列表查询是 eq 精确匹配,realpath 反而会制造口径不一致。
    const assertDirectory = Effect.fn("WorkspaceUpgradeHttpApi.assertDirectory")(function* (directory: string) {
      const stat = yield* fs.stat(directory).pipe(Effect.catch(() => Effect.succeed(null)))
      if (!stat) yield* Effect.fail(upgradeFailure("resolve", `目标文件夹不存在：${directory}`))
      else if (stat.type !== "Directory")
        yield* Effect.fail(upgradeFailure("resolve", `目标路径不是文件夹：${directory}`))
    })

    const preview = Effect.fn("WorkspaceUpgradeHttpApi.preview")(function* (ctx: {
      payload: typeof WorkspaceUpgradePayload.Type
    }) {
      const raw = ctx.payload.directory?.trim() ?? ""
      if (raw === "" || !path.isAbsolute(raw))
        yield* Effect.fail(upgradeFailure("resolve", "请选择一个工作区文件夹"))
      const directory = path.resolve(raw)
      yield* assertDirectory(directory)
      return previewWorkspaceUpgrade({ directory })
    })

    const run = Effect.fn("WorkspaceUpgradeHttpApi.run")(function* (ctx: {
      payload: typeof WorkspaceUpgradePayload.Type
    }) {
      const raw = ctx.payload.directory?.trim() ?? ""
      if (raw === "" || !path.isAbsolute(raw))
        yield* Effect.fail(upgradeFailure("resolve", "请选择一个工作区文件夹"))
      const directory = path.resolve(raw)
      yield* assertDirectory(directory)

      // busy 检查读的是**路由到的 instance** 的状态表,请求必须落在目标工作区的实例上
      // (前端 body_directory 与 query_directory 传同一个值保证这一点),否则查的是别人家的表。
      const instance = yield* InstanceState.context
      if (path.resolve(instance.directory) !== directory)
        yield* Effect.fail(
          upgradeFailure("resolve", "请求未路由到目标工作区实例，请检查 directory 参数（body 与 query 需一致）"),
        )

      const targets = collectUpgradeTargets(directory)
      const statuses = yield* statusSvc.list()
      const busy = targets.sessions.filter((id) => statuses.has(id))
      if (busy.length > 0)
        yield* Effect.fail(upgradeFailure("busy", `有 ${busy.length} 个会话正在运行，请等待其结束后再升级`))

      return yield* Effect.try({
        try: () => runWorkspaceUpgrade({ directory }),
        catch: (err) => {
          const stage: UpgradeStage = err instanceof WorkspaceUpgradeError ? err.stage : "rewrite"
          return upgradeFailure(stage, String(err instanceof Error ? err.message : err))
        },
      })
    })

    return handlers.handle("preview", preview).handle("run", run)
  }),
)
