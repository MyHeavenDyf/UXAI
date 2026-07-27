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

// 预测「主进程落盘后的磁盘文件名」——必须与 desktop/src/main/ipc.ts `sanitizeWorktreeName`
// 逐字一致(spec insight-worktree-layout.md §3.1)。用途:产物入口卡在**落盘完成前**先按此规则
// 展示名,使卡片名(如 `林(2).json`)与文件管理里的磁盘名(`林_2_.json`)对齐——否则同一份文件
// 两处显示两名,看起来像两个文件(见 output-renderers.md §6.B「展示名对齐磁盘名」)。
// 两进程不能共享模块(app / desktop 分属不同构建),改一处务必同步改另一处。
// 注:此处只预测「清洗」,不含主进程撞名后缀(` (2)`);落盘完成后一律以 materializedLocalPath 的真实
// basename 为准(那才含撞名后缀),此函数仅作落盘前的近似占位。
export function predictWorktreeLandingName(raw: string): string {
  const replaced = raw.replace(/\s+/g, "_").replace(/[^\p{L}\p{N}._-]/gu, "_")
  const dot = replaced.lastIndexOf(".")
  if (dot > 0 && dot < replaced.length - 1) {
    const stem = replaced.slice(0, dot).slice(0, 100)
    return (stem || "unnamed") + replaced.slice(dot)
  }
  return replaced.slice(0, 100) || "unnamed"
}

// isPendingUploadPath 是「worktree 布局判据」而非文件名规则,已迁至 ./worktree-layout.ts(布局单一真相源)。
