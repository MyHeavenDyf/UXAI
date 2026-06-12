import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "@/file"
import { jsonRequest, runRequest } from "./trace"
import { lazy } from "@/util/lazy"
import path from "path"
import { Effect, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "@/project/instance"

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

export const ArtifactRoutes = lazy(() =>
  new Hono()
    .get(
      "/list",
      describeRoute({
        summary: "List artifacts",
        description: "List all artifact files in .octo/artifacts/make/<sessionId> directory.",
        operationId: "artifact.list",
        responses: {
          200: {
            description: "Artifact files",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    files: z.array(
                      z.object({
                        name: z.string(),
                        path: z.string(),
                        sessionId: z.string(),
                        kind: z.string(),
                        size: z.number(),
                        mtime: z.number(),
                        mime: z.string(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          sessionId: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.list", c, function* () {
          const sessionId = c.req.valid("query").sessionId
          const fs = yield* AppFileSystem.Service
          const artifactDir = path.join(Instance.directory, ARTIFACTS_BASE_DIR, sessionId)

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
        }),
    )
    .get(
      "/content",
      describeRoute({
        summary: "Read artifact",
        description: "Read the content of an artifact file.",
        operationId: "artifact.read",
        responses: {
          200: {
            description: "Artifact content",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    content: z.string(),
                    mimeType: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.read", c, function* () {
          const filePath = c.req.valid("query").path
          const svc = yield* File.Service
          const result = yield* svc.read(filePath)
          return { content: result.content, mimeType: result.mimeType ?? getMime(filePath) }
        }),
    )
    .delete(
      "/file",
      describeRoute({
        summary: "Delete artifact",
        description: "Delete a single artifact file.",
        operationId: "artifact.delete",
        responses: {
          200: {
            description: "Deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.delete", c, function* () {
          const filePath = c.req.valid("query").path
          const fs = yield* AppFileSystem.Service
          yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void))
          return { ok: true }
        }),
    )
    .post(
      "/rename",
      describeRoute({
        summary: "Rename artifact",
        description: "Rename an artifact file.",
        operationId: "artifact.rename",
        responses: {
          200: {
            description: "Renamed file info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    path: z.string(),
                    kind: z.string(),
                    mime: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          from: z.string(),
          to: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.rename", c, function* () {
          const body = c.req.valid("json")
          const fs = yield* AppFileSystem.Service
          yield* fs.rename(body.from, body.to).pipe(Effect.catch(() => Effect.void))
          const name = path.basename(body.to)
          return { name, path: body.to, kind: getKind(name), mime: getMime(name) }
        }),
    )
    .post(
      "/archive",
      describeRoute({
        summary: "Archive artifacts",
        description: "Create a ZIP archive of selected artifact files.",
        operationId: "artifact.archive",
        responses: {
          200: {
            description: "ZIP archive",
            content: {
              "application/zip": {
                schema: resolver(z.string()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          files: z.string().array(),
        }),
      ),
      async (c) => {
        const files = c.req.valid("json").files
        const zipData = await runRequest(
          "ArtifactRoutes.archive",
          c,
          Effect.gen(function* () {
            const fs = yield* AppFileSystem.Service
            if (files.length === 0) return new Uint8Array()

            const fileEntries: Array<{ filename: string; content: Uint8Array }> = []
            for (const filePath of files) {
              const content = yield* fs.readFile(filePath).pipe(
                Effect.catch(() => Effect.succeed(new Uint8Array())),
              )
              const filename = path.basename(filePath)
              fileEntries.push({ filename, content })
            }

            return createZipArchive(fileEntries)
          }),
        )

        const filename = "artifacts-" + new Date().toISOString().slice(0, 10) + ".zip"
        return c.body(Buffer.from(zipData), 200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
        })
      },
    )
    .post(
      "/delete-batch",
      describeRoute({
        summary: "Batch delete artifacts",
        description: "Delete multiple artifact files.",
        operationId: "artifact.deleteBatch",
        responses: {
          200: {
            description: "Deleted count",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), deleted: z.number() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          files: z.string().array(),
        }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.deleteBatch", c, function* () {
          const files = c.req.valid("json").files
          const fs = yield* AppFileSystem.Service
          let deleted = 0
          for (const filePath of files) {
            const existed = yield* fs.exists(filePath).pipe(Effect.catch(() => Effect.succeed(false)))
            if (existed) {
              yield* fs.remove(filePath).pipe(Effect.catch(() => Effect.void))
              deleted++
            }
          }
          return { ok: true, deleted }
        }),
    ),
)

function createZipArchive(files: Array<{ filename: string; content: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const localHeaders: Array<{ offset: number; filename: string; size: number; crc: number }> = []
  let offset = 0

  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename)
    const crc = crc32(file.content)
    const size = file.content.length

    const localHeader = new Uint8Array(30 + filenameBytes.length)
    const view = new DataView(localHeader.buffer)

    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint32(12, crc, true)
    view.setUint32(16, size, true)
    view.setUint32(20, size, true)
    view.setUint16(24, filenameBytes.length, true)
    view.setUint16(26, 0, true)
    localHeader.set(filenameBytes, 30)

    localHeaders.push({ offset, filename: file.filename, size, crc })
    chunks.push(localHeader)
    chunks.push(file.content)
    offset += localHeader.length + size
  }

  const centralDirOffset = offset
  for (const entry of localHeaders) {
    const filenameBytes = encoder.encode(entry.filename)
    const centralHeader = new Uint8Array(46 + filenameBytes.length)
    const view = new DataView(centralHeader.buffer)

    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint32(14, entry.crc, true)
    view.setUint32(18, entry.size, true)
    view.setUint32(22, entry.size, true)
    view.setUint16(26, filenameBytes.length, true)
    view.setUint16(28, 0, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint32(36, 0, true)
    view.setUint32(40, entry.offset, true)
    centralHeader.set(filenameBytes, 46)

    chunks.push(centralHeader)
    offset += centralHeader.length
  }

  const centralDirSize = offset - centralDirOffset
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)

  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, localHeaders.length, true)
  endView.setUint16(10, localHeaders.length, true)
  endView.setUint32(12, centralDirSize, true)
  endView.setUint32(16, centralDirOffset, true)
  endView.setUint16(20, 0, true)

  chunks.push(endRecord)

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let resultOffset = 0
  for (const chunk of chunks) {
    result.set(chunk, resultOffset)
    resultOffset += chunk.length
  }

  return result
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table()
  let crc = 0xffffffff
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function getCrc32Table(): number[] {
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table.push(c)
  }
  return table
}