
export interface UploadInitItem {
  index: number
  cacheSign: string
  progress: number
  name: string
  size: number
  lstatus: {
    statusCode: number
    message: string
  } 
}

export interface UploadProgressItem {
  cacheSign: string
  progress: number
  name: string
  size: number
  file: {
    index: number
    cacheSign: string
    progress: number
    status: {
        statusCode: number
        message: string
    }
  }
}
export interface UploadFinishItem {
    cacheSign: string
    progress: number
    name: string
    size: number
    docId: string
    version: string
    file: {
        index: number
        cacheSign: string
        progress: number
        docId: string
        version: string
        status: {
            statusCode: number
            message: string
        }
    }
}

export interface ServiceError {
  status: number
  message: string
}

export type UploadCallbacks = {
  onInit?: (taskId: string, files: UploadInitItem[]) => void
  onProgress?: (taskId: string, files: UploadProgressItem[]) => void
  onFinish?: (taskId: string, files: UploadFinishItem[]) => void
  onError?: (taskId: string, errors: ServiceError) => void
}

export type DownloadItem = {
  name: string
  size: number
  docId: string
  docVersion?: string
}

export type DownloadCallbacks = {
  onInit?: (taskId: string, zipName: string) => void
  onProgress?: (taskId: string, progress: number) => void
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
    },
    cancelUpload: (taskId: string, index: number) => {
        console.log("Cancelling task with ID:", taskId, index);
    },
    cancelDownload: (taskId: string) => {
        console.log("Cancelling download task with ID:", taskId);
    }
}
