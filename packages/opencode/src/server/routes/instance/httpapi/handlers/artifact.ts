import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { File } from "@/file"
import * as InstanceState from "@/effect/instance-state"
import path from "path"

const ARTIFACTS_BASE_DIR = ".octo/artifacts/make"

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

    const list = Effect.fn("ArtifactHttpApi.list")(function* (ctx: { query: { sessionId: string } }) {
      const sessionId = ctx.query.sessionId
      const instanceCtx = yield* InstanceState.context
      const artifactDir = path.join(instanceCtx.directory, ARTIFACTS_BASE_DIR, sessionId)

      const exists = yield* fs.exists(artifactDir).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) {
        return { files: [] }
      }

      const entries = yield* fs.readDirectory(artifactDir).pipe(Effect.catch(() => Effect.succeed([])))
      const files: Array<{
        name: string
        path: string
        sessionId: string
        kind: string
        size: number
        mtime: number
        mime: string
      }> = []

      for (const name of entries) {
        if (name.startsWith(".")) continue

        const fullPath = path.join(artifactDir, name)
        const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))

        if (!stat || stat.type === "Directory") continue

        const sizeNum = typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0)
        const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

        files.push({
          name,
          path: fullPath,
          sessionId,
          kind: getKind(name),
          size: sizeNum,
          mtime: mtimeNum,
          mime: getMime(name),
        })
      }

      return { files }
    })

    const content = Effect.fn("ArtifactHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      const result = yield* fileSvc.read(filePath).pipe(
        Effect.mapError(() => new HttpApiError.NotFound({})),
      )
      return { content: result.content, mimeType: result.mimeType ?? getMime(filePath) }
    })

    const delete_ = Effect.fn("ArtifactHttpApi.delete")(function* (ctx: { query: { path: string } }) {
      const filePath = ctx.query.path
      yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void))
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
          yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void))
          deleted++
        }
      }
      return { ok: true, deleted }
    })

    return handlers
      .handle("list", list)
      .handle("content", content)
      .handle("delete", delete_)
      .handle("rename", rename)
      .handle("archive", archive)
      .handle("deleteBatch", deleteBatch)
  }),
)