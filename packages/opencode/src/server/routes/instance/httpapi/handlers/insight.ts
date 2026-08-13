import { Bus } from "@/bus"
import * as InstanceState from "@/effect/instance-state"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import {
  ChatMigrationError,
  logChatMigrationFailure,
  previewChatMigration,
  readMigratedSessions,
  runChatMigration,
  type MigrationStage,
} from "@/session/session-chat-migration"
import { listInsightSessions } from "@/session/session-insight-query"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import path from "path"
import { InstanceHttpApi } from "../api"
import { InsightChatMigrationError, InsightChatMigrationPayload, InsightSessionListQuery, InsightFileListQuery } from "../groups/insight"

// 子路径清洗:拒 .. / ~ / 空串,防止越出 uploads 根(与 artifact handler 同口径)。
function sanitizePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (normalized.includes("..") || normalized.includes("~") || normalized.length === 0) return ""
  return normalized
}

type InsightFileItem = { name: string; path: string; size: number; mtime: number; isFolder: boolean; relativePath: string }

// 递归遍历目录,平铺返回所有文件(isFolder=false)。
// 注意:recursive 模式下 relativePath 是相对于 category 根目录的路径,与非递归 uploads 模式下
// relativePath 相对 uploads 根(含 subPath 前缀)的语义不同。当前 @引用面板只用 name/path,不受影响。
const collectFilesRecursive = (fs: AppFileSystem.Interface, dir: string, baseRelativePath: string, files: InsightFileItem[], depth: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (depth > 10) {
      console.warn("[insight:collectFilesRecursive] max depth exceeded, skipping", { dir, depth })
      return
    }
    const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
    for (const name of entries) {
      if (name.startsWith(".")) continue
      const fullPath = path.join(dir, name)
      const relativePath = baseRelativePath ? `${baseRelativePath}/${name}` : name
      const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
      if (!stat) continue
      if (stat.type === "Directory") {
        yield* collectFilesRecursive(fs, fullPath, relativePath, files, depth + 1)
      } else {
        files.push({
          name,
          path: fullPath,
          size: typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0),
          mtime: Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now(),
          isFolder: false,
          relativePath,
        })
      }
    }
  })

function migrationFailure(stage: MigrationStage, message: string) {
  logChatMigrationFailure(stage, message)
  return new InsightChatMigrationError({ name: "ChatMigrationError", data: { stage, message } })
}

