// 本地文件名规则 —— FileFallback(result-viewer) 与 markdown 编辑器共用,避免两套规则漂移。
// 见 docs/specs/ui/insight-markdown-editor.md §3.1。

/** 去掉路径分隔符 / 控制字符等非法字符,限长,空则兜底。 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "untitled"
}

/** 从 tab 派生下载/落地用的默认文件名:fileName → uri basename → title。 */
export function defaultFilename(tab: {
  fileName?: string
  uri?: string
  title?: string
}): string {
  if (tab.fileName) return sanitizeFilename(tab.fileName)
  if (tab.uri) {
    try {
      const u = new URL(tab.uri)
      const last = u.pathname.split("/").filter(Boolean).pop()
      if (last) return sanitizeFilename(decodeURIComponent(last))
    } catch {
      /* uri 非标准 URL,落到 title */
    }
  }
  return sanitizeFilename(tab.title || "download")
}

/** 非 .md/.markdown 结尾的补 `.md`(markdown 编辑器落地用)。 */
export function ensureMarkdownExt(name: string): string {
  return /\.(md|markdown|mdown|mkd)$/i.test(name) ? name : `${name}.md`
}

/** 附件本地路径是否还在预会话落地区 `<projectDir>/.octo/tmps/`(SPEC-INS-014 §4.1.2)——
 *  发送时据此决定要不要 rename 进 `.octo/<sessionId>/uploads/`。已归属会话的返回 false,不重复挪。 */
export function isPendingUploadPath(filePath: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(".octo")
  return i !== -1 && segs[i + 1] === "tmps"
}
