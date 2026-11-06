/**
 * fastui 归档:只归档源码 zip(SPEC-DES-007 §7)
 *
 * 交付件就是「下载」得到的那个代码包(同一个 `export-zip.mjs`,跳过依赖链接、排除 `.history/`),
 * 不是 HTML 交付件,所以不走 createDeliverable / uploadCover / uploadVersion 那套截图 + `preview/` 结构,
 * 而是走普通文件交付件:EdmUtil.upload → getActivityByTeam 取交付件类型 → uploadDeliverable。
 *
 * 与 Insight 的文件归档(`pages/insight/components/archive-flow.tsx` 的 `runArchiveFileTask`)用同一组
 * 共享底层;按页面自包含的约定不反向依赖 Insight 页面代码,这里写一份 Design 自己的。
 */
import type { ArchiveConfirmData } from "@/components/dialog-archive"
import { TaskStore, type TaskItem } from "@/context/task"
import { getActivityByTeam, uploadDeliverable } from "@/network/pipelineRequest"
import { EdmUtil } from "@/utils/edmUtil"

import { showOctoToast } from "../components/octo-toast"
import { type FastuiTarget, getDesktopApi } from "../lib/electron-api"
import { buildArchivePath, getArchiveBaseUrl } from "./archive-utils"
import { baseNameOf, withFastuiZip } from "./fastui-export"

export type FastuiArchiveResult = { path: string; viewUrl?: string }

// EDM 文件归档的单文件大小区间 1B~4GiB(与 Insight 文件归档相同,超界服务端拒)
const ARCHIVE_MIN_FILE_SIZE = 1
const ARCHIVE_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024

export function archiveSizeError(size: number): string | null {
  return size < ARCHIVE_MIN_FILE_SIZE || size > ARCHIVE_MAX_FILE_SIZE ? "文件大小超出限制（仅支持 1B~4GB 的文件）" : null
}

/** 普通文件交付件的查看地址:`/p/<交付件 id>`,与 Insight 文件归档一致 */
export function deliverableViewUrl(id: number): string | undefined {
  return id > 0 ? `${getArchiveBaseUrl()}/p/${id}` : undefined
}

function fail(description: string): null {
  showOctoToast({ title: "归档失败", description })
  return null
}

/** 打包并读进内存。读完即释放打包锁,上传期间不占锁(上传可能很久,不该挡住下载) */
async function readFastuiZip(target: FastuiTarget): Promise<File> {
  return withFastuiZip(target, async (zip) => {
    const buf = await getDesktopApi()?.readFileBuffer?.(zip.zipPath)
    if (!buf) throw new Error("无法读取代码包")
    // 文件名取 zip 的末段:主进程已按工程命名,老卡片也有名字
    return new File([buf], baseNameOf(zip.zipPath), { type: "application/zip" })
  })
}

/**
 * 打包 → 上传到 EDM(登记任务中心上传任务,有进度、可取消)→ 登记交付件。
 * 成功返回成功弹窗要显示的路径与查看链接;失败或取消返回 null,失败原因已自行提示。
 */
export async function archiveFastuiZip(target: FastuiTarget, data: ArchiveConfirmData): Promise<FastuiArchiveResult | null> {
  let file: File
  try {
    file = await readFastuiZip(target)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  const sizeErr = archiveSizeError(file.size)
  if (sizeErr) return fail(sizeErr)

  // 请求失败时 apiFetch 已弹提示并返回 null
  const activity = await getActivityByTeam(data.teamId)
  if (!activity) return null

  const dt = new DataTransfer()
  dt.items.add(file)

  // EdmUtil.upload 是回调式的;onFinish 之后的 uploadDeliverable 结束才 resolve
  return new Promise<FastuiArchiveResult | null>((resolve) => {
    EdmUtil.upload(dt.files, {
      onInit: (taskId, files) => {
        TaskStore.add(
          files.map(
            (f, index): TaskItem => ({
              key: `${taskId}-${index}`,
              taskId,
              type: "upload",
              serviceType: "edm_upload",
              hasProgress: true,
              canPause: false,
              canCancel: true,
              pauseDisabled: false,
              cancelDisabled: false,
              name: f.name,
              size: f.size,
              progress: 0,
              status: "pending",
              createdAt: Date.now(),
              fileIndex: index,
            }),
          ),
        )
        showOctoToast({ title: "该任务已添加到任务列表" })
      },
      onProgress: (taskId, files) => {
        TaskStore.progress(files.map((f, index) => ({ key: `${taskId}-${index}`, progress: f.progress, status: "in_progress" })))
      },
      onFinish: (taskId, files) => {
        // 取消只翻转任务状态、不中断底层传输,onFinish 仍会到达:用户取消的项不能改回 completed,也不能登记交付件
        const live = files
          .map((f, index) => ({ f, key: `${taskId}-${index}` }))
          .filter((e) => !TaskStore.wasCancelled(e.key))
        if (live.length === 0) return resolve(null)
        TaskStore.finish(
          live.map((e) => ({ key: e.key, progress: 100, status: "completed", docId: e.f.docId, version: e.f.version })),
        )
        uploadDeliverable({
          typeId: activity.deliverableType,
          files: live.map((e) => ({ docName: e.f.name, docId: e.f.docId, docVersion: e.f.version, docSize: e.f.size })),
          teamId: data.teamId,
        })
          .then((res) => {
            // 失败时 apiFetch 已弹提示并返回 null
            if (!res || res.length === 0) return resolve(null)
            resolve({ path: buildArchivePath(data), viewUrl: deliverableViewUrl(res[0].id) })
          })
          .catch((e) => resolve(fail(e instanceof Error ? e.message : String(e))))
      },
      onError: (taskId, errors) => {
        TaskStore.error(
          TaskStore.items()
            .filter((item) => item.taskId === taskId)
            .map((item) => ({ key: item.key, status: "error" })),
        )
        resolve(fail(errors?.message || "上传失败"))
      },
    })
  })
}
