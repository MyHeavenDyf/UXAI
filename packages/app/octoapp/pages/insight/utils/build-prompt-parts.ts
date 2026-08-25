import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk/v2/client"
import { encodeFilePath } from "../../../context/file/path"
import { isTextInlineFile } from "../lib/upload"

/**
 * insight prompt parts 组装骨架（SPEC-INS-027）
 *
 * 把「文本 → synthetic 文本块 → txt/md FilePart → 图片 vision FilePart」这段**顺序 + FilePart 映射**
 * 抽成页面无关的纯函数，由正常发送（doSendPrompt）与排队 drain（sendQueuedItem）共用，避免两套漂移。
 *
 * 只负责**组装**：synthetic 文本串（[附件]清单 / chip 模板声明 / @技能 / @文件引用）由调用方各自算好按序传入
 * （技能内容读取的错误处理正常/后台不同，故留在调用方）；本函数只把它们按既定顺序拼成 parts。
 *
 * 顺序契约（与既有 doSendPrompt 一致，勿改）：
 *   cleanText → syntheticTexts（按传入顺序，均 synthetic）→ txt/md FilePart → 图片 FilePart
 * 注意 [附件] 清单必须排在 chip 模板之前（InsightTurn 按 "[附件]" 头定位渲染文件卡片），
 * 这个「谁在前」由调用方组 syntheticTexts 时保证。
 */
export interface AssembleInsightPartsInput {
  text: string
  /** 有序 synthetic 文本块（[附件]清单 / chipTemplate / chipDeclaration / <skill_content> / [引用文件]…），均已算好 */
  syntheticTexts?: string[]
  /** 可内联文件（本地 path；附件栏文件 + `@` 引用的会话文件合并后传入）→ FilePart(file://, text/plain)，
   *  opencode 组 prompt 时自动 Read 内联正文。非文本类由 isTextInlineFile 反向排除，重复 path 只取一次 */
  textInlineFiles?: Array<{ filename: string; path: string }>
  /** 图片（S3 url）→ vision FilePart{url}，交多模态模型看 */
  imageFiles?: Array<{ filename: string; mime?: string; url: string }>
}

export interface AssembledInsightParts {
  /** 发送用完整 parts */
  parts: Array<TextPartInput | FilePartInput>
  /** 图片 FilePart（供调用方做 optimistic 镜像，避免重复映射） */
  imageParts: FilePartInput[]
}

export function assembleInsightParts(input: AssembleInsightPartsInput): AssembledInsightParts {
  const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: input.text }]

  for (const t of input.syntheticTexts ?? []) {
    if (t) parts.push({ type: "text", text: t, synthetic: true })
  }

  // ① 可内联文件 → FilePart(file://, text/plain)，服务端组 prompt 时调 `read` 把正文读进上下文。
  // office / pdf / 图片由 isTextInlineFile 反向排除（各自走 extract_document / vision）。
  // 来源含**附件栏文件 + `@` 引用的会话文件**（SPEC-INS-023 §7.2，2026-08-20 起两者一致），
  // 故此处按 path 去重：同一文件既是本轮附件、又被 `@` 引用时只内联一次。
  const seenPaths = new Set<string>()
  for (const f of input.textInlineFiles ?? []) {
    if (!isTextInlineFile(f.filename)) continue
    if (seenPaths.has(f.path)) continue
    seenPaths.add(f.path)
    parts.push({ type: "file", mime: "text/plain", url: `file://${encodeFilePath(f.path)}`, filename: f.filename })
  }

  // ③ 图片 → vision FilePart{url:S3}（非多模态由 opencode stripMedia 换占位）
  const imageParts: FilePartInput[] = (input.imageFiles ?? []).map((a) => ({
    type: "file" as const,
    mime: a.mime || "image/png",
    url: a.url,
    filename: a.filename,
  }))
  parts.push(...imageParts)

  return { parts, imageParts }
}
