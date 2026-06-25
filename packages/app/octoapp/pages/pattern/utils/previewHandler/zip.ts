import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"

// 分享 下载压缩包
export async function exportZip(opts: {
  patternId: string
  intent: Record<string, unknown> | null
  planner: Record<string, unknown> | null
  modules: Array<Record<string, unknown>>
  previewData: unknown
}): Promise<void> {
  const { patternId, intent, planner, modules, previewData } = opts

  if (!intent && !planner && modules.length === 0 && !previewData) {
    showToast({ title: "暂无可分享的内容" })
    return
  }

  const desktopApi = getDesktopApi()

  if (!desktopApi?.exportZip) {
    showToast({ title: "当前环境不支持导出压缩包" })
    return
  }

  const files: { name: string; content: string }[] = []

  if (intent) files.push({ name: "lastIntent.json", content: JSON.stringify(intent, null, 2) })
  if (planner) files.push({ name: "lastPlanner.json", content: JSON.stringify(planner, null, 2) })
  if (modules.length > 0) files.push({ name: "lastModules.json", content: JSON.stringify(modules, null, 2) })
  if (previewData) {
    const jsonStr = typeof previewData === "string" ? previewData : JSON.stringify(previewData, null, 2)
    files.push({ name: "pageJson.json", content: jsonStr })
  }

  const result = await desktopApi.exportZip({
    defaultName: `pattern-${patternId}`,
    files,
  })

  if (result) {
    showToast({ title: "已导出压缩包" })
  }
}
