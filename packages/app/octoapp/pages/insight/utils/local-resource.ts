// 解析 tab 对应的「本地工作副本」路径 —— 卡片预览(UriMarkdownTabBody)、全屏编辑器(MarkdownEditor)、
// 本地打开共用同一份,避免文件名 / 落点规则漂移到两套(漂移会导致预览读 A、编辑写 B,看不到改动)。
//
// - path 源(write 工具产物):文件已在磁盘,直接用 filePath。
// - uri 源:downloadResourceToTemp 幂等落到 <projectDir>/.octo/downloads/<id>/<file>;
//   首次下原件、之后复用用户改过的那份(见 desktop/src/main/ipc.ts `reuse-existing`)。
//   无 projectDir → 落 OS 临时目录(persistent=false,重启可能被清)。
// - inline / 缺桌面能力 → 抛错(调用方决定退回 fetch 只读 或 提示无法编辑)。
//
// 见 spec insight-markdown-editor.md §3。

import { getDesktopApi } from "../lib/electron-api"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { defaultFilename, ensureMarkdownExt } from "./local-file"

export async function ensureLocalMarkdownFile(
  tab: ResultTab,
  projectDir: string,
): Promise<{ path: string; persistent: boolean }> {
  if (tab.source === "path" && tab.filePath) {
    return { path: tab.filePath, persistent: true }
  }
  if (tab.source === "uri" && tab.uri) {
    const api = getDesktopApi()
    if (typeof api?.downloadResourceToTemp !== "function") {
      throw new Error("缺少 window.api.downloadResourceToTemp,无法定位本地文件")
    }
    const filename = ensureMarkdownExt(defaultFilename(tab))
    const baseDir = projectDir || undefined
    const localPath = await api.downloadResourceToTemp!(tab.uri, tab.id, filename, baseDir)
    return { path: localPath, persistent: !!baseDir }
  }
  throw new Error("该卡片无可编辑的本地文件(inline 内容)")
}
