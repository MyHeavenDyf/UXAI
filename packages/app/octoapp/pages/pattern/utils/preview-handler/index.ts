import { createSignal } from "solid-js"
import { showToast, showPromiseToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"
import { rollbackToVersion } from "../version-history"
import type { PatternSessionState } from "../version-history"

// 导出 HUI 代码(经 IPC 调主进程 downloadHuiCode,传入 planner + mergedA2UI)
export async function handleDownload(input: {planner: Record<string, unknown> | null, mergedA2UI: unknown, sessionId?: string}, options?: { targetLib?: string }): Promise<void> {
   if (!input.planner || !input.mergedA2UI) {
    showToast({ title: "暂无可下载的内容" })
    return
  }
  const desktopApi = getDesktopApi()
  if (!desktopApi?.downloadHuiCode || !desktopApi?.exportZip) {
    showToast({ title: "当前环境不支持代码导出" })
    return
  }
  const uploadsDir = await desktopApi.getUploadsDir?.()
  const fullUploadsPath = uploadsDir && input.sessionId ? `${uploadsDir}/${input.sessionId}/uploads` : null
  console.log("[handleDownload] uploads dir:", uploadsDir)
  console.log("[handleDownload] full uploads path:", fullUploadsPath)
  const jsonInput: {
    planner: Record<string, unknown>
    mergedA2UI: Record<string, unknown>
  }[] = [
    {
      planner: input.planner,
      mergedA2UI: input.mergedA2UI as Record<string, unknown>,
    },
  ]
  const result = await desktopApi.downloadHuiCode(jsonInput, options ?? { targetLib: 'eview-react' })
  const files = result?.files

  if (!files || files.length === 0) {
    showToast({ title: "暂无可导出的代码" })
    return
  }

  // resources → zip 内 public/assets/（Vite 由 public/ 提供 /assets/X）；无资源目录时只打代码
  const zipPath = await desktopApi.exportZip({
    defaultName: `code-export-${Date.now()}`,
    files,
    ...(fullUploadsPath
      ? { sourceDir: fullUploadsPath, destFolder: "public/assets" }
      : {}),
    comment: "a2ui-code",
  })

  if (zipPath) {
    showToast({ title: "已导出压缩包" })
  } else {
    showToast({ title: "导出已取消" })
  }
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
  const jsContent = `window.__A2UI_DATA__ = ${jsonStr};`
  const buffer = new TextEncoder().encode(jsContent).buffer
  await desktopApi.writeFileBuffer(`${dir}/data.js`, buffer)
  window.open("http://127.0.0.1:51856")
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

// 页面资源捕获:写入 A2UI 数据 → 隐藏窗口渲染 → 拦截全部网络资源 → 生成单文件 HTML 供 Pixso 导入。
export async function handleCodeToHtml(previewData: unknown): Promise<void> {
  if (pixsoLoading()) return
  setPixsoLoading(true)

  const desktopApi = getDesktopApi()

  if (!desktopApi?.codeToHtml || !desktopApi?.writeFileBuffer || !desktopApi?.getPreviewDistDir) {
    showToast({ title: "当前环境不支持页面捕获" })
    setPixsoLoading(false)
    return
  }

  try {
    // 1. 写入 A2UI 数据为 live-data.json
    const dir = await desktopApi.getPreviewDistDir()
    const jsonStr = typeof previewData === "string" ? previewData : JSON.stringify(previewData ?? "")
    const buffer = new TextEncoder().encode(jsonStr).buffer
    await desktopApi.writeFileBuffer(`${dir}/live-data.json`, buffer)

    // 2. 捕获页面
    const { html, resourceCount } = await desktopApi.codeToHtml({
      url: "http://127.0.0.1:51856?fetch=live-data.json",
    })

    // 3. 弹保存对话框,用户选位置保存单文件 HTML
    const savePath = await desktopApi.saveFilePicker?.({ title: "保存页面", defaultPath: `capture-${Date.now()}.html` })
    if (savePath) {
      const htmlBuffer = new TextEncoder().encode(html).buffer
      await desktopApi.writeFileBuffer(savePath, htmlBuffer)
      showToast({ title: `已保存: ${resourceCount} 个资源内联, ${(html.length / 1024).toFixed(0)}KB` })
    } else {
      showToast({ title: "已取消保存" })
    }
  } catch (err) {
    showToast({ title: `操作失败: ${err instanceof Error ? err.message : String(err)}` })
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
