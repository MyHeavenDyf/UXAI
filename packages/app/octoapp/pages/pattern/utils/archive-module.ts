import { createSignal } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { createPatternArchiveZip, buildArchivePath, createDeliverable, uploadCover, uploadVersion } from "./pattern-archive-utils"
import { loadAnnotations } from "./annotation-persist"
import { getDesktopApi } from "./desktop-api"
import type { ArchiveConfirmData } from "@/components/dialog-archive"

/**
 * 归档 composable
 *
 * 封装归档弹窗状态 + 确认后的 ZIP 打包/上传/下载流程。
 * 依赖项均通过 accessor 函数注入,保证 SolidJS 响应式追踪正常工作。
 */
export function useArchive(deps: {
  sessionId: () => string | undefined
  projectDir: () => string | undefined
  sessionTitle: () => string | undefined
  pendingData: () => unknown
}) {
  // 弹窗状态:archiving 控制归档弹窗,archiveSuccess* 控制成功弹窗
  const [archiving, setArchiving] = createSignal(false)
  const [archiveSuccessOpen, setArchiveSuccessOpen] = createSignal(false)
  const [archiveSuccessPath, setArchiveSuccessPath] = createSignal("")
  // 归档后的交付物 uniqueId,用于拼分享链接与「跳转查看」
  const [archiveSuccessUniqueId, setArchiveSuccessUniqueId] = createSignal("")

  async function handleArchiveConfirm(data: ArchiveConfirmData): Promise<void> {
    const sid = deps.sessionId()
    if (!sid) return
    // projectDir 用于读批注(loadAnnotations 内部拼接 .octo/design/history/{sessionId}/annotations/...)
    const dir = deps.projectDir()
    if (!dir) return

    try {
      // 1. 离屏截图 + 读批注 + 当前页面 JSON,打包成 ZIP
      // 截图走离屏隐藏窗口(单独加载 previewdist + 注入当前页面数据):
      // 可见界面的归档弹窗/批注不会被截进图里,避免遮罩污染与截图时隐藏导致的闪烁
      const api = getDesktopApi()
      const dataUrl = await api?.capturePreviewPage?.({ pageJson: deps.pendingData() })
      if (!dataUrl) throw new Error("截图失败,无法获取预览内容")
      const screenshotBlob = await (await fetch(dataUrl)).blob()

      const annotations = await loadAnnotations(dir, sid)
      const pageJson = deps.pendingData()
      const zipBlob = await createPatternArchiveZip({
        annotations, sessionId: sid, pageJson,
        screenshotBlob, projectDir: dir,
      })

      const isLoggedIn = !!localStorage.getItem("uiplusToken")
      const fileName = (deps.sessionTitle() ?? sid).replace(/\.html?$/i, "")

      if (isLoggedIn) {
        // 2a. 已登录:上传到交付物系统(封面 + 版本),与 make 流程对齐
        // 封面用上面的离屏截图,保证交付物有缩略图;版本是打包好的 ZIP
        // 覆盖模式:给已存在的 deliverable 上传新版本
        // 新建模式:先 createDeliverable 再 uploadCover + uploadVersion
        let uploadResult: { success: boolean }
        let uniqueId: string
        if (data.isOverwrite && data.existingDeliverableId && data.existingDocId) {
          await uploadCover(data.existingDeliverableId, screenshotBlob)
          uploadResult = await uploadVersion(data.existingDocId, zipBlob)
          uniqueId = data.existingDocId
        } else {
          const newDeliverable = await createDeliverable(data.teamId, fileName)
          await uploadCover(newDeliverable.deliverableId, screenshotBlob)
          uploadResult = await uploadVersion(newDeliverable.uniqueId, zipBlob)
          uniqueId = newDeliverable.uniqueId
        }
        if (!uploadResult.success) throw new Error("归档上传失败")

        // 构造展示路径(如 "项目空间 - Octo Designer - 版本管理 - 需求管理")
        const pathStr = buildArchivePath({
          spaceType: data.spaceType,
          productName: data.productName,
          versionDeliveryName: data.versionDeliveryName,
          folderName: data.folderName
        })
        setArchiveSuccessPath(pathStr)
        setArchiveSuccessUniqueId(uniqueId)
        setArchiveSuccessOpen(true)
        showToast({ title: "归档成功" })
      } else {
        // 2b. 未登录:浏览器直接下载 ZIP
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement("a")
        a.href = url
        a.download = `${fileName}-archive.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        showToast({ title: "归档完成", description: "ZIP文件已下载" })
      }
    } catch (err) {
      console.error("[Archive] Failed:", err)
      showToast({ title: "归档失败", description: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  return {
    archiving,
    archiveSuccessOpen,
    archiveSuccessPath,
    archiveSuccessUniqueId,
    toggleArchiving: () => setArchiving(a => !a),
    closeArchive: () => setArchiving(false),
    closeArchiveSuccess: () => setArchiveSuccessOpen(false),
    handleArchiveConfirm,
  }
}
