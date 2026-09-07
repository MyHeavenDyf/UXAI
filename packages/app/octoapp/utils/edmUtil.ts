import type { UploadCallbacks, DownloadItem, DownloadCallbacks  } from "../edmFileServices/file-service"
import { FileService } from "../edmFileServices/file-service"
import type { TaskItem } from "../context/task"
import { TaskStore } from "../context/task"

export const EdmUtil = {
  upload: (fileData: FileList, callbacks: UploadCallbacks) => {
    const wrappedCallbacks: UploadCallbacks = {
      onInit: (taskId, files) => {
        const taskData: TaskItem[] = [];
        files.forEach((file, index) => {
          taskData.push({
            key: `${taskId}-${index}`,
            taskId,
            type: "upload",
            name: file.name,
            size: file.size,
            progress: 0,
            status: "pending",
            createdAt: Date.now(),
            fileIndex: index
          });
        });
        TaskStore.add(taskData)
        callbacks.onInit?.(taskId, files)
      },
      onProgress: (taskId, files) => {
        const taskData: TaskItem[] = [];
        files.forEach((file, index) => {
          taskData.push({
            key: `${taskId}-${index}`,
            taskId,
            type: "upload",
            name: file.name,
            size: file.size,
            progress: file.progress,
            status: "in_progress",
            fileIndex: index
          });
        });
        TaskStore.progress(taskData)
        callbacks.onProgress?.(taskId, files)
      },
      onFinish: (taskId, files) => {
        const taskData: TaskItem[] = [];
        files.forEach((file, index) => {
          taskData.push({
            key: `${taskId}-${index}`,
            taskId,
            type: "upload",
            name: file.name,
            size: file.size,
            progress: 100,
            status: "completed",
            fileIndex: index
          });
        });
        TaskStore.finish(taskData)
        callbacks.onFinish?.(taskId, files)
      },
      onError: (taskId, errors) => {
        const taskData: TaskItem[] = [];
        TaskStore.items().forEach((file) => {
          if (file.taskId === taskId) {
            taskData.push({
              key: file.key,
              taskId,
              type: "upload",
              name: file.name,
              size: file.size,
              progress: file.progress,
              status: "error",
              fileIndex: file.fileIndex
            });
          }
        });
        TaskStore.error(taskData)
        callbacks.onError?.(taskId, errors)
      },
    }
    return FileService.upload(fileData, wrappedCallbacks)
  },
  download: (fileData: Array<DownloadItem>, callbacks: DownloadCallbacks) => {
    const wrappedCallbacks: DownloadCallbacks = {
      onInit: (taskId, zipName) => {
        const name = fileData.length === 1 ? fileData[0].name : zipName;
        const size = fileData.reduce((acc, file) => acc + file.size, 0);
        TaskStore.add([{
          key: taskId,
          taskId,
          type: "download",
          name: name,
          size: size,
          progress: 0,
          status: "pending",
          createdAt: Date.now(),
          fileIndex: 0
        }])
        callbacks.onInit?.(taskId, zipName)
      },
      onProgress: (taskId, progress) => {
        const taskData: TaskItem[] = [];
        TaskStore.items().forEach((file) => {
          if (file.taskId === taskId) {
            taskData.push({
              key: taskId,
              taskId,
              type: "download",
              name: file.name,
              size: file.size,
              progress: progress,
              status: "in_progress",
              fileIndex: file.fileIndex
            });
          }
        });
        TaskStore.progress(taskData)
        callbacks.onProgress?.(taskId, progress)
      },
      onFinish: (taskId, data) => {
        const taskData: TaskItem[] = [];
        TaskStore.items().forEach((file) => {
          if (file.taskId === taskId) {
            taskData.push({
              key: taskId,
              taskId,
              type: "download",
              name: file.name,
              size: file.size,
              progress: 100,
              status: "completed",
              fileIndex: file.fileIndex
            });
          }
        });
        TaskStore.finish(taskData)
        callbacks.onFinish?.(taskId, data)
      },
      onError: (taskId, data) => {
        const taskData: TaskItem[] = [];
        TaskStore.items().forEach((file) => {
          if (file.taskId === taskId) {
            taskData.push({
              key: file.key,
              taskId,
              type: "download",
              name: file.name,
              size: file.size,
              progress: file.progress,
              status: "error",
              fileIndex: file.fileIndex
            });
          }
        });
        TaskStore.error(taskData)
        callbacks.onError?.(taskId, data)
      },
    }
    return FileService.download(fileData, wrappedCallbacks)
  },
  preview: (deliverableId: number) => {
    return FileService.preview(deliverableId)
  },
  edit: (deliverableId: number) => {
    return FileService.edit(deliverableId)
  }
}
