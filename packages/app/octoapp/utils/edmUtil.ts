import { FileService } from "../edmFileServices/file-service"

type FileStatus = {
  statusCode: number
  message: string
}

type UploadFileInfo = {
  index: number
  cacheSign: string
  progress: number
  name: string
  type: string
  size: number
  lastModified: number
  status: FileStatus
}

type UploadInitData = Array<{
  index: number
  cacheSign: string
  progress: number
  name: string
  type: string
  size: number
  lastModified: number
  status: FileStatus
}>

type UploadProgressFileInfo = {
  index: number
  cacheSign: string
  name: string
  type: string
  size: number
  lastModified: number
  status: FileStatus
}

type UploadProgressData = Array<{
  cacheSign: string
  progress: number
  file: UploadProgressFileInfo
}>

type UploadFinishData = Array<{
  cacheSign: string
  progress: number
  file: UploadProgressFileInfo
}>

type UploadCallbacks = {
  onInit: (taskId: string, data: UploadInitData) => void
  onProgress: (taskId: string, data: UploadProgressData) => void
  onFinish: (taskId: string, data: UploadFinishData) => void
  onError: (taskId: string, data: { status: number; message: string }) => void
}

type DownloadItem = {
  docId: string
  docVersion?: string
}

type DownloadCallbacks = {
  onProgress: (taskId: string, progress: string) => void
  onFinish: (taskId: string, data: unknown) => void
  onError: (taskId: string, data: { status: number; message: string }) => void
}

export namespace EdmUtil {
  export function upload(fileData: FileList, callbacks: UploadCallbacks) {
    return FileService.upload(fileData, callbacks)
  }

  export function download(fileData: Array<DownloadItem>, callbacks: DownloadCallbacks) {
    return FileService.download(fileData, callbacks)
  }

  export function preview(deliverableId: number) {
    return FileService.preview(deliverableId)
  }

  export function edit(deliverableId: number) {
    return FileService.edit(deliverableId)
  }
}
