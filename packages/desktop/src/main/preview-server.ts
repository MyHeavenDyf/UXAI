import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import http from "node:http"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { app } from "electron"

const root = dirname(fileURLToPath(import.meta.url))
const PREVIEW_PORT = 51856
/** 3D 场景独立预览页端口(与 pattern 的 51856 隔离,各自独立 SPA fallback) */
const PREVIEW_3D_PORT = 51857

export function previewDistDir() {
  return app.isPackaged ? join(process.resourcesPath, "previewdist") : join(root, "../../../previewdist")
}

export function previewDist3dDir() {
  return app.isPackaged ? join(process.resourcesPath, "preview3d") : join(root, "../../../preview3d")
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
}

/** 在 127.0.0.1 上静态托管一个目录:CORS + SPA fallback(index.html)+ 路径越权防护。 */
function createStaticServer(dir: string, port: number) {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Headers", "*")

    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
    const candidate = join(dir, pathname === "/" ? "index.html" : pathname)

    if (relative(dir, candidate).startsWith("..")) {
      res.writeHead(403)
      res.end("Forbidden")
      return
    }

    const found = await stat(candidate).then(() => true).catch(() => false)
    const file = found ? candidate : join(dir, "index.html")
    const exists = found || (await stat(file).then(() => true).catch(() => false))
    if (!exists) {
      res.writeHead(404)
      res.end("Not found")
      return
    }

    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" })
    createReadStream(file).pipe(res)
  })

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[preview-server] port ${port} already in use, skipping (external server may be running)`)
      return
    }
    console.error(`[preview-server] port ${port} failed to start:`, err)
  })

  server.listen(port, "127.0.0.1")
  return server
}

export function startPreviewServer() {
  createStaticServer(previewDistDir(), PREVIEW_PORT)
  createStaticServer(previewDist3dDir(), PREVIEW_3D_PORT)
}
