import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { FileService } from "../edmFileServices/file-service"

// 任务状态
// pending     等待中，任务已入队但未开始传输
// in_progress 传输中，任务正在传输
// paused      已暂停，任务被手动暂停，可继续
// completed   已完成，任务传输成功结束
// error       失败，任务传输出错
// cancelled   已取消，任务被手动取消
type TaskStatus = "pending" | "in_progress" | "paused" | "completed" | "error" | "cancelled"

export type TaskItem = {
  key: string        // 任务的唯一标识符，通常是 taskId + fileIndex
  taskId: string      // 一个任务可能包含多个文件，每个文件的 taskId 相同，但 fileIndex 不同
  type: "upload" | "download" | "archive"  // 任务类型，上传或下载或归档
  serviceType: string  // 服务类型，如edm_upload edm_download 或 s3_upload s3_download,暂停取消根据此类型统一配置
  name: string   // 文件名
  size: number   // 文件大小，单位为字节
  status: TaskStatus // 任务状态，可能的值为 "pending"、"in_progress"、"paused"、"completed"、"error" 或 "cancelled"
  hasProgress?: boolean  // 是否有进度信息，上传和下载任务通常有进度信息，而归档任务可能没有
  progress?: number // 任务进度，范围为 0 到 100
  canPause?: boolean  // 是否可以暂停，标记是否出现暂停/继续按钮
  canCancel?: boolean  // 是否可以取消，标记是否出现取消按钮
  pauseDisabled?: boolean  // 暂停按钮是否置灰
  cancelDisabled?: boolean  // 取消按钮是否置灰
  docId?: string
  version?: string
  cacheSign?: string
  createdAt?: number
  fileIndex?: number
}

// progress/finish/error 的入参只读 key + 需更新的字段，调用方无需构造完整 TaskItem（避免 as 强转吞掉字段缺失）。
export type TaskProgressUpdate = { key: string; progress: number; status?: TaskStatus }
export type TaskFinishUpdate = { key: string; progress?: number; status?: TaskStatus; docId?: string; version?: string }
export type TaskErrorUpdate = { key: string; status?: TaskStatus; message?: string }

// 模块级单例 store，整个应用共享一份任务列表，无需 Context Provider
const [store, setStore] = createStore({ items: [] as TaskItem[] })

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// 按状态分组的派生列表；任务中心按 进行中→已暂停→失败→已完成→已取消 的顺序拼接展示
const activeItems = createMemo(() =>
  store.items.filter(i => i.status === "in_progress" || i.status === "pending")
)

// 失败任务
const errorItems = createMemo(() =>
  store.items.filter(i => i.status === "error")
)

// 已暂停任务
const pausedItems = createMemo(() =>
  store.items.filter(i => i.status === "paused")
)

// 已完成任务
const completedItems = createMemo(() =>
  store.items.filter(i => i.status === "completed")
)

// 已取消任务
const cancelledItems = createMemo(() =>
  store.items.filter(i => i.status === "cancelled")
)

// 按 key 定位任务在列表中的下标
function findIndex(key: string) {
  return store.items.findIndex(i => i.key === key)
}

// 终态判断:completed/error/cancelled 不再被后续 progress/finish/error 回调改写
// (防止用户取消/任务完成后,被迟到的整批回调改回 in_progress/completed/error)
function isTerminal(idx: number) {
  const s = store.items[idx]?.status
  return s === "completed" || s === "error" || s === "cancelled"
}

// 服务句柄注册表：新服务在此注册 cancel/pause，TaskStore.cancel/togglePause 按 serviceType 派发，
// 避免在公共 store 里写 if-else（s3 或新模块接进来无需改本文件）。
type ServiceHandlers = { cancel?: (item: TaskItem) => void; pause?: (item: TaskItem, paused: boolean) => void }
const services = new Map<string, ServiceHandlers>()

export const TaskStore = {
  items: () => store.items,
  activeItems,
  errorItems,
  pausedItems,
  // 入口徽标显示的进行中任务数
  activeCount: createMemo(() => activeItems().length),
  completedItems,
  cancelledItems,
  formatFileSize,
  // 注册某类服务的取消/暂停句柄
  registerService(serviceType: string, handlers: ServiceHandlers) {
    services.set(serviceType, handlers)
  },
  // 任务入队
  add(data: Array<TaskItem>) {
    setStore("items", prev => [...prev, ...data])
  },
  // 传输进度更新；终态(completed/error/cancelled)项不再被覆盖，paused 项保持 paused(底层未真正暂停，见 togglePause TODO)
  progress(data: Array<TaskProgressUpdate>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx < 0 || isTerminal(idx)) continue
      const cur = store.items[idx]
      const next = cur.status === "paused" ? "paused" : (u.status ?? cur.status)
      setStore("items", idx, { progress: u.progress, status: next })
    }
  },
  // 传输完成；写入 progress/status 与 docId/version(供后续按文档 id 跳转)。终态项跳过(取消的不被改回完成)
  finish(data: Array<TaskFinishUpdate>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx < 0 || isTerminal(idx)) continue
      setStore("items", idx, {
        progress: u.progress ?? store.items[idx].progress,
        status: u.status ?? "completed",
        ...(u.docId !== undefined ? { docId: u.docId } : {}),
        ...(u.version !== undefined ? { version: u.version } : {}),
      })
    }
  },
  // 传输失败。终态项跳过(已完成的不被迟到的 onError 改成失败)
  error(data: Array<TaskErrorUpdate>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx < 0 || isTerminal(idx)) continue
      setStore("items", idx, { status: u.status ?? "error" })
    }
  },
  // 取消任务：将该任务项（按 key）置为 cancelled，并按 serviceType 派发到已注册的服务句柄中止传输
  cancel(data: TaskItem) {
    setStore("items", i => i.key === data.key, "status", "cancelled")
    services.get(data.serviceType)?.cancel?.(data)
  },
  // TODO: FileService 暂无 pause/resume,当前仅翻转 store 状态、未暂停底层传输;待 FileService 支持后补接(经注册表 pause 句柄派发)。
  togglePause(data: TaskItem) {
    const idx = findIndex(data.key)
    if (idx < 0) return
    const next = store.items[idx].status === "paused" ? "in_progress" : "paused"
    setStore("items", idx, "status", next)
    services.get(data.serviceType)?.pause?.(data, next === "paused")
  },
}

// 内置 edm 服务注册(FileService 现仅支持 cancel，pause 待补)
TaskStore.registerService("edm_upload", {
  cancel: (item) => { if (item.fileIndex !== undefined) FileService.cancelUpload(item.taskId, item.fileIndex) },
})
TaskStore.registerService("edm_download", {
  cancel: (item) => FileService.cancelDownload(item.taskId),
})
