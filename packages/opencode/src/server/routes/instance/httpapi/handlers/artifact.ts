import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { File } from "@/file"
import * as InstanceState from "@/effect/instance-state"
import path from "path"
import { injectArtifactBridges } from "./artifact-bridge"

const SESSION_BASE_DIR = ".octo"
const OUTPUTS_DIR = "outputs"
const UPLOADS_DIR = "uploads"
const COMMENTS_DIR = "comments"

function sanitizePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (normalized.includes("..") || normalized.includes("~") || normalized.length === 0) {
    return ""
  }
  return normalized
}

const KIND_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  js: "code",
  ts: "code",
  json: "code",
  css: "code",
  pdf: "pdf",
}

const MIME_MAP: Record<string, string> = {
  html: "text/html",
  svg: "image/svg+xml",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  js: "application/javascript",
  ts: "application/typescript",
  css: "text/css",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

function getKind(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return KIND_BY_EXT[ext] ?? "binary"
}

function getMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return MIME_MAP[ext] ?? "application/octet-stream"
}

function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// UTF-8 语言编码标记(general purpose bit 11):文件名按 UTF-8 编码时必须置位,
// 否则 Windows 资源管理器会按本地代码页(如 GBK)解读,中文名变乱码。
const ZIP_FLAG_UTF8 = 0x0800

// 选中文件按 basename 入包,重名会导致解压时互相覆盖(选 14 个只解出 8 个)。
// 对重名条目补 " (n)" 后缀去重,与操作系统重名策略一致。
function dedupeZipNames(
  entries: Array<{ filename: string; content: Uint8Array }>,
): Array<{ filename: string; content: Uint8Array }> {
  const used = new Set<string>()
  return entries.map((entry) => {
    let name = entry.filename
    if (used.has(name)) {
      const dot = name.lastIndexOf(".")
      const base = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ""
      let n = 1
      do {
        name = `${base} (${n})${ext}`
        n++
      } while (used.has(name))
    }
    used.add(name)
    return { filename: name, content: entry.content }
  })
}

function createZipArchive(rawEntries: Array<{ filename: string; content: Uint8Array }>): Uint8Array {
  const entries = dedupeZipNames(rawEntries)
  const localFileHeaders: Array<Uint8Array> = []
  const centralDirectory: Array<Uint8Array> = []
  let offset = 0

  // 用固定的合法 DOS 日期时间(2020-01-01 00:00:00),避免 0 值被判为非法日期。
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1
  const dosTime = 0

  for (const entry of entries) {
    const filenameBytes = new TextEncoder().encode(entry.filename)
    const content = entry.content
    const crc = crc32(content)
    const compressedSize = content.length
    const uncompressedSize = content.length

    const localHeader = new Uint8Array(30 + filenameBytes.length)
    const view = new DataView(localHeader.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, ZIP_FLAG_UTF8, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, dosTime, true)
    view.setUint16(12, dosDate, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, compressedSize, true)
    view.setUint32(22, uncompressedSize, true)
    view.setUint16(26, filenameBytes.length, true)
    view.setUint16(28, 0, true)
    localHeader.set(filenameBytes, 30)
    localFileHeaders.push(localHeader)
    localFileHeaders.push(content)
    offset += localHeader.length + content.length

    const centralHeader = new Uint8Array(46 + filenameBytes.length)
    const cview = new DataView(centralHeader.buffer)
    cview.setUint32(0, 0x02014b50, true)
    cview.setUint16(4, 20, true)
    cview.setUint16(6, 20, true)
    cview.setUint16(8, ZIP_FLAG_UTF8, true)
    cview.setUint16(10, 0, true)
    cview.setUint16(12, dosTime, true)
    cview.setUint16(14, dosDate, true)
    cview.setUint32(16, crc, true)
    cview.setUint32(20, compressedSize, true)
    cview.setUint32(24, uncompressedSize, true)
    cview.setUint16(28, filenameBytes.length, true)
    cview.setUint16(30, 0, true)
    cview.setUint16(32, 0, true)
    cview.setUint16(34, 0, true)
    cview.setUint16(36, 0, true)
    cview.setUint32(38, 0, true)
    cview.setUint32(42, offset - localHeader.length - content.length, true)
    centralHeader.set(filenameBytes, 46)
    centralDirectory.push(centralHeader)
  }

  const centralDirSize = centralDirectory.reduce((sum, arr) => sum + arr.length, 0)
  const endRecord = new Uint8Array(22)
  const eview = new DataView(endRecord.buffer)
  eview.setUint32(0, 0x06054b50, true)
  eview.setUint16(4, 0, true)
  eview.setUint16(6, 0, true)
  eview.setUint16(8, entries.length, true)
  eview.setUint16(10, entries.length, true)
  eview.setUint32(12, centralDirSize, true)
  eview.setUint32(16, offset, true)
  eview.setUint16(20, 0, true)

  const totalSize = offset + centralDirSize + 22
  const result = new Uint8Array(totalSize)
  let pos = 0
  for (const arr of localFileHeaders) {
    result.set(arr, pos)
    pos += arr.length
  }
  for (const arr of centralDirectory) {
    result.set(arr, pos)
    pos += arr.length
  }
  result.set(endRecord, pos)

  return result
}

