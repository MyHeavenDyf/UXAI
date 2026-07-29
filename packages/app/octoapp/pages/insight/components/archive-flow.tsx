// Insight 归档复用层:抽取自 result-viewer/action-bar,供 ActionBar 与文件管理列表行菜单共用。
//   - runArchive:按 target.mode 分流,均异步(立即返回 undefined,弹窗关闭),后台任务完成后回调 onDeferredSuccess。
//     · HTML:复刻 Design 流程(截图 + zip + createDeliverable/uploadCover/uploadVersion),TaskStore 任务 type=archive。
//     · 非 HTML:EdmUtil.upload → getActivityByTeam 取 deliverableType → uploadDeliverable,TaskStore 任务 type=upload(有进度)。
//   - ArchiveDialogs:复用归档弹窗 + 成功弹窗,调用方持 open/target 状态,本组件负责 confirm 执行。
// 两者均:确定即关弹窗 + toast「任务已加入任务列表」,任务(头部任务中心可见)完成后再开成功弹窗。

import { createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { ArchiveDialog, type ArchiveConfirmData } from "@/components/dialog-archive"
import { DialogArchiveSuccess } from "@/components/dialog-archive-success"
import {
  createArchiveZip,
  capturePageScreenshot,
  buildArchivePath,
  createDeliverable,
  uploadCover,
  uploadVersion,
} from "../utils/archive-utils"
import { EdmUtil } from "@/utils/edmUtil"
import { uploadDeliverable, getActivityByTeam } from "@/network/pipelineRequest"
import { getDesktopApi } from "../lib/electron-api"
import { TaskStore, type TaskItem } from "@/context/task"

export type ArchiveTarget =
  | {
      mode: "html"
      sessionId: string
      projectDir: string
      /** 懒取 HTML 源码(文件管理场景需读盘后再解码 base64;ActionBar 场景直接拿 tab.content) */
      getHtmlContent: () => Promise<string>
      htmlFileName: string
      htmlFilePath: string
      /** 预览 iframe 用于截图;文件管理列表无 live iframe → 留空走占位截图 */
      getIframe?: () => HTMLIFrameElement | null
    }
  | {
      mode: "file"
      sessionId: string
      projectDir: string
      fileName: string
      filePath: string
      /** 懒取 File 供 EdmUtil.upload(本地读盘 / uri 拉取 / 文本兜底,由调用方决定) */
      getFile: () => Promise<File | null>
    }

type HtmlTarget = Extract<ArchiveTarget, { mode: "html" }>
type FileTarget = Extract<ArchiveTarget, { mode: "file" }>

export function buildSuccessPath(data: ArchiveConfirmData): string {
  return buildArchivePath({
    spaceType: data.spaceType,
    productName: data.productName,
    versionDeliveryName: data.versionDeliveryName,
    folderName: data.folderName,
  })
}

// 归档成功结果:archivePath 用于成功弹窗展示,viewUrl 用于「跳转查看」(非 HTML)。
export type ArchiveSuccess = { path: string; viewUrl?: string }

// 非 HTML 归档成功后的「跳转查看」URL:/p/{id},id 来自 uploadDeliverable 返回。
function buildDeliverableViewUrl(id: number): string {
  const base = import.meta.env.VITE_OCTO_BASE_URL || ""
  return `${base}/p/${id}`
}

// HTML 归档成功后的「跳转查看」URL:designAgent 预览页,uniqueId 来自 createDeliverable(新建)/ existingDocId(覆盖)。对齐 make html-renderer。
function buildHtmlPreviewUrl(uniqueId: string): string {
  const base = import.meta.env.VITE_OCTO_BASE_URL || ""
  return `${base}/developerPreview/designAgent/index.html?uniqueId=${uniqueId}`
}

// 唤起系统浏览器打开外链(electron 用 openLink,web 用 window.open),避免在 webview 内导航后无返回入口。
function openExternalUrl(url: string) {
  const api = getDesktopApi()
  if (typeof api?.openLink === "function") api.openLink(url)
  else window.open(url, "_blank", "noopener")
}

// base64 → 原始字符串(文件管理 HTML 归档需解码后源码进 zip)
export function decodeBase64ToString(b64: string): string {
  try {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return ""
  }
}

// onDeferredSuccess:归档后台任务完成后的回调(开成功弹窗,带跳转 URL)。HTML/非 HTML 均异步,立即返回 undefined。
export async function runArchive(
  target: ArchiveTarget,
  data: ArchiveConfirmData,
  onDeferredSuccess?: (result: ArchiveSuccess) => void,
): Promise<string | undefined> {
  return target.mode === "html"
    ? archiveHtml(target, data, onDeferredSuccess)
    : archiveFile(target, data, onDeferredSuccess)
}

// 无 live iframe 时用 1×1 白图占位(与 capturePageScreenshot 的 web 兜底同源,不阻塞 zip 打包)
function placeholderScreenshot(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d")
    if (!ctx) return reject(new Error("无法生成截图"))
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, 1, 1)
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("无法生成截图"))), "image/jpeg", 0.9)
  })
}

