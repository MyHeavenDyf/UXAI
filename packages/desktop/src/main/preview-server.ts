import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import http from "node:http"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { app } from "electron"

const root = dirname(fileURLToPath(import.meta.url))
const PREVIEW_PORT = 51856

export function previewDistDir() {
  return app.isPackaged ? join(process.resourcesPath, "previewdist") : join(root, "../../../previewdist")
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

export function startPreviewServer() {
  const dir = previewDistDir()

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
      console.warn(`[preview-server] port ${PREVIEW_PORT} already in use, skipping (external server may be running)`)
      return
    }
    console.error("[preview-server] failed to start:", err)
  })

  server.listen(PREVIEW_PORT, "127.0.0.1")
  return server
}
