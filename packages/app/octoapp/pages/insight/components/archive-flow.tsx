// Insight 归档复用层:抽取自 result-viewer/action-bar,供 ActionBar 与文件管理列表行菜单共用。
//   - runArchive:按 target.mode 分流。HTML 复刻 Design 流程(截图 + zip + createDeliverable/uploadCover/
//     uploadVersion);其他类型走 EdmUtil.upload → getActivityByTeam 取 deliverableType → uploadDeliverable。
//   - ArchiveDialogs:复用归档弹窗 + 成功弹窗,调用方持 open/target 状态,本组件负责 confirm 执行。
// 成功返回归档路径(开成功弹窗);未登录 HTML 下载 zip 返回 undefined;失败 throw(已 toast)。

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

export async function runArchive(target: ArchiveTarget, data: ArchiveConfirmData): Promise<string | undefined> {
  return target.mode === "html" ? archiveHtml(target, data) : archiveFile(target, data)
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

async function archiveHtml(target: HtmlTarget, data: ArchiveConfirmData): Promise<string | undefined> {
  const overlay = document.querySelector(".archive-dialog-overlay") as HTMLElement | null
  const collisionOverlay = document.querySelector(".archive-collision-overlay") as HTMLElement | null
  try {
    const iframe = target.getIframe?.() ?? null
    let screenshotBlob: Blob
    if (iframe) {
      if (overlay) overlay.style.visibility = "hidden"
      if (collisionOverlay) collisionOverlay.style.visibility = "hidden"
      screenshotBlob = await capturePageScreenshot(iframe)
      if (overlay) overlay.style.visibility = "visible"
    } else {
      screenshotBlob = await placeholderScreenshot()
    }

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
      if (data.isOverwrite && data.existingDeliverableId && data.existingDocId) {
        await uploadCover(data.existingDeliverableId, screenshotBlob)
        uploadResult = await uploadVersion(data.existingDocId, zipBlob)
      } else {
        const newDeliverable = await createDeliverable(data.teamId, baseName)
        await uploadCover(newDeliverable.deliverableId, screenshotBlob)
        uploadResult = await uploadVersion(newDeliverable.uniqueId, zipBlob)
      }
      if (!uploadResult.success) throw new Error("归档上传失败")
      showToast({ title: "归档成功" })
      return buildSuccessPath(data)
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
      showToast({ title: "归档完成", description: "ZIP文件已下载" })
      return undefined
    }
  } catch (err) {
    if (overlay) overlay.style.visibility = "visible"
    if (collisionOverlay) collisionOverlay.style.visibility = "visible"
    console.error("[Archive] Failed:", err)
    showToast({ title: "归档失败", description: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

async function archiveFile(target: FileTarget, data: ArchiveConfirmData): Promise<string | undefined> {
  const file = await target.getFile()
  if (!file) {
    showToast({ title: "归档失败", description: "无法获取文件内容" })
    throw new Error("无法获取文件内容")
  }
  const dt = new DataTransfer()
  dt.items.add(file)
  // apiFetch 失败时已弹 toast 并返回 null(见 pipelineRequest.reportRequestError),这里仅判空抛错,不重复 toast。
  const activity = await getActivityByTeam(data.teamId)
  if (!activity) throw new Error("获取归档类型失败")
  await new Promise<void>((resolve, reject) => {
    EdmUtil.upload(dt.files, {
      onFinish: (_taskId, files) => {
        uploadDeliverable({
          typeId: activity.deliverableType,
          files: files.map((f) => ({ docName: f.name, docId: f.docId, docVersion: f.version, docSize: f.size })),
          teamId: data.teamId,
        })
          .then((res) => {
            // apiFetch 失败返回 null(已 toast);成功返回非空 content。
            if (res === null || res === undefined) return reject(new Error("归档上传失败"))
            showToast({ title: "归档成功" })
            resolve()
          })
          .catch((e) => reject(e instanceof Error ? e : new Error(String(e))))
      },
      onError: (_taskId, errors) => {
        const msg = errors?.message || "上传失败"
        showToast({ title: "归档失败", description: msg })
        reject(new Error(msg))
      },
    })
  })
  return buildSuccessPath(data)
}

export function ArchiveDialogs(props: {
  target: ArchiveTarget | null
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [successOpen, setSuccessOpen] = createSignal(false)
  const [successPath, setSuccessPath] = createSignal("")

  const filePath = () => (props.target ? (props.target.mode === "html" ? props.target.htmlFilePath : props.target.filePath) : "")
  const tabTitle = () => (props.target ? (props.target.mode === "html" ? props.target.htmlFileName : props.target.fileName) : "")
  const sessionId = () => props.target?.sessionId ?? ""

  async function handleConfirm(data: ArchiveConfirmData): Promise<void> {
    if (!props.target) return
    const path = await runArchive(props.target, data)
    if (path) {
      setSuccessPath(path)
      setSuccessOpen(true)
    }
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
        />
      </Show>
    </>
  )
}
