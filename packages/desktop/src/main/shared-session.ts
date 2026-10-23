import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { open as openZip } from "yauzl"

const ShareInfo = Schema.Struct({
  success: Schema.Boolean,
  errorMessage: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.NullOr(
    Schema.Struct({
      versionInfo: Schema.Array(Schema.Struct({ fileName: Schema.String, filePath: Schema.String })),
    }),
  ),
})
const ImportResult = Schema.Struct({ sessionID: Schema.String })
const ImportedSession = Schema.Struct({ agent: Schema.optional(Schema.String) })
const ShareManifest = Schema.Struct({
  format: Schema.Literal("octo-session"),
  version: Schema.Literal(1),
  rootSessionID: Schema.String,
  sessions: Schema.Array(
    Schema.Struct({ info: Schema.Struct({ id: Schema.String, agent: Schema.optional(Schema.String) }) }),
  ),
})

export async function inspectSharedSession(archive: string) {
  const manifest = await new Promise<unknown>((resolve, reject) => {
    openZip(archive, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法读取分享 ZIP"))
      const entries: Buffer[] = []
      const found = { manifest: false }
      const fail = (error: Error) => {
        zip.close()
        reject(error)
      }
      zip.on("error", fail)
      zip.on("entry", (entry) => {
        if (entry.fileName !== "manifest.json") return zip.readEntry()
        if (found.manifest) return fail(new Error("分享 ZIP 包含重复的 manifest.json"))
        found.manifest = true
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error ?? new Error("无法读取分享清单"))
          stream.on("error", fail)
          stream.on("data", (chunk: Buffer) => entries.push(chunk))
          stream.on("end", () => zip.readEntry())
        })
      })
      zip.on("end", () => {
        if (!found.manifest) return reject(new Error("分享 ZIP 缺少 manifest.json"))
        Promise.resolve()
          .then(() => JSON.parse(Buffer.concat(entries).toString("utf8")))
          .then(resolve, reject)
      })
      zip.readEntry()
    })
  })
  const info = Schema.decodeUnknownSync(ShareManifest)(manifest)
  const roots = info.sessions.filter((entry) => entry.info.id === info.rootSessionID)
  if (roots.length !== 1) throw new Error("分享清单的根 Session 无效")
  const agent = roots[0].info.agent
  const module =
    agent === "octo_make"
      ? "design"
      : agent === "octo_insight"
        ? "insight"
        : agent === "proto_triage"
          ? "pattern"
          : undefined
  if (!module) throw new Error(`无法识别分享所属模块：${agent ?? "未提供 Agent"}`)
  return { agent, module }
}

export function parseSharedSessionLink(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  if (!["octo-agent:", "octo-agent-beta:", "opencode:"].includes(url.protocol) || url.hostname !== "share") return
  const uniqueId = url.searchParams.get("uniqueId")
  return uniqueId && /^[a-zA-Z0-9_-]{1,128}$/.test(uniqueId) ? uniqueId : undefined
}

export async function prepareSharedSession(input: { uniqueId: string; uploadURL: string; remoteFetch: typeof fetch }) {
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
  if (
    !/^\/designAgentPreview\/[a-zA-Z0-9/_-]+$/.test(version.filePath) ||
    !version.fileName.toLowerCase().endsWith(".zip")
  ) {
    throw new Error("分享文件路径或格式错误")
  }
  const downloadURL = new URL(`/tool${version.filePath}/${encodeURIComponent(version.fileName)}`, infoURL)
  const download = await input.remoteFetch(downloadURL, { signal: AbortSignal.timeout(120_000) })
  if (!download.ok) throw new Error(`下载分享文件失败：${download.status}`)
  const temporary = await mkdtemp(join(tmpdir(), "octo-shared-session-"))
  try {
    const archive = join(temporary, "session.zip")
    await writeFile(archive, new Uint8Array(await download.arrayBuffer()))
    return { archive, temporary, ...(await inspectSharedSession(archive)) }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

export async function importSharedSession(input: {
  uniqueId: string
  directory: string
  scope?: "project" | "session"
  uploadURL: string
  server: { url: string; username: string | null; password: string | null }
  remoteFetch: typeof fetch
  prepared?: Awaited<ReturnType<typeof prepareSharedSession>>
}) {
  const prepared = input.prepared ?? (await prepareSharedSession(input))
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-opencode-directory": encodeURIComponent(input.directory),
      ...(input.server.password
        ? {
            Authorization: `Basic ${Buffer.from(`${input.server.username ?? "opencode"}:${input.server.password}`).toString("base64")}`,
          }
        : {}),
    }
    const imported = await fetch(new URL("/session/import", input.server.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ path: prepared.archive, scope: input.scope }),
    })
    if (!imported.ok) throw new Error(`导入分享对话失败：${imported.status}`)
    const result = Schema.decodeUnknownSync(ImportResult)(await imported.json())
    const session = await fetch(new URL(`/session/${encodeURIComponent(result.sessionID)}`, input.server.url), {
      headers,
    })
    if (!session.ok) throw new Error(`读取导入对话失败：${session.status}`)
    return { ...result, directory: input.directory, ...Schema.decodeUnknownSync(ImportedSession)(await session.json()) }
  } finally {
    await rm(prepared.temporary, { recursive: true, force: true })
  }
}
