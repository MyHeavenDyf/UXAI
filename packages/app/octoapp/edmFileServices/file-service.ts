
export type FileInfo = {
  index: number
  name: string
  type: string
  size: number
  lastModified: number 
}

export interface FileStatus extends FileInfo {
  cacheSign: string
  progress: number
  status: {
    statusCode: number
    message: string
  }
}
export interface UploadedFile extends FileStatus {
    docId: string
    docVersion: string
}

export interface ServiceError {
  status: number
  message: string
}

export type UploadCallbacks = {
  onInit?: (taskId: string, files: FileStatus) => void
  onProgress?: (taskId: string, files: { cacheSign: string; progress: number; file: FileStatus}[]) => void
  onFinish?: (taskId: string, files: UploadedFile[]) => void
  onError?: (taskId: string, errors: ServiceError) => void
}

export type DownloadItem = {
  docId: string
  docVersion?: string
}

export type DownloadCallbacks = {
  onProgress: (taskId: string, progress: number) => void
  onFinish?: (taskId: string, data: unknown) => void
  onError?: (taskId: string, data: ServiceError) => void
}

export const FileService = {
    upload: (fileData: FileList, callbacks: UploadCallbacks) => {
        console.log("Uploading files:", fileData);
    },
    download: (fileData: Array<DownloadItem>, callbacks: DownloadCallbacks) => {
        console.log("Downloading files:", fileData);
    },
    preview: (deliverableId: number) => {
        console.log("Previewing deliverable with ID:", deliverableId);
    },
    edit: (deliverableId: number) => {
        console.log("Editing deliverable with ID:", deliverableId);
    }
}
