// jk-j60099994-replace-with-1134603-start
export interface UploadResult {
  webview: HTMLElement | null
  pixsoUrl?: string | null
  pixsoMessage?: string | null
}

export type ZipProvider = () => Promise<Blob | File>

export interface UploadZipOptions {
  getZip: ZipProvider
  downloadHtml?: (data: { filename: string; base64: string}) => Promise<void>,
  config: {
    designName: string,
    sessionId: string
  }
}

export interface OpenFilePageResult {
  success: boolean,
  url?: string,
  message?: string
}

export interface UsePixsoTransportResult {
  uploadResult: UploadResult,
  actions: PixsoAction[]
}

export interface PixsoAction {
  label: string;
  fn: (options: UploadZipOptions) => Promise<UploadResult | OpenFilePageResult>
}

export async function usePixsoTransport(
  options: UploadZipOptions
): Promise<UsePixsoTransportResult> {
  // Implemented by others - placeholder
  // throw new Error("uploadZip not implemented")
  return {
    uploadResult: {
      webview: null
    },
    actions: [{
      label: '导入到画板',
      fn: async (ops) => {
        console.log('导入到画板', ops)
        return {
          webview: null
        }
      }
    }, {
      label: '打开画布',
      fn: async (ops) => {
        console.log('打开画布', ops)
        return {
          success: true
        }
      }
    }, {
      label: '查看文件位置',
      fn: async (ops) => {
        console.log('查看文件位置', ops)
        return {
          success: true,
        }
      }
    }]
  }
}



// jk-j60099994-replace-with-1134603-end