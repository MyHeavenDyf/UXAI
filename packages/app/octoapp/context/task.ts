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
