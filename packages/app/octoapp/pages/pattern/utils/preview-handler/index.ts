import { createSignal } from "solid-js"
import { showToast, showPromiseToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"
import { rollbackToVersion } from "../version-history"
import type { PatternSessionState } from "../version-history"

// 下载预览 JSON
export function handleDownload(previewData: unknown, patternId: string): void {
  if (!previewData) {
    showToast({ title: "暂无可下载的内容" })
    return
  }
  const jsonStr = typeof previewData === "string" ? previewData : JSON.stringify(previewData, null, 2)
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `pattern-${patternId}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 实时预览
export async function handleLivePreview(previewData: unknown): Promise<void> {
  if (!previewData) {
    showToast({ title: "暂无可预览的内容" })
    return
  }

  const desktopApi = getDesktopApi()

  const dir = await desktopApi?.getPreviewDistDir?.()
  if (!dir || !desktopApi?.writeFileBuffer) {
    showToast({ title: "当前环境不支持实时预览" })
    return
  }

  const jsonStr = typeof previewData === "string" ? previewData : JSON.stringify(previewData)
  const buffer = new TextEncoder().encode(jsonStr).buffer
  await desktopApi.writeFileBuffer(`${dir}/live-data.json`, buffer)
  window.open("http://127.0.0.1:51856?fetch=live-data.json")
}

// Pixso 预览
const [pixsoLoading, setPixsoLoading] = createSignal(false)
export { pixsoLoading }

export async function handlePixsoPreview(previewData: unknown): Promise<void> {
  if (pixsoLoading()) return
  setPixsoLoading(true)

  const desktopApi = getDesktopApi()

  if (!desktopApi?.runPixsoBuild) {
    showToast({ title: "当前环境不支持 Pixso 转换" })
    setPixsoLoading(false)
    return
  }

  const jsonStr = typeof previewData === "string" ? previewData : JSON.stringify(previewData ?? "")
  const buildPromise = desktopApi.runPixsoBuild(jsonStr)

  showPromiseToast(buildPromise, {
    loading: "Pixso 转换中，请等待...",
    success: (result: string) => {
      void desktopApi.writeClipboardText?.(result)
      return `转换完成，传送码已复制到剪贴板`
    },
    error: (err: unknown) => `转换失败: ${err instanceof Error ? err.message : String(err)}`,
  })

  try {
    await buildPromise
  } catch {
    // showPromiseToast 已处理错误提示
  } finally {
    setPixsoLoading(false)
  }
}

// 回退到指定历史版本
export async function handleSelectVersion(opts: {
  versionId: string
  sessionId: string | undefined
  historyDir: string | undefined
  previewApi: { setEditingOff: () => void; refresh: () => void }
  sendToPreview: (data: unknown) => void
  onStateRestored: (state: PatternSessionState) => void
  setCurrentVersionId: (id: string) => void
}): Promise<void> {
  const { versionId, sessionId, historyDir, previewApi, sendToPreview, onStateRestored, setCurrentVersionId } = opts
  if (!sessionId || !historyDir) return
  previewApi.setEditingOff()
  const state = await rollbackToVersion(historyDir, sessionId, versionId, sendToPreview)
  if (!state) return
  setCurrentVersionId(versionId)
  onStateRestored(state)
  previewApi.refresh()
}
