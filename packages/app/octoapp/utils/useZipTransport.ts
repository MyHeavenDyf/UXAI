// jk-j60099994-replace-with-1134603-start
export interface UploadZipResult {
  webview: string | null
  pixsoUrl?: string
}

export async function uploadZip(
  zipBlobFactory: () => Promise<Blob>,
  projectSelection: unknown
): Promise<UploadZipResult> {
  // Implemented by others - placeholder
  throw new Error("uploadZip not implemented")
}

// jk-j60099994-replace-with-1134603-end