// HTML 归档:立即返回(弹窗关闭),后台跑 runArchiveHtmlTask(复刻 Design 流程 + 任务中心),完成后 onDeferredSuccess。
async function archiveHtml(
  target: HtmlTarget,
  data: ArchiveConfirmData,
  onDeferredSuccess?: (result: ArchiveSuccess) => void,
): Promise<string | undefined> {
  void runArchiveHtmlTask(target, data, onDeferredSuccess)
  return undefined
}

// HTML 归档任务用 TaskItem(单任务,key=taskId):type=archive、无进度(createDeliverable/uploadVersion 无进度回调)。
function htmlArchiveTask(taskId: string, name: string, progress: number, status: TaskItem["status"]): TaskItem {
  return {
    key: taskId,
    taskId,
    type: "archive",
    serviceType: "s3_upload",
    hasProgress: false,
    canPause: false,
    canCancel: false,
    pauseDisabled: false,
    cancelDisabled: false,
    name,
    size: 0,
    progress,
    status,
    createdAt: Date.now(),
    fileIndex: 0,
  }
}

async function runArchiveHtmlTask(
  target: HtmlTarget,
  data: ArchiveConfirmData,
  onDeferredSuccess?: (result: ArchiveSuccess) => void,
): Promise<void> {
  const taskId = `archive-html-${Date.now()}`
  const name = target.htmlFileName
  TaskStore.add([htmlArchiveTask(taskId, name, 0, "pending")])
  TaskStore.progress([htmlArchiveTask(taskId, name, 0, "in_progress")])
  try {
    // 弹窗已关闭,iframe 在标签页内容区仍可见;无 live iframe(文件管理 / 源码视图)走占位截图。
    const iframe = target.getIframe?.() ?? null
    const screenshotBlob = iframe ? await capturePageScreenshot(iframe) : await placeholderScreenshot()

    const zipBlob = await createArchiveZip({
      comments: [],
      screenshotBlob,
      htmlContent: await target.getHtmlContent(),
      htmlFileName: target.htmlFileName,
      htmlFilePath: target.htmlFilePath,
      sessionId: target.sessionId,
      projectDir: target.projectDir,
    })

    const isLoggedIn = !!localStorage.getItem("uiplusToken")
    const baseName = target.htmlFileName.replace(/\.html?$/i, "")
    if (isLoggedIn) {
      let uploadResult: { success: boolean }
      let uniqueId: string
      if (data.isOverwrite && data.existingDeliverableId && data.existingDocId) {
        uniqueId = data.existingDocId
        await uploadCover(data.existingDeliverableId, screenshotBlob)
        uploadResult = await uploadVersion(data.existingDocId, zipBlob)
      } else {
        const newDeliverable = await createDeliverable(data.teamId, baseName)
        uniqueId = newDeliverable.uniqueId
        await uploadCover(newDeliverable.deliverableId, screenshotBlob)
        uploadResult = await uploadVersion(newDeliverable.uniqueId, zipBlob)
      }
      if (!uploadResult.success) throw new Error("归档上传失败")
      TaskStore.finish([htmlArchiveTask(taskId, name, 100, "completed")])
      const viewUrl = uniqueId ? buildHtmlPreviewUrl(uniqueId) : undefined
      onDeferredSuccess?.({ path: buildSuccessPath(data), viewUrl })
    } else {
      const zipName = `${baseName}-archive.zip`
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = zipName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      TaskStore.finish([htmlArchiveTask(taskId, name, 100, "completed")])
      showToast({ title: "归档完成", description: "ZIP文件已下载" })
    }
  } catch (err) {
    TaskStore.error([htmlArchiveTask(taskId, name, 0, "error")])
    console.error("[Archive] Failed:", err)
    showToast({ title: "归档失败", description: err instanceof Error ? err.message : String(err) })
  }
}

// 非 HTML 归档:立即返回(弹窗关闭、toast 提示已加入任务列表),后台跑 runArchiveFileTask,
// 任务(EdmUtil.upload)完成后再 onDeferredSuccess 开成功弹窗。
async function archiveFile(
  target: FileTarget,
  data: ArchiveConfirmData,
  onDeferredSuccess?: (result: ArchiveSuccess) => void,
): Promise<string | undefined> {
  void runArchiveFileTask(target, data, onDeferredSuccess)
  return undefined
}

