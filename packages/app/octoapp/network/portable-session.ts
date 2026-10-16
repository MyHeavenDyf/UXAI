import { directoryHeader } from "@/utils/headers"

// 从本机 opencode 服务端拉取会话的可移植 ZIP 包(manifest.json + blobs/*),
// 供分享上传使用。服务端路由见 packages/opencode/src/server/routes/instance/session.ts
// (GET /session/:sessionID/portable → application/zip)。
export async function downloadPortableSession(url: string, directory: string, sessionID: string): Promise<Blob> {
  const response = await fetch(`${url}/session/${sessionID}/portable`, {
    headers: directoryHeader(directory),
  })
  if (!response.ok) throw new Error(`导出会话失败: ${response.status} ${response.statusText}`)
  return response.blob()
}
