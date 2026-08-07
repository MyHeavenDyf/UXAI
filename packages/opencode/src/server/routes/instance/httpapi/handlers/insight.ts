import * as InstanceState from "@/effect/instance-state"
import { listInsightSessions } from "@/session/session-insight-query"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import path from "path"
import { InstanceHttpApi } from "../api"
import { InsightSessionListQuery, InsightFileListQuery } from "../groups/insight"

// 子路径清洗:拒 .. / ~ / 空串,防止越出 uploads 根(与 artifact handler 同口径)。
function sanitizePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (normalized.includes("..") || normalized.includes("~") || normalized.length === 0) return ""
  return normalized
}

export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    // 撞名加后缀(name (1).ext),与单文件 upload / 操作系统口径一致,不覆盖已有同名文件。
    // 大小写不敏感文件系统(macOS APFS 默认)下,Foo.txt 与已存在的 foo.txt 会被 fs.exists 判为
    // 同名——若直接 writeFile 会静默覆盖致文件丢失(上传"提示成功却文件缺失")。先探测再写,
    // 撞名则改名保留两份。filePath 可含子目录(nested relativePath),extname/basename/dirname 照常。
    const collisionFreeFilePath = (filePath: string) =>
      Effect.gen(function* () {
        const ext = path.extname(filePath)
        const baseName = path.basename(filePath, ext)
        const dir = path.dirname(filePath)
        let candidate = filePath
        let counter = 1
        while (true) {
          const exists = yield* fs.exists(candidate).pipe(Effect.catch(() => Effect.succeed(false)))
          if (!exists) return candidate
          candidate = path.join(dir, `${baseName} (${counter})${ext}`)
          counter++
        }
      })

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
    const listFiles = Effect.fn("InsightHttpApi.listFiles")(function* (ctx: {
      query: typeof InsightFileListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      const category = ctx.query.category
      const subPath = ctx.query.path ?? ""

      if (category === "outputs") {
        const dir = path.join(instance.directory, ".octo", ctx.query.sessionId, "outputs")
        const exists = yield* fs.exists(dir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }
        const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
        const files: Array<{ name: string; path: string; size: number; mtime: number; isFolder: boolean; relativePath: string }> = []
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

      const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
      const files: Array<{ name: string; path: string; size: number; mtime: number; isFolder: boolean; relativePath: string }> = []
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

      const fullPath = yield* collisionFreeFilePath(path.join(targetDir, body.filename))
      const finalFilename = path.basename(fullPath)
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

      const folderResolved = path.resolve(folderDir)
      for (const file of body.files) {
        const rel = file.relativePath.trim()
        if (rel === "") yield* Effect.fail(new HttpApiError.BadRequest({}))
        const filePath = path.join(folderDir, rel)
        // 路径穿越防护:relativePath 解析后必须仍在 folderDir 之下,拒 .. / 绝对路径越界。
        if (!path.resolve(filePath).startsWith(folderResolved + path.sep)) {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        yield* fs.ensureDir(path.dirname(filePath)).pipe(Effect.orDie)
        // 逐文件撞名改名(不覆盖):macOS 大小写不敏感 FS 下 Foo.txt/foo.txt 会判同名,
        // 直接 writeFile 会静默覆盖致文件缺失。撞名时改名为 name (1).ext 保留两份。
        const finalFilePath = yield* collisionFreeFilePath(filePath)
        const contentBuffer = Buffer.from(file.content, "base64")
        yield* fs.writeFile(finalFilePath, contentBuffer).pipe(Effect.orDie)
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

    return handlers
      .handle("listSessions", listSessions)
      .handle("listFiles", listFiles)
      .handle("upload", upload)
      .handle("uploadFolder", uploadFolder)
  }),
)