async function runArchiveFileTask(
  target: FileTarget,
  data: ArchiveConfirmData,
  onDeferredSuccess?: (result: ArchiveSuccess) => void,
): Promise<void> {
  try {
    const file = await target.getFile()
    if (!file) {
      showToast({ title: "归档失败", description: "无法获取文件内容" })
      return
    }
    const dt = new DataTransfer()
    dt.items.add(file)
    // apiFetch 失败时已弹 toast 并返回 null(见 pipelineRequest.reportRequestError),这里仅判空返回。
    const activity = await getActivityByTeam(data.teamId)
    if (!activity) return
    // TaskStore 的 add/progress/finish/error 在本业务回调里调(EdmUtil 不再包办)。
    EdmUtil.upload(dt.files, {
      onInit: (taskId, files) => {
        TaskStore.add(files.map((file, index): TaskItem => ({
          key: `${taskId}-${index}`,
          taskId,
          type: "upload",
          serviceType: "edm_upload",
          hasProgress: true,
          canPause: false,
          canCancel: false,
          pauseDisabled: false,
          cancelDisabled: false,
          name: file.name,
          size: file.size,
          progress: 0,
          status: "pending",
          createdAt: Date.now(),
          fileIndex: index,
        })))
      },
      onProgress: (taskId, files) => {
        TaskStore.progress(files.map((file, index): TaskItem => ({
          key: `${taskId}-${index}`,
          taskId,
          type: "upload",
          serviceType: "edm_upload",
          hasProgress: true,
          canPause: false,
          canCancel: true,
          pauseDisabled: false,
          cancelDisabled: false,
          name: file.name,
          size: file.size,
          progress: file.progress,
          status: "in_progress",
          fileIndex: index,
        })))
      },
      onFinish: (taskId, files) => {
        TaskStore.finish(files.map((file, index): TaskItem => ({
          key: `${taskId}-${index}`,
          taskId,
          type: "upload",
          serviceType: "edm_upload",
          hasProgress: true,
          canPause: false,
          canCancel: false,
          pauseDisabled: false,
          cancelDisabled: false,
          name: file.name,
          size: file.size,
          progress: 100,
          status: "completed",
          fileIndex: index,
        })))
        uploadDeliverable({
          typeId: activity.deliverableType,
          files: files.map((f) => ({ docName: f.name, docId: f.docId, docVersion: f.version, docSize: f.size })),
          teamId: data.teamId,
        })
          .then((res) => {
            // apiFetch 失败返回 null(已 toast);成功返回 UploadDeliverableResult[](归档一个文件 → 取 [0])。
            if (!res || res.length === 0) return
            const id = res[0].id
            const viewUrl = id > 0 ? buildDeliverableViewUrl(id) : undefined
            onDeferredSuccess?.({ path: buildSuccessPath(data), viewUrl })
          })
          .catch((e) => {
            showToast({ title: "归档失败", description: e instanceof Error ? e.message : String(e) })
          })
      },
      onError: (taskId, errors) => {
        TaskStore.error(TaskStore.items()
          .filter((f) => f.taskId === taskId)
          .map((f): TaskItem => ({
            key: f.key,
            taskId,
            type: "upload",
            serviceType: "edm_upload",
            hasProgress: true,
            canPause: false,
            canCancel: false,
            pauseDisabled: false,
            cancelDisabled: false,
            name: f.name,
            size: f.size,
            progress: f.progress,
            status: "error",
            fileIndex: f.fileIndex,
          })))
        const msg = errors?.message || "上传失败"
        showToast({ title: "归档失败", description: msg })
      },
    })
  } catch (err) {
    showToast({ title: "归档失败", description: err instanceof Error ? err.message : String(err) })
  }
}

export function ArchiveDialogs(props: {
  target: ArchiveTarget | null
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [successOpen, setSuccessOpen] = createSignal(false)
  const [successPath, setSuccessPath] = createSignal("")
  const [successViewUrl, setSuccessViewUrl] = createSignal<string | undefined>(undefined)

  const filePath = () => (props.target ? (props.target.mode === "html" ? props.target.htmlFilePath : props.target.filePath) : "")
  const tabTitle = () => (props.target ? (props.target.mode === "html" ? props.target.htmlFileName : props.target.fileName) : "")
  const sessionId = () => props.target?.sessionId ?? ""

  async function handleConfirm(data: ArchiveConfirmData): Promise<void> {
    if (!props.target) return
    // 弹窗立即关闭,toast 提示任务已加入任务列表,后台归档任务(HTML/非 HTML 均走任务中心)完成后 onDeferredSuccess 开成功弹窗。
    showToast({ title: "该任务已添加到任务列表" })
    void runArchive(props.target, data, (result) => {
      setSuccessPath(result.path)
      setSuccessViewUrl(result.viewUrl)
      setSuccessOpen(true)
    })
  }

  return (
    <>
      <Show when={props.open}>
        <ArchiveDialog
          open={props.open}
          onClose={props.onClose}
          onConfirm={handleConfirm}
          sessionId={sessionId()}
          filePath={filePath()}
          tabTitle={tabTitle()}
          showDeliverables={props.target?.mode === "html"}
        />
      </Show>
      <Show when={successOpen()}>
        <DialogArchiveSuccess
          open={successOpen()}
          onClose={() => setSuccessOpen(false)}
          archivePath={successPath()}
          shareLink={successViewUrl() || undefined}
          onViewClick={successViewUrl() ? () => openExternalUrl(successViewUrl()!) : undefined}
        />
      </Show>
    </>
  )
}
