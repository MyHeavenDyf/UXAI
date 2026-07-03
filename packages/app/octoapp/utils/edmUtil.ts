import type { UploadCallbacks, DownloadItem, DownloadCallbacks  } from "../edmFileServices/file-service"
import { FileService } from "../edmFileServices/file-service"

export const EdmUtil = {
  upload: (fileData: FileList, callbacks: UploadCallbacks) => {
    return FileService.upload(fileData, callbacks)
  },
  download: (fileData: Array<DownloadItem>, callbacks: DownloadCallbacks) => {
    return FileService.download(fileData, callbacks)
  },
  preview: (deliverableId: number) => {
    return FileService.preview(deliverableId)
  },
  edit: (deliverableId: number) => {
    return FileService.edit(deliverableId)
  }
}
