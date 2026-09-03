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
  "i",
)

/**
 * 从用户正文提取 Windows 绝对文档 / 文本路径。
 *
 * 正文路径不是 ProseMirror 的附件 / @文件节点，原发送链路不会把它们交给分治判定。本函数只做
 * 语法提取；调用方还必须用主进程 stat/fileExists 校验，避免把代码片段或不存在的示例路径计成材料。
 */
export function extractPromptLocalDocuments(text: string): Array<{ filename: string; path: string }> {
  // 盘符前不能紧挨字母/数字，避免把 URL 协议末尾误认成 Windows 盘符。
  const starts = Array.from(
    text.matchAll(/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\[^\\/\r\n]+[\\/])/g),
    (match) => match.index,
  )
  const seen = new Set<string>()

  return starts.flatMap((start, index) => {
    const nextStart = starts[index + 1] ?? text.length
    const newline = text.slice(start, nextStart).search(/[\r\n]/)
    const segment = text.slice(start, newline < 0 ? nextStart : start + newline)
    const end = DOCUMENT_END.exec(segment)
    if (!end?.index && end?.index !== 0) return []

    const path = segment.slice(0, end.index + end[0].length)
    const key = path.replace(/\//g, "\\").toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [{ filename: path.split(/[\\/]/).pop()!, path }]
  })
}

/** 只保留当前仍存在的普通文件；stat 可用时顺便带回字节数，供 doc-size 兜底判定。 */
export async function resolvePromptLocalDocuments(text: string, probe?: FileProbe): Promise<PromptLocalDocument[]> {
  if (!probe?.statFile && !probe?.fileExists) return []

  return (
    await Promise.all(
      extractPromptLocalDocuments(text).map(async (file) => {
        if (probe.statFile) {
          const stat = await probe.statFile(file.path).catch(() => null)
          return stat ? { ...file, bytes: stat.size } : undefined
        }
        return (await probe.fileExists!(file.path).catch(() => false)) ? file : undefined
      }),
    )
  ).filter((file): file is PromptLocalDocument => !!file)
}

/** 给模型一份无引号/中文括号干扰的确定路径清单；该块只供模型读取，不渲染成上传附件卡。 */
export function formatPromptLocalDocuments(files: PromptLocalDocument[]): string {
  if (files.length === 0) return ""
  return `[本地文件路径] 用户在消息正文中指定了以下已存在的本地文件：\n${files
    .map((file) => `- ${file.filename}: ${file.path}`)
    .join("\n")}`
}
