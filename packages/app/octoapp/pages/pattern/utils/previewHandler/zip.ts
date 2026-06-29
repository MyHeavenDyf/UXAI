import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"

export async function exportZip(opts: {
  historyDir: string
  sessionId: string
  title: string
}): Promise<void> {
  const desktopApi = getDesktopApi()

  if (!desktopApi?.exportZip) {
    showToast({ title: "当前环境不支持导出压缩包" })
    return
  }

  const sourceDir = `${opts.historyDir}/${opts.sessionId}`

  const result = await desktopApi.exportZip({
    defaultName: opts.title || opts.sessionId,
    sourceDir,
    comment: "a2ui-pattern",
  })

  if (result) {
    showToast({ title: "已导出压缩包" })
  } else {
    showToast({ title: "暂无可分享的历史版本" })
  }
}

export async function importPatternZip(): Promise<{ name: string; content: string }[] | null> {
  const desktopApi = getDesktopApi()

  if (!desktopApi?.importZip) {
    showToast({ title: "当前环境不支持导入压缩包" })
    return null
  }

  const files = await desktopApi.importZip()

  if (!files) return null
  if (files.length === 0) {
    showToast({ title: "不是有效的 Pattern 导出文件" })
    return null
  }

  return files
}
