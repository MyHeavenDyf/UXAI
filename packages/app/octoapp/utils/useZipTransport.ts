// jk-j60099994-replace-with-1134603-start
export interface UploadZipOptions {
  containerId: string
  deathDay: number
  limitTimes: number
}

export interface UploadZipResult {
  webview: string | null
  code: string
  onMessage: (event: string, callback: () => void) => void
}

export async function uploadZip(
  zipBlob: Blob,
  options: UploadZipOptions,
  projectSelection: unknown
): Promise<UploadZipResult> {
  // Implemented by others - placeholder
  throw new Error("uploadZip not implemented")
}

// jk-j60099994-replace-with-1134603-end