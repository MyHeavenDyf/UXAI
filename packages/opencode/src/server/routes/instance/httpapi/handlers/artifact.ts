import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { File } from "@/file"
import * as InstanceState from "@/effect/instance-state"
import path from "path"
import { injectArtifactBridges } from "./artifact-bridge"

const ARTIFACTS_BASE_DIR = ".octo/artifacts/make"
const UPLOAD_FILES_DIR = "upload-files"
const ICONPLUS_FILES_DIR = "iconPlus"

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

function createZipArchive(entries: Array<{ filename: string; content: Uint8Array }>): Uint8Array {
  const localFileHeaders: Array<Uint8Array> = []
  const centralDirectory: Array<Uint8Array> = []
  let offset = 0

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
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint32(12, crc, true)
    view.setUint32(16, compressedSize, true)
    view.setUint32(20, uncompressedSize, true)
    view.setUint16(24, filenameBytes.length, true)
    view.setUint16(26, 0, true)
    localHeader.set(filenameBytes, 30)
    localFileHeaders.push(localHeader)
    localFileHeaders.push(content)
    offset += localHeader.length + content.length

    const centralHeader = new Uint8Array(46 + filenameBytes.length)
    const cview = new DataView(centralHeader.buffer)
    cview.setUint32(0, 0x02014b50, true)
    cview.setUint16(4, 20, true)
    cview.setUint16(6, 20, true)
    cview.setUint16(8, 0, true)
    cview.setUint16(10, 0, true)
    cview.setUint16(12, 0, true)
    cview.setUint32(14, crc, true)
    cview.setUint32(18, compressedSize, true)
    cview.setUint32(22, uncompressedSize, true)
    cview.setUint16(26, filenameBytes.length, true)
    cview.setUint16(28, 0, true)
    cview.setUint16(30, 0, true)
    cview.setUint16(32, 0, true)
    cview.setUint16(34, 0, true)
    cview.setUint32(36, offset - localHeader.length - content.length, true)
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
      const artifactDir = path.join(instanceCtx.directory, ARTIFACTS_BASE_DIR, sessionId)
      const uploadFilesDir = path.join(artifactDir, UPLOAD_FILES_DIR)

      yield* fs.ensureDir(uploadFilesDir).pipe(Effect.catch(() => Effect.void))

      if (category === "generated") {
        const exists = yield* fs.exists(artifactDir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }

        const entries = yield* fs.readDirectory(artifactDir).pipe(Effect.catch(() => Effect.succeed([])))
        const files: ArtifactFileInfo[] = []

        for (const name of entries) {
          if (name.startsWith(".") || name === UPLOAD_FILES_DIR || name === ICONPLUS_FILES_DIR) continue

          const fullPath = path.join(artifactDir, name)
          const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))

          if (!stat) continue

          const isFolder = stat.type === "Directory"
          if (recursive && isFolder) {
            yield* collectFilesRecursive(fullPath, name, sessionId, files)
          } else {
            const sizeNum = isFolder ? 0 : (typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0))
            const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()
            files.push({
              name,
              path: fullPath,
              relativePath: name,
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
        const targetDir = subPath ? path.join(uploadFilesDir, sanitizePath(subPath)) : uploadFilesDir

        const exists = yield* fs.exists(targetDir).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) return { files: [] }

        const files: ArtifactFileInfo[] = []

        if (recursive) {
          const baseRelativePath = subPath ? `upload-files/${sanitizePath(subPath)}` : "upload-files"
          yield* collectFilesRecursive(targetDir, baseRelativePath, sessionId, files)
        } else {
          const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
          for (const name of entries) {
            if (name.startsWith(".")) continue

            const fullPath = path.join(targetDir, name)
            const relativePath = subPath ? `upload-files/${sanitizePath(subPath)}/${name}` : `upload-files/${name}`
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
      const artifactDir = path.join(instanceCtx.directory, ARTIFACTS_BASE_DIR, body.sessionId)
      const uploadFilesDir = path.join(artifactDir, UPLOAD_FILES_DIR)

      yield* fs.ensureDir(uploadFilesDir).pipe(Effect.orDie)

      let targetDir = uploadFilesDir
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        targetDir = path.join(uploadFilesDir, targetSubPath)
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
      const artifactDir = path.join(instanceCtx.directory, ARTIFACTS_BASE_DIR, body.sessionId)
      const uploadFilesDir = path.join(artifactDir, UPLOAD_FILES_DIR)

      yield* fs.ensureDir(uploadFilesDir).pipe(Effect.orDie)

      let targetDir = uploadFilesDir
      let targetSubPath = ""
      if (body.path && body.path.trim() !== "") {
        targetSubPath = sanitizePath(body.path)
        if (targetSubPath === "") {
          yield* Effect.fail(new HttpApiError.BadRequest({}))
        }
        targetDir = path.join(uploadFilesDir, targetSubPath)
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
      const artifactDir = path.join(instanceCtx.directory, ARTIFACTS_BASE_DIR, sessionId)
      const filePath = path.join(artifactDir, relativePath)

      const resolvedPath = path.resolve(filePath)
      const resolvedArtifactDir = path.resolve(artifactDir)
      if (!resolvedPath.startsWith(resolvedArtifactDir)) {
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