import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"

const ShareInfo = Schema.Struct({
  success: Schema.Boolean,
  errorMessage: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.NullOr(Schema.Struct({
    versionInfo: Schema.Array(Schema.Struct({ fileName: Schema.String, filePath: Schema.String })),
  })),
})
const ImportResult = Schema.Struct({ sessionID: Schema.String })
const ImportedSession = Schema.Struct({ agent: Schema.optional(Schema.String) })

export function parseSharedSessionLink(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  if (!["octo-agent:", "octo-agent-beta:", "opencode:"].includes(url.protocol) || url.hostname !== "share") return
  const uniqueId = url.searchParams.get("uniqueId")
  return uniqueId && /^[a-zA-Z0-9_-]{1,128}$/.test(uniqueId) ? uniqueId : undefined
}

export async function importSharedSession(input: {
  uniqueId: string
  directory: string
  scope?: "project"
  uploadURL: string
  server: { url: string; username: string | null; password: string | null }
  remoteFetch: typeof fetch
}) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.uniqueId)) throw new Error("分享码格式错误")
  if (!URL.canParse(input.uploadURL)) throw new Error("请配置有效的 OCTO_SHARE_API_URL")
  const infoURL = new URL(input.uploadURL)
  if (!["http:", "https:"].includes(infoURL.protocol)) throw new Error("OCTO_SHARE_API_URL 必须是 HTTP(S) 地址")
  infoURL.pathname = infoURL.pathname.replace(/\/[^/]*$/, "/getShareSessionInfo")
  infoURL.search = ""
  infoURL.searchParams.set("uniqueId", input.uniqueId)
  const response = await input.remoteFetch(infoURL, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`获取分享信息失败：${response.status}`)
  const info = Schema.decodeUnknownSync(ShareInfo)(await response.json())
  if (!info.success || !info.content?.versionInfo.length) throw new Error(info.errorMessage || "分享不存在或已失效")
  const version = info.content.versionInfo[0]
  if (!/^\/designAgentPreview\/[a-zA-Z0-9/_-]+$/.test(version.filePath) || !version.fileName.toLowerCase().endsWith(".zip")) {
    throw new Error("分享文件路径或格式错误")
  }
  const downloadURL = new URL(`/tool${version.filePath}/${encodeURIComponent(version.fileName)}`, infoURL)
  const download = await input.remoteFetch(downloadURL, { signal: AbortSignal.timeout(120_000) })
  if (!download.ok) throw new Error(`下载分享文件失败：${download.status}`)
  const temporary = await mkdtemp(join(tmpdir(), "octo-shared-session-"))
  try {
    const archive = join(temporary, "session.zip")
    await writeFile(archive, new Uint8Array(await download.arrayBuffer()))
    const headers = {
      "Content-Type": "application/json",
      "x-opencode-directory": encodeURIComponent(input.directory),
      ...(input.server.password ? {
        Authorization: `Basic ${Buffer.from(`${input.server.username ?? "opencode"}:${input.server.password}`).toString("base64")}`,
      } : {}),
    }
    const imported = await fetch(new URL("/session/import", input.server.url), {
      method: "POST", headers, body: JSON.stringify({ path: archive, scope: input.scope }),
    })
    if (!imported.ok) throw new Error(`导入分享对话失败：${imported.status}`)
    const result = Schema.decodeUnknownSync(ImportResult)(await imported.json())
    const session = await fetch(new URL(`/session/${encodeURIComponent(result.sessionID)}`, input.server.url), { headers })
    if (!session.ok) throw new Error(`读取导入对话失败：${session.status}`)
    return { ...result, directory: input.directory, ...Schema.decodeUnknownSync(ImportedSession)(await session.json()) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
