// 本地文件名规则 —— FileFallback(result-viewer) 与 markdown 编辑器共用,避免两套规则漂移。
// 见 docs/specs/ui/insight-markdown-editor.md §3.1、SPEC-INS-026 §4.1/§4.3。
//
// **落盘方向不在这里清洗。** 唯一清洗入口是主进程 `packages/desktop/src/main/landing-name.ts`
// 的 `landingName`:它对不合法的名字**拒绝并报错**,而不是静默改名。渲染侧若先把非法字符换成
// `_`,那个报错永远触发不了,磁盘名与展示名又会分叉(`林(2).json` → `林_2_.json` 就是这么来的)。
// 故 `defaultFilename` 逐字透传来源文件名,由主进程单点决定拒绝还是清洗。

/**
 * **仅供 OS 保存对话框的默认名**(saveFilePicker 的 defaultPath 会被当路径解析,含 `/` 会跑进子目录)。
 * 不要用在落盘链路上 —— 落盘走主进程 landingName。
 */
export function saveDialogName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "untitled"
}

/**
 * 从 tab 派生落地/展示用的默认文件名:fileName → uri basename → title。
 * **逐字保留**(不清洗、不截断),理由见文件头。
 */
export function defaultFilename(tab: {
  fileName?: string
  uri?: string
  title?: string
}): string {
  if (tab.fileName) return tab.fileName
  if (tab.uri) {
    try {
      const u = new URL(tab.uri)
      const last = u.pathname.split("/").filter(Boolean).pop()
      if (last) return decodeURIComponent(last)
    } catch {
      /* uri 非标准 URL,落到 title */
    }
  }
  return tab.title || "download"
}

/** 非 .md/.markdown 结尾的补 `.md`(markdown 编辑器落地用)。 */
export function ensureMarkdownExt(name: string): string {
  return /\.(md|markdown|mdown|mkd)$/i.test(name) ? name : `${name}.md`
}

// isPendingUploadPath 是「worktree 布局判据」而非文件名规则,已迁至 ./worktree-layout.ts(布局单一真相源)。
