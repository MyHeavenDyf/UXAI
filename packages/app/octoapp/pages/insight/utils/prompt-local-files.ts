import { EXTRACT_DOC_EXTENSIONS } from "../lib/upload"

export type PromptLocalDocument = {
  filename: string
  path: string
  bytes?: number
}

type FileProbe = {
  statFile?: (path: string) => Promise<{ size: number } | null>
  fileExists?: (path: string) => Promise<boolean>
}

const DOCUMENT_END = new RegExp(
  `\\.(?:${[...EXTRACT_DOC_EXTENSIONS, "txt", "md"].sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z0-9])`,
  "gi",
)

function pathKey(path: string) {
  return path.replace(/\//g, "\\").toLowerCase()
}

function extractPromptLocalDocumentCandidates(text: string): Array<Array<{ filename: string; path: string }>> {
  // 同一个盘符开头后可能有多个扩展名片段，例如目录名 `research.md` 或文件名
  // `survey.md.backup.docx`。保留所有前缀并按最长优先，resolve 阶段再以 stat 选出
  // 第一个真实文件，避免在首个 `.md` 处截断，也避免把路径后的 `输出为 report.md` 吞进去。
  const starts = Array.from(
    text.matchAll(/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\[^\\/\r\n]+[\\/])/g),
    (match) => match.index,
  )

  return starts.flatMap((start, index) => {
    const nextStart = starts[index + 1] ?? text.length
    const rawSegment = text.slice(start, nextStart)
    const boundary = rawSegment.search(/[\r\n]|\bhttps?:\/\//i)
    const segment = rawSegment.slice(0, boundary < 0 ? rawSegment.length : boundary)
    const candidates = Array.from(segment.matchAll(DOCUMENT_END), (match) => {
      const path = segment.slice(0, match.index + match[0].length)
      return { filename: path.split(/[\\/]/).pop()!, path }
    }).reverse()
    return candidates.length > 0 ? [candidates] : []
  })
}

/**
 * 从用户正文提取 Windows 绝对文档 / 文本路径。
 *
 * 正文路径不是 ProseMirror 的附件 / @文件节点，原发送链路不会把它们交给分治判定。本函数只做
 * 语法提取；调用方还必须用主进程 stat/fileExists 校验，避免把代码片段或不存在的示例路径计成材料。
 */
export function extractPromptLocalDocuments(text: string): Array<{ filename: string; path: string }> {
  const seen = new Set<string>()
  return extractPromptLocalDocumentCandidates(text).flatMap((candidates) => {
    const file = candidates[0]!
    const key = pathKey(file.path)
    if (seen.has(key)) return []
    seen.add(key)
    return [file]
  })
}

/** 只保留当前仍存在的普通文件；stat 可用时顺便带回字节数，供 doc-size 兜底判定。 */
export async function resolvePromptLocalDocuments(text: string, probe?: FileProbe): Promise<PromptLocalDocument[]> {
  if (!probe?.statFile && !probe?.fileExists) return []

  const resolved = (
    await Promise.all(
      extractPromptLocalDocumentCandidates(text).map(async (candidates) => {
        if (probe.statFile) {
          return (
            await Promise.all(
              candidates.map(async (file) => {
                const stat = await probe.statFile!(file.path).catch(() => null)
                return stat ? { ...file, bytes: stat.size } : undefined
              }),
            )
          ).find((file) => !!file)
        }
        return (
          await Promise.all(
            candidates.map(async (file) =>
              (await probe.fileExists!(file.path).catch(() => false)) ? file : undefined,
            ),
          )
        ).find((file) => !!file)
      }),
    )
  ).filter((file): file is PromptLocalDocument => !!file)
  return resolved.filter(
    (file, index, all) => all.findIndex((other) => pathKey(other.path) === pathKey(file.path)) === index,
  )
}

/** 给模型一份无引号/中文括号干扰的确定路径清单；该块只供模型读取，不渲染成上传附件卡。 */
export function formatPromptLocalDocuments(files: PromptLocalDocument[]): string {
  if (files.length === 0) return ""
  return `[本地文件路径] 用户在消息正文中指定了以下已存在的本地文件：\n${files
    .map((file) => `- ${file.filename}: ${file.path}`)
    .join("\n")}`
}
