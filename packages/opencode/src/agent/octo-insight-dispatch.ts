import type { Plugin } from "@opencode-ai/plugin"
import { stat } from "node:fs/promises"
import { PartID } from "@/session/schema"

// Insight 多文档分治的服务端第二道守卫。前端在发送前已做同样的确定性判定；
// 这里用 chat.message 覆盖队列外的客户端、API 直调和未来新入口。只注入模型可见的
// [材料体量]，不在钩子里直接启动 task：子代理仍必须经过模型的 task 工具调用，
// 才能保留父子会话、任务卡和串行闸的既有契约。

const INSIGHT_AGENT = "octo_insight"
const DISPATCH_NOTE_HEADER = "[材料体量]"
const LOCAL_FILE_HEADER = "[本地文件路径]"
const MANIFEST_HEADERS = ["[附件]", "[引用文件]"] as const
const INLINE_BUDGET = 32 * 1024
const SINGLE_DOC_LIMIT = 150 * 1024
const DOC_COUNT_THRESHOLD = 3
const DOC_SINGLE_BYTES = 2 * 1024 * 1024

// 必须与 extract_document.SUPPORTED 对齐。txt/md 是文本体量口径，不是文档份数口径。
const EXTRACT_DOC_EXT = new Set(["docx", "xlsx", "pptx", "pdf"])
const DIRECT_PATH_EXTENSIONS = [...EXTRACT_DOC_EXT, "txt", "md"].sort((a, b) => b.length - a.length)
const DIRECT_PATH_END = new RegExp(`\\.(?:${DIRECT_PATH_EXTENSIONS.join("|")})(?![A-Za-z0-9])`, "gi")
const NON_INLINE_EXT = new Set([
  ...EXTRACT_DOC_EXT,
  // 旧版 Office 是二进制，不能当 text/plain；但 extract_document 也不支持，不计入可派发文档。
  "doc",
  "xls",
  "ppt",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
])

type Candidate = { filename: string; path: string }
type SizedCandidate = Candidate & { bytes: number }
type DispatchPart = {
  type: string
  text?: string
  synthetic?: boolean
  url?: string
  filename?: string
  mime?: string
}

export type InsightDispatchDecision = {
  mode: "inline" | "dispatch"
  files: SizedCandidate[]
  docs: SizedCandidate[]
  oversized: SizedCandidate[]
  reasons: Array<"text-budget" | "doc-count" | "doc-size">
  totalBytes: number
  directFiles: Candidate[]
}

