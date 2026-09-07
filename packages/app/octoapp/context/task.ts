import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { FileService } from "../edmFileServices/file-service"

type TaskStatus = "pending" | "in_progress" | "completed" | "error" | "cancelled"

export type TaskItem = {
  key: string
  taskId: string
  type: "upload" | "download"
  name: string
  size: number
  progress: number
  status: TaskStatus
  docId?: string
  version?: string
  cacheSign?: string
  createdAt?: number
  fileIndex?: number
}

const [store, setStore] = createStore({ items: [] as TaskItem[] })

if (import.meta.env.DEV) {
  const now = Date.now()
  setStore("items", [
    { key: "upload-demo-1-0", taskId: "upload-demo-1", type: "upload", name: "设计稿v3.fig", size: 25 * 1024 * 1024, progress: 67, status: "in_progress", createdAt: now - 5000, fileIndex: 0 },
    { key: "upload-demo-1-1", taskId: "upload-demo-1", type: "upload", name: "产品需求文档.pdf", size: 3.2 * 1024 * 1024, progress: 100, status: "completed", createdAt: now - 5000, fileIndex: 1 },
    { key: "upload-demo-2-0", taskId: "upload-demo-2", type: "upload", name: "原型图.png", size: 8 * 1024 * 1024, progress: 23, status: "in_progress", createdAt: now - 3000, fileIndex: 0 },
    { key: "download-demo-1", taskId: "download-demo-1", type: "download", name: "项目交付包.zip", size: 0, progress: 45, status: "in_progress", createdAt: now - 2000 },
    { key: "download-demo-2", taskId: "download-demo-2", type: "download", name: "源码备份.tar.gz", size: 0, progress: 100, status: "completed", createdAt: now - 10000 },
    { key: "upload-demo-3-0", taskId: "upload-demo-3", type: "upload", name: "接口文档.md", size: 512 * 1024, progress: 0, status: "pending", createdAt: now - 500, fileIndex: 0 },
    { key: "download-demo-3", taskId: "download-demo-3", type: "download", name: "数据库备份.sql", size: 0, progress: 0, status: "pending", createdAt: now - 500 },
  ])
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const activeItems = createMemo(() =>
  store.items.filter(i => i.status === "in_progress" || i.status === "pending")
)

const errorItems = createMemo(() =>
  store.items.filter(i => i.status === "error")
)

const completedItems = createMemo(() =>
  store.items.filter(i => i.status === "completed")
)

function findIndex(key: string) {
  return store.items.findIndex(i => i.key === key)
}

export const TaskStore = {
  items: () => store.items,
  activeItems,
  errorItems,
  activeCount: createMemo(() => activeItems().length),
  completedItems,
  formatFileSize,
  add(data: Array<TaskItem>) {
    setStore("items", prev => [...prev, ...data])
  },
  progress(data: Array<TaskItem>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx >= 0) setStore("items", idx, { progress: u.progress, status: u.status })
    }
  },
  finish(data: Array<TaskItem>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx >= 0) setStore("items", idx, { progress: u.progress, status: u.status })
    }
  },
  error(data: Array<TaskItem>) {
    for (const u of data) {
      const idx = findIndex(u.key)
      if (idx >= 0) setStore("items", idx, { status: u.status })
    }
  },
  cancel(data: TaskItem) {
    setStore(
      "items",
      i => i.taskId === data.taskId,
      "status",
      "cancelled"
    )
    if (data.type === "upload" && data.fileIndex !== undefined) FileService.cancelUpload(data.taskId, data.fileIndex)
    if (data.type === "download") FileService.cancelDownload(data.taskId)
  },
  removeFinished() {
    setStore("items", prev => prev.filter(i => i.status !== "completed" && i.status !== "error" && i.status !== "cancelled"))
  },
}
