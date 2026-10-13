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
import { expandPathsToZipEntries, createZipArchive } from "./httpapi/handlers/artifact"

const SESSION_BASE_DIR = ".octo"
const OUTPUTS_DIR = "outputs"
const UPLOADS_DIR = "uploads"

// 与 httpapi/handlers/artifact.ts 同语义:剥首尾斜杠,拒绝 .. / ~ / 空
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

export const ArtifactRoutes = lazy(() =>
  new Hono()
    .get(
      "/list",
      describeRoute({
        summary: "List artifacts",
        description: "List artifact files and folders in .octo/<sessionId>/outputs directory. Use 'path' parameter to navigate subfolders.",
        operationId: "artifact.list",
        responses: {
          200: {
            description: "Artifact files and folders",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    files: z.array(
                      z.object({
                        name: z.string(),
                        path: z.string(),
                        relativePath: z.string(),
                        sessionId: z.string(),
                        kind: z.string(),
                        isFolder: z.boolean(),
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
        z
          .object({
            sessionId: z.string().optional(),
            path: z.string().optional(),
            category: z.enum(["generated", "uploaded"]).optional(),
            scope: z.enum(["project"]).optional(),
          })
          .refine((v) => v.scope === "project" || !!v.sessionId, {
            message: "sessionId is required unless scope=project",
          }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.list", c, function* () {
const { sessionId, path: subPath, category, scope } = c.req.valid("query")
           const fs = yield* AppFileSystem.Service
           const projectScope = scope === "project"
           const stampedSessionId = projectScope ? "" : sessionId ?? ""

           // scope=project(代码工作区,统一文件树):仅支持 generated=项目根目录 (点开头条目被过滤),
           // uploaded 无独立上传区恒为空;session scope 维持 .octo/<sessionId>/ 布局 (原行为)。
           if (projectScope && category === "uploaded") {
             return { files: [] }
           }
           let categoryRoot: string
           let relativePrefix: string
           if (projectScope) {
             categoryRoot = Instance.directory
             relativePrefix = ""
           } else if (category === "uploaded") {
             categoryRoot = path.join(Instance.directory, SESSION_BASE_DIR, stampedSessionId, UPLOADS_DIR)
             relativePrefix = UPLOADS_DIR
             yield* fs.ensureDir(categoryRoot).pipe(Effect.catch(() => Effect.void))
           } else {
             categoryRoot = path.join(Instance.directory, SESSION_BASE_DIR, stampedSessionId, OUTPUTS_DIR)
             relativePrefix = ""
             yield* fs.ensureDir(categoryRoot).pipe(Effect.catch(() => Effect.void))
           }
           const targetDir = subPath ? path.join(categoryRoot, subPath) : categoryRoot

          const exists = yield* fs.exists(targetDir).pipe(Effect.catch(() => Effect.succeed(false)))
          if (!exists) {
            return { files: [] }
          }

          const entries = yield* fs.readDirectory(targetDir).pipe(Effect.catch(() => Effect.succeed([])))
          const files: Array<{
            name: string
            path: string
            relativePath: string
            sessionId: string
            kind: string
            isFolder: boolean
            size: number
            mtime: number
            mime: string
          }> = []

          for (const name of entries) {
            if (name.startsWith(".")) continue

            const fullPath = path.join(targetDir, name)
            const relativePath = [relativePrefix, subPath, name].filter(Boolean).join("/")
            const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))

            if (!stat) continue

            const isFolder = stat.type === "Directory"
            const sizeNum = isFolder ? 0 : (typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0))
            const mtimeNum = Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

            files.push({
              name,
              path: fullPath,
              relativePath,
              sessionId: stampedSessionId,
              kind: isFolder ? "folder" : getKind(name),
              isFolder,
              size: sizeNum,
              mtime: mtimeNum,
              mime: isFolder ? "" : getMime(name),
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
          // File.read 对二进制文件(office/pdf �?只返回空 content(服务于文本预�?�?File.read);
          // 下载需原始字节:type==="binary" 回退 fs.readFile + base64,前端�?encoding:"base64" 解码落盘�?
          // �?type 而非 !content 判断:合法的空文本文件 content 也是 "",不应误判走二进制回退�?
          if (result.type === "binary") {
            const fs = yield* AppFileSystem.Service
            const bytes = yield* fs.readFile(filePath)
            return { content: Buffer.from(bytes).toString("base64"), mimeType: result.mimeType ?? getMime(filePath), encoding: "base64" as const }
          }
          return { content: result.content, mimeType: result.mimeType ?? getMime(filePath), encoding: result.encoding }
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
            if (files.length === 0) return new Uint8Array()
            const fileEntries = yield* expandPathsToZipEntries(files)
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
    )
    .post(
      "/upload",
      describeRoute({
        summary: "Upload artifact",
        description: "Upload a file to the artifact directory. Auto-renames if file exists.",
        operationId: "artifact.upload",
        responses: {
          200: {
            description: "Uploaded file info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    path: z.string(),
                    relativePath: z.string(),
                    sessionId: z.string(),
                    kind: z.string(),
                    isFolder: z.boolean(),
                    size: z.number(),
                    mtime: z.number(),
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
        z
          .object({
            sessionId: z.string().optional(),
            filename: z.string(),
            content: z.string(),
            scope: z.enum(["project"]).optional(),
            // scope=project 专用:项目相对目标目录,缺省/空 = 项目根
            dir: z.string().optional(),
          })
          .refine((v) => v.scope === "project" || !!v.sessionId, {
            message: "sessionId is required unless scope=project",
          }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.upload", c, function* () {
          const body = c.req.valid("json")
          const fs = yield* AppFileSystem.Service
          const projectScope = body.scope === "project"

          // project scope(代码工作区,统一文件树):dir = 项目相对目标目录,缺省/空 = 项目根,含 .. / ~ 拒绝;
          // session scope:落 .octo/<sessionId>/uploads (原行为)
          let relDir = ""
          if (projectScope && body.dir && body.dir.trim() !== "") {
            relDir = sanitizePath(body.dir)
            if (relDir === "") return c.json({ error: "invalid dir" }, 400)
          }
          const targetDir = projectScope
            ? path.join(Instance.directory, relDir)
            : path.join(Instance.directory, SESSION_BASE_DIR, body.sessionId ?? "", UPLOADS_DIR)

          yield* fs.ensureDir(targetDir).pipe(Effect.catch(() => Effect.void))

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
          yield* fs.writeFile(fullPath, contentBuffer)

          const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
          const sizeNum = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : contentBuffer.length
          const mtimeNum = stat && Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

          return {
            name: finalFilename,
            path: fullPath,
            // project scope 相对项目根;session scope 相对 uploads 根
            relativePath: relDir ? `${relDir}/${finalFilename}` : finalFilename,
            sessionId: projectScope ? "" : body.sessionId ?? "",
            kind: getKind(finalFilename),
            isFolder: false,
            size: sizeNum,
            mtime: mtimeNum,
            mime: getMime(finalFilename),
          }
        }),
    )
    .post(
      "/upload-folder",
      describeRoute({
        summary: "Upload folder",
        description: "Upload a folder with all its contents to the artifact directory. Preserves directory structure.",
        operationId: "artifact.uploadFolder",
        responses: {
          200: {
            description: "Uploaded folder info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    path: z.string(),
                    relativePath: z.string(),
                    sessionId: z.string(),
                    kind: z.string(),
                    isFolder: z.boolean(),
                    fileCount: z.number(),
                    mtime: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z
          .object({
            sessionId: z.string().optional(),
            folderName: z.string(),
            files: z.array(
              z.object({
                relativePath: z.string(),
                content: z.string(),
              }),
            ),
            scope: z.enum(["project"]).optional(),
            // scope=project 专用:项目相对目标目录,缺省/空 = 项目根
            dir: z.string().optional(),
          })
          .refine((v) => v.scope === "project" || !!v.sessionId, {
            message: "sessionId is required unless scope=project",
          }),
      ),
      async (c) =>
        jsonRequest("ArtifactRoutes.uploadFolder", c, function* () {
          const body = c.req.valid("json")
          const fs = yield* AppFileSystem.Service
          const projectScope = body.scope === "project"

          // 与 upload 同语义:project scope 用 dir (项目相对目标目录,缺省/空 = 项目根,含 .. / ~ 拒绝)
          let relDir = ""
          if (projectScope && body.dir && body.dir.trim() !== "") {
            relDir = sanitizePath(body.dir)
            if (relDir === "") return c.json({ error: "invalid dir" }, 400)
          }
          const targetDir = projectScope
            ? path.join(Instance.directory, relDir)
            : path.join(Instance.directory, SESSION_BASE_DIR, body.sessionId ?? "", UPLOADS_DIR)

          const folderDir = path.join(targetDir, body.folderName)

          yield* fs.ensureDir(folderDir).pipe(Effect.catch(() => Effect.void))

          for (const file of body.files) {
            const filePath = path.join(folderDir, file.relativePath)
            const parentDir = path.dirname(filePath)

            yield* fs.ensureDir(parentDir).pipe(Effect.catch(() => Effect.void))
            const contentBuffer = Buffer.from(file.content, "base64")
            yield* fs.writeFile(filePath, contentBuffer)
          }

          const stat = yield* fs.stat(folderDir).pipe(Effect.catch(() => Effect.succeed(null)))
          const mtimeNum = stat && Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now()

          return {
            name: body.folderName,
            path: folderDir,
            // project scope 相对项目根;session scope 相对 uploads 根
            relativePath: relDir ? `${relDir}/${body.folderName}` : body.folderName,
            sessionId: projectScope ? "" : body.sessionId ?? "",
            kind: "folder",
            isFolder: true,
            fileCount: body.files.length,
            mtime: mtimeNum,
          }
        }),
    ),
)