function ext(filename: string) {
  return filename.split(/[?#]/, 1)[0]!.split(".").pop()?.toLowerCase() ?? ""
}

function pathKey(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") ? path.replace(/\//g, "\\").toLowerCase() : path
}

function parseManifest(text: string): Candidate[] {
  return text.split("\n").flatMap((line) => {
    const body = line.trim().startsWith("- ") ? line.trim().slice(2) : ""
    const sep = body.indexOf(": ")
    if (sep < 0) return []
    const filename = body.slice(0, sep).trim()
    const path = body.slice(sep + 2).trim()
    return filename && path ? [{ filename, path }] : []
  })
}

function localFilePart(part: DispatchPart): Candidate[] {
  if (part.type !== "file" || !part.url?.startsWith("file://")) return []
  const decoded = (() => {
    try {
      return decodeURIComponent(part.url!.slice("file://".length))
    } catch {
      return ""
    }
  })()
  const path = /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded
  return path ? [{ filename: part.filename || path.split(/[\\/]/).pop()!, path }] : []
}

function promptLocalFileCandidates(text: string): Candidate[][] {
  const starts = Array.from(
    text.matchAll(/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\[^\\/\r\n]+[\\/])/g),
    (match) => match.index,
  )

  return starts.flatMap((start, index) => {
    const nextStart = starts[index + 1] ?? text.length
    const rawSegment = text.slice(start, nextStart)
    const boundary = rawSegment.search(/[\r\n]|\bhttps?:\/\//i)
    const segment = rawSegment.slice(0, boundary < 0 ? rawSegment.length : boundary)
    const candidates = Array.from(segment.matchAll(DIRECT_PATH_END), (match) => {
      const path = segment.slice(0, match.index + match[0].length)
      return { filename: path.split(/[\\/]/).pop()!, path }
    }).reverse()
    return candidates.length > 0 ? [candidates] : []
  })
}

/** 只解析用户原文里的 Windows 绝对路径；存在多个扩展名片段时返回最长候选。 */
export function extractInsightPromptLocalFiles(text: string): Candidate[] {
  return promptLocalFileCandidates(text)
    .map((candidates) => candidates[0]!)
    .filter((file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index)
}

export async function decideInsightDispatch(
  parts: readonly DispatchPart[],
  probe: (path: string) => Promise<{ size: number; isFile: boolean } | undefined> = async (path) =>
    stat(path)
      .then((value) => ({ size: value.size, isFile: value.isFile() }))
      .catch(() => undefined),
): Promise<InsightDispatchDecision> {
  const manifestFiles = parts.flatMap((part) => {
    if (part.type !== "text" || typeof part.text !== "string") return []
    if (!MANIFEST_HEADERS.some((header) => part.text!.startsWith(header))) return []
    return parseManifest(part.text)
  })
  const directGroups = parts.flatMap((part) => {
    if (part.type !== "text" || part.synthetic || typeof part.text !== "string") return []
    return promptLocalFileCandidates(part.text)
  })
  // chat.message 位于 file:// 解析之后；上游会保留原 FilePart，因此 API/其他本地客户端
  // 即使没有 [附件] 清单，服务端也能从 file:// 找回真实路径并补做体量判定。
  const localPartFiles = parts.flatMap(localFilePart)
  const candidates = [...manifestFiles, ...directGroups.flat(), ...localPartFiles].filter(
    (file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index,
  )
  const probed = new Map(
    await Promise.all(
      candidates.map(async (file) => {
        const found = await probe(file.path)
        return [pathKey(file.path), found?.isFile ? { ...file, bytes: found.size } : undefined] as const
      }),
    ),
  )
  const directFiles = directGroups
    .flatMap((candidates) => candidates.find((file) => !!probed.get(pathKey(file.path))) ?? [])
    .filter((file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index)
  const sized = [...manifestFiles, ...directFiles, ...localPartFiles]
    .flatMap((file) => probed.get(pathKey(file.path)) ?? [])
    .filter((file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index)
  const docs = sized.filter((file) => EXTRACT_DOC_EXT.has(ext(file.filename)))
  const files = sized.filter((file) => !NON_INLINE_EXT.has(ext(file.filename)))
  const oversized = files.filter((file) => file.bytes > SINGLE_DOC_LIMIT)
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const reasons: InsightDispatchDecision["reasons"] = []
  if (totalBytes > INLINE_BUDGET) reasons.push("text-budget")
  if (docs.length >= DOC_COUNT_THRESHOLD) reasons.push("doc-count")
  if (docs.some((file) => file.bytes > DOC_SINGLE_BYTES)) reasons.push("doc-size")

  return {
    mode: reasons.length > 0 ? "dispatch" : "inline",
    files,
    docs,
    oversized,
    reasons,
    totalBytes,
    directFiles: [...directFiles, ...localPartFiles]
      .filter((file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index)
      .filter((file) => probed.get(pathKey(file.path))),
  }
}

/** resolvePart 前置判定：命中分治时跳过本地 text/plain FilePart 的正文展开。 */
export async function shouldDeferInsightLocalTextReads(parts: readonly DispatchPart[]) {
  if (!parts.some((part) => part.type === "file" && part.mime === "text/plain" && part.url?.startsWith("file:"))) {
    return false
  }
  return (await decideInsightDispatch(parts)).mode === "dispatch"
}

function formatDispatchNote(decision: InsightDispatchDecision) {
  const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`
  const summary = [
    decision.files.length > 0 ? `${decision.files.length} 份文本材料（合计约 ${kb(decision.totalBytes)}）` : "",
    decision.docs.length > 0 ? `${decision.docs.length} 份文档（docx / pdf / xlsx / pptx）` : "",
  ].filter(Boolean)
  const paragraphs = [
    `${DISPATCH_NOTE_HEADER} 服务端确认本轮共有 ${summary.join("、")}（已按本地路径去重）。` +
      `不要把当前上下文中可能已有的开头预览或截断片段当成完整正文；完整材料以下方本地路径为准。`,
    `请**逐份**派 insight_reader 子代理通读：每份材料单独发一个 task，把该文件的绝对路径和这次要提炼什么写进去，` +
      `**一份回来了再派下一份**，收齐所有结论后再写报告。不要试图自己一次性读完这些材料——那正是会撞上下文上限的做法。`,
  ]
  if (decision.oversized.length > 0) {
    paragraphs.push(
      `其中 ${decision.oversized.map((file) => `「${file.filename}」(${kb(file.bytes)})`).join("、")} 单份就超出了子代理一次能通读的量。` +
        `**照样派子代理**——子代理调 extract_document 时会拿到一份切段清单，按段分几次派完即可，每段一个 task。`,
    )
  }
  return paragraphs.join("\n")
}

function syntheticPart(output: Parameters<NonNullable<Awaited<ReturnType<Plugin>>["chat.message"]>>[1], text: string) {
  return {
    id: PartID.ascending(),
    messageID: output.message.id,
    sessionID: output.message.sessionID,
    type: "text" as const,
    text,
    synthetic: true,
  }
}

export const OctoInsightDispatchPlugin: Plugin = async () => ({
  "chat.message": async (input, output) => {
    if ((input.agent ?? output.message.agent) !== INSIGHT_AGENT) return
    // MCP chip turn 明确关闭 task；此时应直调选中的业务工具，不注入与工具面冲突的分治指令。
    if (output.message.tools?.task === false) return
    // 前端第一层已经命中时保持幂等，不再 stat，也不追加第二份说明。
    if (
      output.parts.some((part) => part.type === "text" && part.synthetic && part.text.startsWith(DISPATCH_NOTE_HEADER))
    )
      return

    const decision = await decideInsightDispatch(output.parts)
    if (decision.mode !== "dispatch") return
    if (decision.directFiles.length > 0) {
      output.parts.push(
        syntheticPart(
          output,
          `${LOCAL_FILE_HEADER} 用户在消息正文中指定了以下已存在的本地文件：\n${decision.directFiles
            .map((file) => `- ${file.filename}: ${file.path}`)
            .join("\n")}`,
        ),
      )
    }
    output.parts.push(syntheticPart(output, formatDispatchNote(decision)))
    console.log("[octo:attach] server dispatch guard injected", {
      sessionID: input.sessionID,
      reasons: decision.reasons,
      textCount: decision.files.length,
      docCount: decision.docs.length,
      totalBytes: decision.totalBytes,
    })
  },
})
