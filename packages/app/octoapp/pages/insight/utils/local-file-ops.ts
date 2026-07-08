// 本地文件的"用系统应用打开" / "在文件夹中定位"——path 源(write 产物)和新增的文件管理面板
// (SPEC-INS-014 §10)共用同一套实现,原先各自内联在 action-bar.tsx,这里提出来去重。

import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../lib/electron-api"

export async function openFileLocally(filePath: string): Promise<void> {
  const api = getDesktopApi()
  if (typeof api?.openPath !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.openPath", variant: "error" })
    return
  }
  console.log("[octo:path] open-local", { filePath })
  try {
    const r = (await api.openPath(filePath)) as unknown as string | undefined
    if (typeof r === "string" && r.length > 0) {
      showToast({ title: "唤起本地应用失败", description: "请安装对应应用或在系统设置中关联打开方式", variant: "error" })
    }
  } catch (err) {
    showToast({ title: "无法打开文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
  }
}

export function revealFileInFolder(filePath: string): void {
  const api = getDesktopApi()
  if (typeof api?.showItemInFolder !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.showItemInFolder", variant: "error" })
    return
  }
  console.log("[octo:path] reveal-local", { filePath })
  api.showItemInFolder(filePath)
}
