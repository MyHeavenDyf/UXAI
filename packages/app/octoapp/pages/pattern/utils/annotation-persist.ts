import { getDesktopApi } from "./desktop-api"

export type AnnotationRecord = {
  id: string
  note: string
  selector: string
  attachments: Array<{
    fileName: string
    id: string
  }>
  time: number
  account: string
  userName: string
  rawRect: { top: number; left: number; width: number; height: number }
}

const STORAGE_PREFIX = "octo:pattern:annotations"

function annotationsFilePath(dir: string, sessionId: string) {
  return `${dir}/.octo/design/history/${sessionId}/annotations/annotations.json`
}

function attachmentPath(dir: string, sessionId: string, savedName: string) {
  return `${dir}/.octo/design/history/${sessionId}/annotations/uploads/${savedName}`
}

export async function loadAnnotations(dir: string, sessionId: string): Promise<AnnotationRecord[]> {
  const api = getDesktopApi()
  const path = annotationsFilePath(dir, sessionId)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return []
      return JSON.parse(new TextDecoder().decode(buf)) as AnnotationRecord[]
    } catch { return [] }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}`)
  if (!stored) return []
  try { return JSON.parse(stored) as AnnotationRecord[] }
  catch { return [] }
}

export async function saveAnnotations(dir: string, sessionId: string, records: AnnotationRecord[]): Promise<void> {
  const payload = JSON.stringify(records, null, 2)
  const api = getDesktopApi()
  const path = annotationsFilePath(dir, sessionId)
  console.log("[annotation-persist] saveAnnotations", { path, records: records.length, hasApi: !!api, hasWriteFileBuffer: !!api?.writeFileBuffer })

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    try {
      await api.writeFileBuffer(path, encoder.encode(payload).buffer)
      console.log("[annotation-persist] writeFileBuffer success", path)
    } catch (e) {
      console.error("[annotation-persist] writeFileBuffer failed", path, e)
    }
    return
  }
  console.log("[annotation-persist] no writeFileBuffer, using localStorage")
  localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}`, payload)
}

export async function saveAttachment(
  dir: string, sessionId: string, annotationId: string,
  fileName: string, buffer: ArrayBuffer,
): Promise<{ fileName: string; id: string }> {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const savedName = `${crypto.randomUUID()}${ext}`
  const api = getDesktopApi()
  const path = attachmentPath(dir, sessionId, savedName)

  if (api?.writeFileBuffer) await api.writeFileBuffer(path, buffer)
  return { fileName, id: savedName }
}
