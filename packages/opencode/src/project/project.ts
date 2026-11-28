import z from "zod"
import { and, eq, inArray, ne, or, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { createHash } from "node:crypto"
import path from "node:path"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { ProjectID } from "./schema"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Path, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "@/util/schema"
import { serviceUse } from "@/effect/service-use"

const log = Log.create({ service: "project" })

const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: optionalOmitUndefined(Schema.String),
  override: optionalOmitUndefined(Schema.String),
  color: optionalOmitUndefined(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: optionalOmitUndefined(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optionalOmitUndefined(NonNegativeInt),
})

export const Info = Schema.Struct({
  id: ProjectID,
  worktree: Schema.String,
  vcs: optionalOmitUndefined(ProjectVcs),
  name: optionalOmitUndefined(Schema.String),
  icon: optionalOmitUndefined(ProjectIcon),
  commands: optionalOmitUndefined(ProjectCommands),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Project" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: BusEvent.define("project.updated", Info),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

export const UpdateInput = z.object({
  projectID: ProjectID.zod,
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type UpdateInput = z.infer<typeof UpdateInput>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
})
  .annotate({ identifier: "ProjectUpdateInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Per-instance setup. Subscribes to the `/init` slash command for the
   * current instance and stamps the project's initialized timestamp when it
   * fires. Subscription lifetime is tied to the per-instance state scope.
   */
  readonly init: () => Effect.Effect<void>
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info, Error>
  readonly getGitRemote: (input: { directory: string }) => Effect.Effect<{ remoteUrl: string }, Error>
  readonly addGitRemote: (input: { directory: string; url: string }) => Effect.Effect<{ remoteUrl: string }, Error>
  readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

type GitResult = { code: number; text: string; stderr: string }

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Bus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const bus = yield* Bus.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => Database.use(fn))

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(ProjectVcs))(Flag.OPENCODE_FAKE_VCS)

    const resolveGitPath = (cwd: string, name: string) => {
      if (!name) return cwd
      name = name.replace(/[\r\n]+$/, "")
      if (!name) return cwd
      name = AppFileSystem.windowsPath(name)
      if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
      return pathSvc.resolve(cwd, name)
    }

    const scope = yield* Scope.Scope

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      log.info("fromDirectory", { directory })

      // Phase 1: discover git info
      type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

      // projectID = 目录路径哈希(与 Claude Code 一致):git 只用来找 worktree 根路径
      // 让子目录共享,身份本身永远是路径派生,git 不装/不是仓库/命令失败都不影响隔离
      const dirProjectId = (dir: string) =>
        ProjectID.make(createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 40))

      const data: DiscoveryResult = yield* Effect.gen(function* () {
        const dotgitMatches = yield* fs.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
        const dotgit = dotgitMatches[0]

        if (!dotgit) {
          log.info("fromDirectory:no-git", { directory })
          return {
            id: dirProjectId(directory),
            worktree: "/",
            sandbox: "/",
            vcs: fakeVcs,
          }
        }

        let sandbox = pathSvc.dirname(dotgit)

        const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
        if (commonDir.code !== 0) {
          log.info("fromDirectory:git-common-dir-failed", { directory, code: commonDir.code, stderr: commonDir.stderr })
          return {
            id: dirProjectId(sandbox),
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        const common = resolveGitPath(sandbox, commonDir.text.trim())
        const bareCheck = yield* git(["config", "--bool", "core.bare"], { cwd: sandbox })
        const isBareRepo = bareCheck.code === 0 && bareCheck.text.trim() === "true"
        const worktree = common === sandbox ? sandbox : isBareRepo ? common : pathSvc.dirname(common)

        const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
        if (topLevel.code !== 0) {
          log.info("fromDirectory:toplevel-failed", { directory, code: topLevel.code, stderr: topLevel.stderr })
          return {
            id: dirProjectId(worktree),
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        sandbox = resolveGitPath(sandbox, topLevel.text.trim())

        // ID 基于 git worktree 主根(同仓库所有 worktree/子目录共享,与 Claude Code 一致)
        const id = dirProjectId(worktree)
        log.info("fromDirectory:discovered", { directory, id, worktree, sandbox })
        return { id, sandbox, worktree, vcs: "git" as const }
      })

      // Phase 2: upsert
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
      const existing = row
        ? fromRow(row)
        : {
            id: data.id,
            worktree: data.worktree,
            vcs: data.vcs,
            sandboxes: [] as string[],
            time: { created: Date.now(), updated: Date.now() },
          }

      if (Flag.OPENCODE_EXPERIMENTAL_ICON_DISCOVERY) yield* discover(existing).pipe(Effect.ignore, Effect.forkIn(scope))

      const result: Info = {
        ...existing,
        worktree: data.worktree,
        vcs: data.vcs,
        time: { ...existing.time, updated: Date.now() },
      }
      if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
        result.sandboxes.push(data.sandbox)
      result.sandboxes = yield* Effect.forEach(
        result.sandboxes,
        (s) =>
          fs.exists(s).pipe(
            Effect.orDie,
            Effect.map((exists) => (exists ? s : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

      yield* db((d) =>
        d
          .insert(ProjectTable)
          .values({
            id: result.id,
            worktree: result.worktree,
            vcs: result.vcs ?? null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_url_override: result.icon?.override,
            icon_color: result.icon?.color,
            time_created: result.time.created,
            time_updated: result.time.updated,
            time_initialized: result.time.initialized,
            sandboxes: result.sandboxes,
            commands: result.commands,
          })
          .onConflictDoUpdate({
            target: ProjectTable.id,
            set: {
              worktree: result.worktree,
              vcs: result.vcs ?? null,
              name: result.name,
              icon_url: result.icon?.url,
              icon_url_override: result.icon?.override,
              icon_color: result.icon?.color,
              time_updated: result.time.updated,
              time_initialized: result.time.initialized,
              sandboxes: result.sandboxes,
              commands: result.commands,
            },
          })
          .run(),
      )

      // 历史迁移:projectID 历经三种旧方案(global 桶 → git 根提交哈希 → 路径哈希),
      // 旧会话的 project_id 不会随新方案自动重算,会从按项目的会话列表里消失。
      // 会话表带 directory,以它为迁移键把旧 ID 的会话归位:
      // - git 仓库:worktree(主根)或 sandbox(当前 worktree 顶层)之下的会话
      // - 非 git 目录:worktree 是 "/" 哨兵,只精确认领本目录(子目录会话归子目录自己的新 ID)
      // 只认领 global 桶或"曾拥有本目录的旧 project 行"名下的会话,
      // 嵌套仓库(worktree 不同)的会话不会被父项目误领;目录精确/严格前缀匹配,
      // 无关目录绝不认领;project_id != 新 ID 保证幂等。
      if (data.id !== ProjectID.global) {
        const gitScope = data.worktree !== "/"
        const under = (prefix: string) =>
          sql`(${SessionTable.directory} = ${prefix} or substr(${SessionTable.directory}, 1, ${prefix.length + path.sep.length}) = ${prefix + path.sep})`
        const scope = gitScope
          ? or(under(data.worktree), under(data.sandbox))
          : eq(SessionTable.directory, directory)

        // (1) global 桶:旧版非 git(含 git-init 无提交)会话
        yield* db((d) =>
          d
            .update(SessionTable)
            .set({ project_id: data.id })
            .where(and(eq(SessionTable.project_id, ProjectID.global), scope))
            .run(),
        )

        // (2) 旧 project 行(global 之外)曾拥有本目录,其名下会话一并归位
        const scopeDir = gitScope ? data.worktree : directory
        const legacyRows = yield* db((d) =>
          d
            .select()
            .from(ProjectTable)
            .where(
              and(
                ne(ProjectTable.id, data.id),
                ne(ProjectTable.id, ProjectID.global),
                gitScope
                  ? or(eq(ProjectTable.worktree, scopeDir), eq(ProjectTable.worktree, data.sandbox))
                  : eq(ProjectTable.worktree, scopeDir),
              ),
            )
            .all(),
        )
        if (legacyRows.length > 0) {
          const legacyIDs = legacyRows.map((row) => row.id)
          yield* db((d) =>
            d
              .update(SessionTable)
              .set({ project_id: data.id })
              .where(and(inArray(SessionTable.project_id, legacyIDs), scope))
              .run(),
          )
          // (3) 旧 project 行名下的 workspace 关联行改挂新 ID:UI 关联本地文件夹的列表不丢
          yield* db((d) =>
            d
              .update(WorkspaceTable)
              .set({ project_id: data.id })
              .where(inArray(WorkspaceTable.project_id, legacyIDs))
              .run(),
          )
          // (4) 项目级字段认领:名称/图标/启动命令/初始化时间只补新行缺失的,
          // 已设置(含用户新改)的字段一律不动 —— 逐字段 first-wins,幂等
          const adopted: Record<string, string | number | { start?: string } | null> = {}
          const hasIcon = !!(result.icon && (result.icon.url || result.icon.override || result.icon.color))
          let iconAdopted = hasIcon
          for (const row of legacyRows) {
            if (!result.name && row.name && adopted.name === undefined) {
              result.name = row.name
              adopted.name = row.name
            }
            if (!iconAdopted && (row.icon_url || row.icon_url_override || row.icon_color)) {
              result.icon = { url: row.icon_url ?? undefined, override: row.icon_url_override ?? undefined, color: row.icon_color ?? undefined }
              adopted.icon_url = row.icon_url
              adopted.icon_url_override = row.icon_url_override
              adopted.icon_color = row.icon_color
              iconAdopted = true
            }
            if (!result.commands && row.commands && adopted.commands === undefined) {
              result.commands = row.commands
              adopted.commands = row.commands
            }
            if (result.time.initialized === undefined && row.time_initialized !== null && adopted.time_initialized === undefined) {
              result.time = { ...result.time, initialized: row.time_initialized ?? undefined }
              adopted.time_initialized = row.time_initialized
            }
          }
          if (Object.keys(adopted).length > 0)
            yield* db((d) => d.update(ProjectTable).set(adopted).where(eq(ProjectTable.id, data.id)).run())
        }
      }

      yield* emitUpdated(result)
      return { project: result, sandbox: data.sandbox }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = AppFileSystem.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } })
    })

    const list = Effect.fn("Project.list")(function* () {
      return yield* db((d) => d.select().from(ProjectTable).all().map(fromRow))
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_url_override: input.icon?.override,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        if (!result.stderr && !result.text) {
          yield* Effect.fail(new Error("未检测到 Git，请确认已安装"))
        } else {
          yield* Effect.fail(new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository"))
        }
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    // 查询当前目录的 origin 远程仓库地址;未配置 origin 时返回空串。
    // 不用 which("git") 预检 — GUI 启动的进程 PATH 可能不含 Homebrew 路径,
    // 但 ChildProcess.spawn 仍能通过 OS 原生 exec 找到 git。
    const getGitRemote = Effect.fn("Project.getGitRemote")(function* (input: { directory: string }) {
      const result = yield* git(["remote", "get-url", "origin"], { cwd: input.directory })
      if (result.code !== 0) {
        // git 正常退出但返回非零(如"No remote configured")→ 未配置,返回空串
        // spawn 失败被 catch-all 吞掉 → code=1, stderr="", text="" → git 不可用
        if (!result.stderr && !result.text) {
          yield* Effect.fail(new Error("未检测到 Git，请确认已安装"))
        }
        return { remoteUrl: "" }
      }
      return { remoteUrl: result.text.trim() }
    })

    // 关联远程代码仓:若目录未初始化 git 则先 git init,再判断 origin 是否存在——
    // 已存在则 git remote set-url 更新,不存在则 git remote add 新增。
    // git 命令中 URL 前加 -- 分隔,防止以 - 开头的 URL 被 git 解释为选项参数
    const addGitRemote = Effect.fn("Project.addGitRemote")(function* (input: { directory: string; url: string }) {
      // 检测目录是否已初始化 git(git rev-parse --git-dir 失败说明尚未 init)
      const initCheck = yield* git(["rev-parse", "--git-dir"], { cwd: input.directory })
      if (initCheck.code !== 0) {
        if (!initCheck.stderr && !initCheck.text) {
          yield* Effect.fail(new Error("未检测到 Git，请确认已安装"))
        }
        const initResult = yield* git(["init", "--quiet"], { cwd: input.directory })
        if (initResult.code !== 0) {
          yield* Effect.fail(new Error(initResult.stderr.trim() || initResult.text.trim() || "Failed to initialize git repository"))
        }
      }
      // origin 已存在 → set-url 更新;不存在 → add 新增
      const existing = yield* git(["remote", "get-url", "origin"], { cwd: input.directory })
      if (existing.code === 0) {
        const setResult = yield* git(["remote", "set-url", "origin", "--", input.url], { cwd: input.directory })
        if (setResult.code !== 0) {
          yield* Effect.fail(new Error(setResult.stderr.trim() || setResult.text.trim() || "Failed to set git remote URL"))
        }
      } else {
        const addResult = yield* git(["remote", "add", "origin", "--", input.url], { cwd: input.directory })
        if (addResult.code !== 0) {
          yield* Effect.fail(new Error(addResult.stderr.trim() || addResult.text.trim() || "Failed to add git remote"))
        }
      }
      return { remoteUrl: input.url }
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
      yield* db((d) =>
        d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
      )
    })

    const initState = yield* InstanceState.make(
      Effect.fn("Project.initState")(function* (ctx) {
        yield* (yield* bus.subscribe(Command.Event.Executed)).pipe(
          Stream.runForEach((payload) =>
            payload.properties.name === Command.Default.INIT ? setInitialized(ctx.project.id) : Effect.void,
          ),
          Effect.forkScoped,
        )
      }),
    )

    const init = Effect.fn("Project.init")(function* () {
      yield* InstanceState.get(initState)
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = [...row.sandboxes]
      if (!sboxes.includes(directory)) sboxes.push(directory)
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({ sandboxes: sboxes, time_updated: Date.now() })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = row.sandboxes.filter((s) => s !== directory)
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({ sandboxes: sboxes, time_updated: Date.now() })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      init,
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      getGitRemote,
      addGitRemote,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export const use = serviceUse(Service)

export function list() {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .map((row) => fromRow(row)),
  )
}

export function get(id: ProjectID): Info | undefined {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) return undefined
  return fromRow(row)
}

export function setInitialized(id: ProjectID) {
  Database.use((db) =>
    db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
  )
}

export * as Project from "./project"
