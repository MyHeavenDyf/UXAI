import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { getDesktopApi } from "@/pages/make/lib/electron-api"

// 复用服务端现有的 portableExport,把会话可移植 ZIP 写到临时文件,再由桌面端读回字节。
// 不经过浏览器 HTTP 下载,避免跨域/鉴权等链路上产生非 zip 字节。
export async function exportPortableSessionBlob(
  client: OpencodeClient,
  directory: string,
  sessionID: string,
): Promise<Blob> {
  const api = getDesktopApi()
  if (!api?.readFileBuffer) throw new Error("当前环境不支持导出会话")

  const root = directory.replace(/[/\\]+$/, "")
  const tempPath = `${root}/.octo/tmps/share-${sessionID}-${Date.now()}.zip`
  await client.session.portableExport({ sessionID, path: tempPath })
  try {
    const buffer = await api.readFileBuffer(tempPath)
    if (!buffer) throw new Error("导出会话失败: 未找到临时文件")
    return new Blob([buffer], { type: "application/zip" })
  } finally {
    await api.deleteFile?.(tempPath).catch(() => {})
  }
}