export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const projectSvc = yield* Project.Service
    const bus = yield* Bus.Service

    const listSessions = Effect.fn("InsightHttpApi.listSessions")(function* (ctx: {
      query: typeof InsightSessionListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return listInsightSessions({
        projectID: instance.project.id,
        directory: ctx.query.directory ?? instance.directory,
        limit: ctx.query.limit ?? 100,
        offset: ctx.query.offset ?? 0,
      })
    })

    // SPEC-INS-014 §10:列 <projectDir>/.octo/<sessionId>/<category>/[/path]。
    // uploads 段支持子文件夹导航(path 非空 → 列 uploads/<path>/,含文件夹条目);
    // outputs 段扁平(生成产物,无子目录)。返回 isFolder + relativePath 供前端面包屑/导航。
    // recursive=true 时递归遍历子文件夹,平铺返回所有文件(isFolder=false)。
    const listFiles = Effect.fn("InsightHttpApi.listFiles")(function* (ctx: {
      query: typeof InsightFileListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      const category = ctx.query.category
      const subPath = ctx.query.path ?? ""
      const recursive = ctx.query.recursive ?? false

      if (category === "outputs") {
        const dir = path.join(instance.directory, ".octo", ctx.query.sessionId, "outputs")
        const exists = yield* fs.exists(dir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }

        if (recursive) {
          const files: InsightFileItem[] = []
          yield* collectFilesRecursive(fs, dir, "", files, 0)
          return { files }
        }

        const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
        const files: InsightFileItem[] = []
        for (const name of entries) {
          if (name.startsWith(".")) continue
          const fullPath = path.join(dir, name)
          const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
          if (!stat || stat.type === "Directory") continue
          files.push({
            name,
            path: fullPath,
            size: typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0),
            mtime: Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now(),
            isFolder: false,
            relativePath: "",
          })
        }
        return { files }
      }

      // uploads
      const uploadsRoot = path.join(instance.directory, ".octo", ctx.query.sessionId, "uploads")
      const targetDir = subPath.trim() !== "" ? path.join(uploadsRoot, sanitizePath(subPath)) : uploadsRoot

      const exists = yield* fs.exists(targetDir).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) return { files: [] }

      if (recursive) {
        const files: InsightFileItem[] = []
        yield* collectFilesRecursive(fs, targetDir, "", files, 0)
        return { files }
      }

      const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
      const files: InsightFileItem[] = []
      for (const name of entries) {
        if (name.startsWith(".")) continue
        const fullPath = path.join(targetDir, name)
        const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
        if (!stat) continue
        const isFolder = stat.type === "Directory"
        const sizeNum = isFolder ? 0 : (typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0))
        const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
        // relativePath 相对 uploads 根,拼出"上传文件"文件夹导航用的累计路径。
        const relSeg = subPath.trim() !== "" ? `${sanitizePath(subPath)}/${name}` : name
        files.push({
          name,
          path: fullPath,
          size: sizeNum,
          mtime: mtimeNum,
          isFolder,
          relativePath: relSeg,
        })
      }
      return { files }
    })

    // 上传单文件:base64 写入 insight/<sessionId>/uploads/[path]/filename,撞名加后缀。
    const upload = Effect.fn("InsightHttpApi.upload")(function* (ctx: {
      payload: { sessionId: string; filename: string; content: string; path?: string }
    }) {
      const body = ctx.payload
      const instance = yield* InstanceState.context
      const uploadsRoot = path.join(instance.directory, ".octo", body.sessionId, "uploads")
      yield* fs.ensureDir(uploadsRoot).pipe(Effect.orDie)

      let targetDir = uploadsRoot
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") yield* Effect.fail(new HttpApiError.BadRequest({}))
        targetDir = path.join(uploadsRoot, targetSubPath)
        yield* fs.ensureDir(targetDir).pipe(Effect.orDie)
      }

      let finalFilename = body.filename
      let counter = 1
      const ext = path.extname(body.filename)
      const baseName = path.basename(body.filename, ext)
      while (true) {
        const fullPath = path.join(targetDir, finalFilename)
        const fileExists = yield* fs.exists(fullPath).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!fileExists) break
        // 撞名加括号后缀,与操作系统 / 旧主进程上传口径一致(name (1).ext)。
        finalFilename = `${baseName} (${counter})${ext}`
        counter++
      }

      const fullPath = path.join(targetDir, finalFilename)
      const contentBuffer = Buffer.from(body.content, "base64")
      yield* fs.writeFile(fullPath, contentBuffer).pipe(Effect.orDie)

      const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
      const sizeNum = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : contentBuffer.length
      const mtimeNum = stat && Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
      const relSeg = targetSubPath ? `${targetSubPath}/${finalFilename}` : finalFilename

      return {
        name: finalFilename,
        path: fullPath,
        size: sizeNum,
        mtime: mtimeNum,
        isFolder: false,
        relativePath: relSeg,
      }
    })

    // 上传文件夹:保留目录结构写入 insight/<sessionId>/uploads/[path]/<folderName>/...
    const uploadFolder = Effect.fn("InsightHttpApi.uploadFolder")(function* (ctx: {
      payload: { sessionId: string; folderName: string; files: ReadonlyArray<{ relativePath: string; content: string }>; path?: string }
    }) {
      const body = ctx.payload
      const instance = yield* InstanceState.context
      const uploadsRoot = path.join(instance.directory, ".octo", body.sessionId, "uploads")
      yield* fs.ensureDir(uploadsRoot).pipe(Effect.orDie)

      let targetDir = uploadsRoot
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") yield* Effect.fail(new HttpApiError.BadRequest({}))
        targetDir = path.join(uploadsRoot, targetSubPath)
        yield* fs.ensureDir(targetDir).pipe(Effect.orDie)
      }

      // 文件夹撞名加括号后缀(name (1)),与单文件上传 / 操作系统口径一致,不覆盖已有同名文件夹。
      let finalFolderName = body.folderName
      let folderCounter = 1
      while (true) {
        const folderExists = yield* fs
          .exists(path.join(targetDir, finalFolderName))
          .pipe(Effect.catch(() => Effect.succeed(false)))
        if (!folderExists) break
        finalFolderName = `${body.folderName} (${folderCounter})`
        folderCounter++
      }
      const folderDir = path.join(targetDir, finalFolderName)
      yield* fs.ensureDir(folderDir).pipe(Effect.orDie)

      for (const file of body.files) {
        const filePath = path.join(folderDir, file.relativePath)
        const parentDir = path.dirname(filePath)
        yield* fs.ensureDir(parentDir).pipe(Effect.catch(() => Effect.void))
        const contentBuffer = Buffer.from(file.content, "base64")
        yield* fs.writeFile(filePath, contentBuffer).pipe(Effect.orDie)
      }

      const stat = yield* fs.stat(folderDir).pipe(Effect.catch(() => Effect.succeed(null)))
      const mtimeNum = stat && Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

      return {
        name: finalFolderName,
        path: folderDir,
        fileCount: body.files.length,
        mtime: mtimeNum,
      }
    })

    // ── SPEC-INS-031 chat 历史会话迁移(临时功能)──────────────────────────────
    // 目标目录必须真实存在且是目录:传个不存在 / 打错的路径就中止,不能把一批会话迁到
    // 一个空气目录里(它们会从任何列表里消失,虽然数据还在)。
    const assertDirectory = Effect.fn("InsightHttpApi.chatMigration.assertDirectory")(function* (directory: string) {
      if (!path.isAbsolute(directory)) {
        yield* Effect.fail(migrationFailure("resolve-project", "请选择一个目标文件夹"))
      }
      const stat = yield* fs.stat(directory).pipe(Effect.catch(() => Effect.succeed(null)))
      if (!stat) yield* Effect.fail(migrationFailure("resolve-project", `目标文件夹不存在：${directory}`))
      else if (stat.type !== "Directory")
        yield* Effect.fail(migrationFailure("resolve-project", `目标路径不是文件夹：${directory}`))
    })

    const chatMigrationPreview = Effect.fn("InsightHttpApi.chatMigrationPreview")(function* (ctx: {
      payload: typeof InsightChatMigrationPayload.Type
    }) {
      return yield* Effect.try({
        try: () => previewChatMigration({ directory: ctx.payload.directory }),
        catch: (err) => migrationFailure("resolve-project", String(err instanceof Error ? err.message : err)),
      })
    })

    const chatMigrationRun = Effect.fn("InsightHttpApi.chatMigrationRun")(function* (ctx: {
      payload: typeof InsightChatMigrationPayload.Type
    }) {
      // 空串要在 resolve 之前挡掉:path.resolve("") 会返回进程 cwd,那就成了"没选目录却迁到
      // server 的工作目录"。
      const raw = ctx.payload.directory?.trim() ?? ""
      if (raw === "") yield* Effect.fail(migrationFailure("resolve-project", "请选择一个目标文件夹"))

      // 规范化:去尾斜杠、折掉 . / ..、统一分隔符。列表查询是 `eq(directory)` **精确匹配**,
      // 一个尾斜杠就足以让「提示迁移成功 N 条,列表里一条没有」重演(与 project_id 漏写同款症状)。
      // ⚠️ 只做字符串规范化,**故意不 realpath**:instance.directory 全链路都是原样透传的
      // (instance-store 拿它直接当 cache key,没有任何符号链接解析)。这里若把
      // /var 解析成 /private/var,写进去的反而会与列表查询的口径不一致 —— 正好制造它想防的问题。
      const directory = path.resolve(raw)
      yield* assertDirectory(directory)

      // ① 解析目标 project(§3.1):project 与目录是**多对一**(非 git 目录共用 global,
      // 同一仓库的多个子目录/worktree 共用一个 id),所以必须走服务端解析,不能沿用原值、
      // 更不能让客户端猜。fromDirectory 顺带 upsert project 行——session.project_id 有外键。
      const resolved = yield* projectSvc.fromDirectory(directory).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(migrationFailure("resolve-project", `无法识别目标文件夹：${String(cause)}`)),
        ),
      )

      // ② 备份 + 校验 → ③ 事务 UPDATE。顺序不能变(VACUUM INTO 不能在事务内执行),
      // 前两步任一失败都还没动过数据,第三步失败整体回滚。
      const result = yield* Effect.try({
        try: () => runChatMigration({ directory, projectID: resolved.project.id }),
        catch: (err) => {
          const stage: MigrationStage = err instanceof ChatMigrationError ? err.stage : "update"
          return migrationFailure(stage, String(err instanceof Error ? err.message : err))
        },
      })

      // 迁移走直接 UPDATE、不经 session 服务,不会自动发事件;由权威侧补一次 session.updated,
      // 让 insight 列表按现有机制自刷新(§4.2)。发事件失败绝不能反过来让已成功的迁移报错。
      if (result.migrated > 0) {
        const infos = readMigratedSessions(result.migratedIDs)
        yield* Effect.forEach(infos, (info) => bus.publish(Session.Event.Updated, { sessionID: info.id, info }), {
          discard: true,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              // 事件没发出去只影响「列表要不要手动刷一下」,迁移本身已经成功提交,不能反过来报错。
              console.error(`[octo:chat-migrate] publish-failed`, JSON.stringify({ error: String(cause) })),
            ),
          ),
        )
        console.log(`[octo:chat-migrate] published`, JSON.stringify({ events: infos.length }))
      }

      return { migrated: result.migrated, backupPath: result.backupPath }
    })

    return handlers
      .handle("listSessions", listSessions)
      .handle("listFiles", listFiles)
      .handle("upload", upload)
      .handle("uploadFolder", uploadFolder)
      .handle("chatMigrationPreview", chatMigrationPreview)
      .handle("chatMigrationRun", chatMigrationRun)
  }),
)
