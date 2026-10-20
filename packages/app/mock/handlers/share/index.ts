import type { IncomingMessage, ServerResponse } from "node:http"
import { MOCK_MANIFEST, MOCK_FILE_PATH, MOCK_BLOBS } from "./data.js"

// 分享对话查看页 mock:拦截 getShareSessionInfo、manifest.json、blob 文件
// 让 localhost 下的 /design/agent/share/*.html 能加载真实 session 数据做样式联调
const mockEnabled = () => process.env.MOCK_API !== "false"

function setCors(res: ServerResponse, contentType = "application/json") {
  res.setHeader("Content-Type", contentType)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, uiplustoken")
}

// getShareSessionInfo → 返回 filePath,分享页据此拼 /tool{filePath}/manifest.json
export const infoHandler = {
  prefix: "/main/rest.root/octoAgentServer/agentSession",
  handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (!mockEnabled()) return next()
    if (req.method === "OPTIONS") {
      setCors(res)
      res.statusCode = 204
      res.end()
      return
    }
    if ((req.url ?? "").startsWith(`${infoHandler.prefix}/getShareSessionInfo`)) {
      setCors(res)
      res.end(
        JSON.stringify({
          success: true,
          content: { versionInfo: [{ filePath: MOCK_FILE_PATH }] },
        }),
      )
      return
    }
    next()
  },
}

// manifest.json + blob 文件(/tool/designAgentPreview/{filePath}/manifest.json 和 /tool/.../blobs/<sha256>)
export const manifestHandler = {
  prefix: "/tool/designAgentPreview",
  handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (!mockEnabled()) return next()
    if (req.method === "OPTIONS") {
      setCors(res)
      res.statusCode = 204
      res.end()
      return
    }
    const url = req.url ?? ""
    // manifest.json
    if (url.startsWith(manifestHandler.prefix) && url.endsWith("/manifest.json")) {
      setCors(res)
      res.end(JSON.stringify(MOCK_MANIFEST))
      return
    }
    // blob 文件:/tool/designAgentPreview/.../blobs/<sha256>
    const blobMatch = url.match(/\/blobs\/([a-f0-9]+)$/)
    if (blobMatch) {
      const sha = blobMatch[1]
      const buf = MOCK_BLOBS[sha]
      if (buf) {
        // SVG → image/svg+xml;空文件 → text/plain;其余 → application/octet-stream
        const ct = sha === "5f2205307dda0be5d3d54a5637d325360d94e27b36d6f5c05c38fe4159cfbc50"
          ? "image/svg+xml"
          : "application/octet-stream"
        setCors(res, ct)
        res.end(buf)
        return
      }
    }
    next()
  },
}
