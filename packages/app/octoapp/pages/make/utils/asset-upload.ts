/**
 * 资产库上传传输（Make 页下载按钮「保存到资产库(全页面/局部)」）。
 *
 * 机制：上传弹窗（asset-upload-dialog.tsx）内嵌 iframe 加载
 * `<base>/agentPage/asset-upload/<productId>`，用户点确认后把 ZIP blob 转 base64
 * postMessage({type:'uploadFiles'}) 给 iframe，等待 iframe 回发
 * {type:'uploadFilesResult', success}（event.source + origin 双校验）。
 */

export interface AssetUploadResult {
  success: boolean
  message?: string
}

export function assetUploadBaseUrl(): string {
  return import.meta.env.VITE_OCTO_BASE_URL || ""
}

export function isAssetLibraryLoggedIn(): boolean {
  return !!localStorage.getItem("uiplusToken")
}

/** ZIP blob → 纯 base64 字符串（剥 data: 前缀） */
export function zipBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? "")
      const idx = s.indexOf(";base64,")
      resolve(idx >= 0 ? s.slice(idx + ";base64,".length) : s)
    }
    reader.onerror = () => reject(reader.error ?? new Error("readAsDataURL failed"))
    reader.readAsDataURL(blob)
  })
}

const RESULT_TIMEOUT_MS = 60_000
const FILE_NAME_MAX_LEN = 200

/**
 * css selector → base64url。
 */
export function encodeSelectorToBase64Url(selector: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(selector)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * 文件名清洁+ 控制字符 → `~`，合并连续 `~`，
 * 截断 200 字符，剥尾部点/空格、前导 `~`）。files.name 兜底：覆盖用户
 * 编辑的任意内容、LLM 页面名脏字符、超长名称。
 */
export function sanitizeAssetFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, "~")
      .replace(/~{2,}/g, "~")
      .slice(0, FILE_NAME_MAX_LEN)
      .trim()
      .replace(/[.\s]+$/, "")
      .replace(/^[~\s]+/, "")
      .trim() || "untitled"
  )
}

/** 把已编码的文件 postMessage 给上传弹窗内的 iframe，等待 uploadFilesResult（超时 60s） */
export async function sendFilesToAssetIframe(
  iframe: HTMLIFrameElement,
  options: { name: string; base64: string },
  timeoutMs: number = RESULT_TIMEOUT_MS,
): Promise<AssetUploadResult> {
  const baseUrl = assetUploadBaseUrl()
  if (!isAssetLibraryLoggedIn()) return { success: false, message: "未登录" }
  if (!baseUrl) return { success: false, message: "未配置资产库服务地址" }
  const targetOrigin = new URL(baseUrl).origin

  return await new Promise<AssetUploadResult>((resolve) => {
    let settled = false
    const timer = setTimeout(() => finish({ success: false, message: "保存超时" }), timeoutMs)
    const finish = (result: AssetUploadResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve(result)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      if (event.origin !== targetOrigin) return
      const d = event.data
      if (!d || d.type !== "uploadFilesResult") return
      finish({
        success: !!d.success,
        message: typeof d.message === "string" ? d.message : undefined,
      })
    }
    window.addEventListener("message", onMessage)
    iframe.contentWindow?.postMessage(
      {
        type: "uploadFiles",
        files: [{ name: sanitizeAssetFileName(options.name), base64: options.base64, mimeType: "application/zip" }],
      },
      targetOrigin,
    )
  })
}