export const artifactHandlers = HttpApiBuilder.group(InstanceHttpApi, "artifact", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const fileSvc = yield* File.Service

    type ArtifactFileInfo = {
      name: string
      path: string
      relativePath: string
      sessionId: string
      kind: string
      isFolder: boolean
      size: number
      mtime: number
      mime: string
    }

    const collectFilesRecursive = (dir: string, baseRelativePath: string, sessionId: string, files: ArtifactFileInfo[]): Effect.Effect<void> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
        for (const name of entries) {
          if (name.startsWith(".")) continue
          const fullPath = path.join(dir, name)
          const relativePath = baseRelativePath ? `${baseRelativePath}/${name}` : name
          const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
          if (!stat) continue
          const isFolder = stat.type === "Directory"
          if (isFolder) {
            yield* collectFilesRecursive(fullPath, relativePath, sessionId, files)
          } else {
            const sizeNum = typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0)
            const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
            files.push({
              name,
              path: fullPath,
              relativePath,
              sessionId,
              kind: getKind(name),
              isFolder: false,
              size: sizeNum,
              mtime: mtimeNum,
              mime: getMime(name),
            })
          }
        }
      })

    const list = Effect.fn("ArtifactHttpApi.list")(function* (ctx: { query: { sessionId: string; category?: "generated" | "uploaded"; path?: string; recursive?: boolean } }) {
      const sessionId = ctx.query.sessionId
      const category = ctx.query.category ?? "generated"
      const subPath = ctx.query.path ?? ""
      const recursive = ctx.query.recursive ?? false
      const instanceCtx = yield* InstanceState.context
      const sessionDir = path.join(instanceCtx.directory, SESSION_BASE_DIR, sessionId)
      const outputsDir = path.join(sessionDir, OUTPUTS_DIR)
      const uploadsDir = path.join(sessionDir, UPLOADS_DIR)

      yield* fs.ensureDir(outputsDir).pipe(Effect.catch(() => Effect.void))
      yield* fs.ensureDir(uploadsDir).pipe(Effect.catch(() => Effect.void))

      if (category === "generated") {
        const targetDir = subPath ? path.join(outputsDir, sanitizePath(subPath)) : outputsDir

        const exists = yield* fs.exists(targetDir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }

        const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
        const files: ArtifactFileInfo[] = []

        for (const name of entries) {
          if (name.startsWith(".")) continue

          const fullPath = path.join(targetDir, name)
          const relativePath = subPath ? `${sanitizePath(subPath)}/${name}` : name
          const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))

          if (!stat) continue

          const isFolder = stat.type === "Directory"
          if (recursive && isFolder) {
            yield* collectFilesRecursive(fullPath, relativePath, sessionId, files)
          } else {
            const sizeNum = isFolder ? 0 : (typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0))
            const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
            files.push({
              name,
              path: fullPath,
              relativePath,
              sessionId,
              kind: isFolder ? "folder" : getKind(name),
              isFolder,
              size: sizeNum,
              mtime: mtimeNum,
              mime: isFolder ? "" : getMime(name),
            })
          }
        }

        return { files }
      }

      if (category === "uploaded") {
        const targetDir = subPath ? path.join(uploadsDir, sanitizePath(subPath)) : uploadsDir

        const exists = yield* fs.exists(targetDir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }

        const files: ArtifactFileInfo[] = []

        if (recursive) {
          const baseRelativePath = subPath ? `uploads/${sanitizePath(subPath)}` : "uploads"
          yield* collectFilesRecursive(targetDir, baseRelativePath, sessionId, files)
        } else {
          const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
          for (const name of entries) {
            if (name.startsWith(".")) continue

            const fullPath = path.join(targetDir, name)
            const relativePath = subPath ? `uploads/${sanitizePath(subPath)}/${name}` : `uploads/${name}`
            const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))

            if (!stat) continue

            const isFolder = stat.type === "Directory"
            const sizeNum = isFolder ? 0 : (typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0))
            const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

            files.push({
              name,
              path: fullPath,
              relativePath,
              sessionId,
              kind: isFolder ? "folder" : getKind(name),
              isFolder,
              size: sizeNum,
              mtime: mtimeNum,
              mime: isFolder ? "" : getMime(name),
            })
          }
        }

        return { files }
      }

      return { files: [] }
    })

    const content = Effect.fn("ArtifactHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      const result = yield* fileSvc.read(filePath).pipe(
        Effect.mapError(() => new HttpApiError.NotFound({})),
      )
      // 增加encoding字段到返回值，前端用此判断返回文件编码
      // File.read 对二进制文件(office/pdf/video 等)只返回空 content(服务于文本预览,见 File.read);
      // 下载需原始字节:type==="binary" 回退 fs.readFile + base64,前端据 encoding:"base64" 解码落盘。
      // 用 type 而非 !content 判断:合法的空文本文件 content 也是 "",不应误判走二进制回退。
      if (result.type === "binary") {
        const bytes = yield* fs.readFile(filePath).pipe(
          Effect.mapError(() => new HttpApiError.NotFound({})),
        )
        return {
          content: Buffer.from(bytes).toString("base64"),
          mimeType: result.mimeType ?? getMime(filePath),
          encoding: "base64" as const,
        }
      }
      return {
        content: result.content,
        mimeType: result.mimeType ?? getMime(filePath),
        encoding: result.encoding,
      }
    })

    const delete_ = Effect.fn("ArtifactHttpApi.delete")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      yield* fs.remove(filePath, { recursive: true }).pipe(Effect.catch(() => Effect.void))
      return { ok: true }
    })

    const rename = Effect.fn("ArtifactHttpApi.rename")(function* (ctx: { payload: { from: string; to: string } }) {
      const body = ctx.payload
      yield* fs.rename(body.from, body.to).pipe(Effect.catch(() => Effect.void))
      const name = path.basename(body.to)
      return { name, path: body.to, kind: getKind(name), mime: getMime(name) }
    })

    const archive = Effect.fn("ArtifactHttpApi.archive")(function* (ctx: { payload: { files: readonly string[] } }) {
      const files = ctx.payload.files
      if (files.length === 0) {
        return HttpServerResponse.empty({ status: 200 })
      }

      const fileEntries: Array<{ filename: string; content: Uint8Array }> = []
      for (const filePath of files) {
        const content = yield* fs.readFile(filePath).pipe(
          Effect.catch(() => Effect.succeed(new Uint8Array())),
        )
        const filename = path.basename(filePath)
        fileEntries.push({ filename, content })
      }

      const zipData = createZipArchive(fileEntries)
      const filename = "artifacts-" + new Date().toISOString().slice(0, 10) + ".zip"
      return HttpServerResponse.raw(zipData, {
        status: 200,
        contentType: "application/zip",
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    })

    const deleteBatch = Effect.fn("ArtifactHttpApi.deleteBatch")(function* (ctx: { payload: { files: readonly string[] } }) {
      const files = ctx.payload.files
      let deleted = 0
      for (const filePath of files) {
        const existed = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)))
        if (existed) {
          yield* fs.remove(filePath, { recursive: true }).pipe(Effect.catch(() => Effect.void))
          deleted++
        }
      }
      return { ok: true, deleted }
    })

    const upload = Effect.fn("ArtifactHttpApi.upload")(function* (ctx: { payload: { sessionId: string; filename: string; content: string; path?: string } }) {
      const body = ctx.payload
      const instanceCtx = yield* InstanceState.context
      const sessionDir = path.join(instanceCtx.directory, SESSION_BASE_DIR, body.sessionId)
      const uploadsDir = path.join(sessionDir, UPLOADS_DIR)

      yield* fs.ensureDir(uploadsDir).pipe(Effect.orDie)

      let targetDir = uploadsDir
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        targetDir = path.join(uploadsDir, targetSubPath)
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
        finalFilename = `${baseName}-${counter}${ext}`
        counter++
      }

      const fullPath = path.join(targetDir, finalFilename)
      const contentBuffer = Buffer.from(body.content, "base64")
      yield* fs.writeFile(fullPath, contentBuffer).pipe(Effect.orDie)

      const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
      const sizeNum = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : contentBuffer.length
      const mtimeNum = stat && Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

      const relativePath = targetSubPath ? `${targetSubPath}/${finalFilename}` : finalFilename

      return {
        name: finalFilename,
        path: fullPath,
        relativePath,
        sessionId: body.sessionId,
        kind: getKind(finalFilename),
        isFolder: false,
        size: sizeNum,
        mtime: mtimeNum,
        mime: getMime(finalFilename),
      }
    })

    const uploadFolder = Effect.fn("ArtifactHttpApi.uploadFolder")(function* (ctx: { payload: { sessionId: string; folderName: string; files: readonly { relativePath: string; content: string }[]; path?: string } }) {
      const body = ctx.payload
      const instanceCtx = yield* InstanceState.context
      const sessionDir = path.join(instanceCtx.directory, SESSION_BASE_DIR, body.sessionId)
      const uploadsDir = path.join(sessionDir, UPLOADS_DIR)

      yield* fs.ensureDir(uploadsDir).pipe(Effect.orDie)

      let targetDir = uploadsDir
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        targetDir = path.join(uploadsDir, targetSubPath)
        yield* fs.ensureDir(targetDir).pipe(Effect.orDie)
      }

      const folderDir = path.join(targetDir, body.folderName)

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

      const relativePath = targetSubPath ? `${targetSubPath}/${body.folderName}` : body.folderName

      return {
        name: body.folderName,
        path: folderDir,
        relativePath,
        sessionId: body.sessionId,
        kind: "folder",
        isFolder: true,
        fileCount: body.files.length,
        mtime: mtimeNum,
      }
    })

    const serve = Effect.fn("ArtifactHttpApi.serve")(function* (ctx: { query: { sessionId: string; path: string } }) {
      const sessionId = ctx.query.sessionId
      const relativePath = ctx.query.path
      const instanceCtx = yield* InstanceState.context
      const sessionDir = path.join(instanceCtx.directory, SESSION_BASE_DIR, sessionId)
      const filePath = path.join(sessionDir, relativePath)

      const resolvedPath = path.resolve(filePath)
      const resolvedSessionDir = path.resolve(sessionDir)
      if (!resolvedPath.startsWith(resolvedSessionDir)) {
        yield* Effect.fail(new HttpApiError.NotFound({}))
      }

      const exists = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) {
        yield* Effect.fail(new HttpApiError.NotFound({}))
      }

      const content = yield* fs.readFile(filePath).pipe(
        Effect.mapError(() => new HttpApiError.NotFound({}))
      )
      const mimeType = getMime(relativePath)

      if (mimeType === "text/html") {
        const htmlStr = new TextDecoder().decode(content)
        const htmlWithBridge = injectArtifactBridges(htmlStr)
        return HttpServerResponse.raw(new TextEncoder().encode(htmlWithBridge), {
          status: 200,
          contentType: mimeType,
        })
      }

      return HttpServerResponse.raw(content, {
        status: 200,
        contentType: mimeType,
      })
    })

    return handlers
      .handle("list", list)
      .handle("content", content)
      .handle("delete", delete_)
      .handle("rename", rename)
      .handle("archive", archive)
      .handle("deleteBatch", deleteBatch)
      .handle("upload", upload)
      .handle("uploadFolder", uploadFolder)
      .handle("serve", serve)
  }),
)