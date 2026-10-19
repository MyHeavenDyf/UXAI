import type { Attachment } from "../components/attachment-bar"
import { kindFromMime, mimeFromFilename } from "../components/attachment-bar"
import { parseUploadedFiles } from "../../insight/lib/upload"
import { isElectronDesktop, pathToLocalUrl } from "./artifact-file-api"
import { parseAllArtifactsFromText } from "./artifact-cards"
import { computeArtifactFilePath, SAVEABLE_ARTIFACT_TYPES } from "./artifact-auto-save"
import { lookupDisplayName, type SkillConfig } from "../components/skill-config-types"

export type RevertDraftPart = {
  type: string
  text?: string
  synthetic?: boolean
  metadata?: { displayText?: string }
  mime?: string
  filename?: string
  url?: string
  tool?: string
  name?: string
  state?: { status?: string; name?: string; input?: Record<string, unknown> }
}

export type RevertSkill = { name: string; label: string }

export type RevertDraft = {
  docJSON: any
  attachments: Attachment[]
}

type RevertMention = {
  id: string
  name: string
  type: "skill" | "file" | "folder"
  label: string
  path: string
}

let restoreSeq = 0
const nextAttachmentId = () => `revert-${Date.now()}-${restoreSeq++}`

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function includesSkillInvocation(processed: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)\\/${escapeRegExp(name)}(?:\\s|$)`).test(processed)
}

function toolFilePath(part: RevertDraftPart): string | undefined {
  const input = part.state?.input
  if (!input) return undefined
  const filePath = (input.path ?? input.filepath ?? input.filePath ?? "") as string
  return filePath || undefined
}

/** 从消息 parts 收集 write/edit 工具成功写入的文件路径（与 insight-turn producedFiles 同口径） */
export function collectWriteEditFiles(parts: RevertDraftPart[]): string[] {
  const result: string[] = []
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state?.status !== "completed") continue
    const toolName = (part.tool ?? part.name ?? part.state?.name ?? "").toLowerCase()
    if (!toolName.includes("write") && !toolName.includes("edit")) continue
    const filePath = toolFilePath(part)
    if (filePath && !result.includes(filePath)) result.push(filePath)
  }
  return result
}

/** 收集回退需要清理的文件：write/edit 工具路径 + <artifact> 标签落盘产物（autoSaveArtifact 写到
 *  {projectDir}/.octo/{sessionId}/outputs，路径逻辑与 computeArtifactFilePath 一致）。
 *  Make 主流产出走 artifact 标签而非 write 工具，只认工具会漏掉大部分页面。 */
export function collectRevertedFiles(
  parts: RevertDraftPart[],
  opts: { sessionId: string; projectDir?: string },
): string[] {
  const result = collectWriteEditFiles(parts)
  if (!opts.projectDir) return result

  for (const part of parts) {
    if (part.type !== "text" || !part.text || !part.text.includes("<artifact")) continue
    for (const card of parseAllArtifactsFromText(part.text)) {
      if (!SAVEABLE_ARTIFACT_TYPES.includes(card.type)) continue
      const filePath = computeArtifactFilePath(card.title, card.type, opts.sessionId, opts.projectDir)
      if (!result.includes(filePath)) result.push(filePath)
    }
  }
  return result
}

/** 恢复用户可见文本：优先 metadata.displayText（含 ​@name​ chip 标记），否则取第一个 text part 按 \n---\n 截断（与 insight-turn userText 同口径） */
function extractVisibleText(parts: RevertDraftPart[]): { visible: string; processed: string } {
  const displayPart = parts.find((p) => p.type === "text" && p.metadata?.displayText)
  if (displayPart) {
    return { visible: displayPart.metadata!.displayText!, processed: displayPart.text ?? "" }
  }
  const textPart = parts.find((p) => p.type === "text")
  const raw = textPart?.text ?? ""
  const sepIdx = raw.lastIndexOf("\n---\n")
  return {
    visible: (sepIdx !== -1 ? raw.slice(sepIdx + 5) : raw).trim(),
    processed: raw,
  }
}

function resolveMention(
  name: string,
  fileMatches: Array<{ path: string; type: "file" | "folder" }>,
  usedMatches: Set<number>,
  skills: RevertSkill[],
  processed: string,
): RevertMention | null {
  for (let i = 0; i < fileMatches.length; i++) {
    if (usedMatches.has(i)) continue
    const match = fileMatches[i]
    if (match.path === name || match.path.split(/[/\\]/).pop() === name) {
      usedMatches.add(i)
      return { id: match.path, name, type: match.type, label: name, path: match.path }
    }
  }
  if (includesSkillInvocation(processed, name)) {
    return { id: name, name, type: "skill", label: name, path: "" }
  }
  const skill = skills.find((s) => s.label === name && includesSkillInvocation(processed, s.name))
  if (skill) {
    return { id: skill.name, name: skill.name, type: "skill", label: name, path: "" }
  }
  return null
}

/** 把用户可见文本还原为 ProseMirror doc JSON：@token 尽量还原为 mention chip（attrs 由 processedText 顺序配对重建），配不上的保持纯文本 */
function buildDocJSON(visible: string, processed: string, skills: RevertSkill[]): any {
  // 注意 alternation 必须文件夹在前：非贪婪 .+? + 「文件」会先命中「文件夹」的前两个字
  const fileMatches = [...processed.matchAll(/读取(.+?) 这个(文件夹|文件)/g)].map((m) => ({
    path: m[1],
    type: m[2] === "文件夹" ? ("folder" as const) : ("file" as const),
  }))
  const usedMatches = new Set<number>()

  const paragraphs = visible.split("\n").map((line) => {
    if (!line) return { type: "paragraph" }
    const content: Array<Record<string, unknown>> = []
    const pushText = (text: string) => {
      const last = content[content.length - 1]
      if (last?.type === "text") last.text += text
      else content.push({ type: "text", text })
    }
    for (const seg of line.split(/(@[^​@]+)/g)) {
      if (!seg) continue
      if (seg.startsWith("@") && seg.length > 1) {
        const mention = resolveMention(seg.slice(1), fileMatches, usedMatches, skills, processed)
        if (mention) {
          content.push({ type: "mention", attrs: mention })
          continue
        }
      }
      const text = seg.replace(/​/g, "")
      if (text) pushText(text)
    }
    return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }
  })
  return { type: "doc", content: paragraphs }
}

/** 图片 file part 服务端落库后是 data: URL，原始本地路径存在其前面那段 "Called the Read tool ... {"filePath":"..."}" synthetic part 里 */
function filePathFromReadHint(parts: RevertDraftPart[], index: number): string | undefined {
  for (let j = index - 1; j >= 0 && index - j <= 3; j--) {
    const prev = parts[j]
    if (prev?.type === "file") return undefined
    if (prev?.type !== "text" || !prev.synthetic) continue
    const match = /"filePath":"((?:[^"\\]|\\.)*)"/.exec(prev.text ?? "")
    if (match) return match[1]
  }
  return undefined
}

function imagePreviewUrl(path: string): { previewUrl?: string } {
  // local:// 协议仅 Electron 可用（与 insight-turn userAttachments 的 desktop 守卫一致）
  return isElectronDesktop() ? { previewUrl: pathToLocalUrl(path) } : {}
}

function buildAttachments(parts: RevertDraftPart[]): Attachment[] {
  const result: Attachment[] = []

  const manifest = parts.find((p) => p.type === "text" && p.synthetic && p.text?.startsWith("[附件]"))
  for (const file of manifest ? parseUploadedFiles(manifest.text!) : []) {
    const mime = mimeFromFilename(file.filename)
    result.push({
      id: nextAttachmentId(),
      filename: file.filename,
      mime,
      size: 0,
      status: "done",
      source: "local",
      path: file.path,
      kind: kindFromMime(mime),
      ...(mime.startsWith("image/") ? imagePreviewUrl(file.path) : {}),
    })
  }

  parts.forEach((part, index) => {
    if (part.type !== "file" || !part.filename) return
    const url = part.url ?? ""
    let path: string | undefined
    if (/^file:/i.test(url)) {
      path = decodeURIComponent(url.replace(/^file:\/\//i, ""))
    } else if (/^data:/i.test(url)) {
      path = filePathFromReadHint(parts, index)
    }
    if (!path) return
    const mime = part.mime || mimeFromFilename(part.filename)
    result.push({
      id: nextAttachmentId(),
      filename: part.filename,
      mime,
      size: 0,
      status: "done",
      source: "local",
      path,
      kind: kindFromMime(mime),
      ...(mime.startsWith("image/") ? imagePreviewUrl(path) : {}),
    })
  })

  return result
}


export function buildRevertDraft(parts: RevertDraftPart[], skills: RevertSkill[] = []): RevertDraft {
  const { visible, processed } = extractVisibleText(parts)
  return {
    docJSON: buildDocJSON(visible, processed, skills),
    attachments: buildAttachments(parts),
  }
}


export function revertSkillsFromConfig(config: SkillConfig | undefined): RevertSkill[] {
  return (config?.panel?.octo_make ?? [])
    .filter((skill) => skill.enable !== false)
    .map((skill) => ({
      name: skill.label,
      label: lookupDisplayName(config?.skill, skill.label) ?? skill.label,
    }))
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}


export function revertDocToClipboard(docJSON: any): { html: string; text: string } {
  const htmlParas: string[] = []
  const textLines: string[] = []
  for (const paragraph of docJSON?.content ?? []) {
    const htmlParts: string[] = []
    const textParts: string[] = []
    for (const node of paragraph.content ?? []) {
      if (node.type === "mention") {
        const attrs = node.attrs as RevertMention
        const label = attrs.label || attrs.name
        htmlParts.push(
          `<span class="pm-mention pm-mention--${attrs.type}" contenteditable="false" data-mention="true"` +
            ` data-id="${escapeHtml(attrs.id ?? "")}" data-name="${escapeHtml(attrs.name)}"` +
            ` data-type="${attrs.type}" data-label="${escapeHtml(attrs.label)}" data-path="${escapeHtml(attrs.path ?? "")}"` +
            ` title="@${escapeHtml(label)}">   @${escapeHtml(label)}   </span>`,
        )
        textParts.push(`@${label}`)
      } else {
        htmlParts.push(escapeHtml(node.text ?? ""))
        textParts.push(node.text ?? "")
      }
    }
    htmlParas.push(`<p>${htmlParts.join("")}</p>`)
    textLines.push(textParts.join(""))
  }
  return { html: htmlParas.join(""), text: textLines.join("\n") }
}

export async function writeRichClipboard(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ])
    return
  }
  await navigator.clipboard.writeText(text)
}
