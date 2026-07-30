import type { UploadCallbacks, DownloadItem, DownloadCallbacks } from "../edmFileServices/file-service"
import { FileService } from "../edmFileServices/file-service"

// EdmUtil 仅作 FileService 的薄封装,不感知 TaskStore —— 任务列表的 add/progress/finish/error
// 由具体业务(如归档)在自己的回调里调用,见 pages/insight/components/archive-flow.tsx。

export const EdmUtil = {
  upload: (fileData: FileList, callbacks: UploadCallbacks) => FileService.upload(fileData, callbacks),
  download: (fileData: Array<DownloadItem>, callbacks: DownloadCallbacks) => FileService.download(fileData, callbacks),
  preview: (deliverableId: number) => FileService.preview(deliverableId),
  edit: (deliverableId: number) => FileService.edit(deliverableId),
}
