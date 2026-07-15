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
  rawRect: { top: number; left: number; width: number; height: number }
}

const STORAGE_PREFIX = "octo:pattern:annotations"

function annotationsFilePath(dir: string, sessionId: string, versionId: string) {
  return `${dir}/.octo/design/history/${sessionId}/${versionId}.annotations.json`
}

function attachmentPath(dir: string, sessionId: string, annotationId: string, filename: string) {
  return `${dir}/.octo/design/history/${sessionId}/annotations/${annotationId}/${filename}`
}

export async function loadAnnotations(dir: string, sessionId: string, versionId: string): Promise<AnnotationRecord[]> {
  const api = getDesktopApi()
  const path = annotationsFilePath(dir, sessionId, versionId)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return []
      return JSON.parse(new TextDecoder().decode(buf)) as AnnotationRecord[]
    } catch { return [] }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:${versionId}`)
  if (!stored) return []
  try { return JSON.parse(stored) as AnnotationRecord[] }
  catch { return [] }
}

export async function saveAnnotations(dir: string, sessionId: string, versionId: string, records: AnnotationRecord[]): Promise<void> {
  const payload = JSON.stringify(records, null, 2)
  const api = getDesktopApi()
  const path = annotationsFilePath(dir, sessionId, versionId)

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}:${versionId}`, payload)
}

export async function saveAttachment(
  dir: string, sessionId: string, annotationId: string,
  fileName: string, buffer: ArrayBuffer,
): Promise<{ fileName: string; id: string }> {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const savedName = `${crypto.randomUUID()}${ext}`
  const api = getDesktopApi()
  const path = attachmentPath(dir, sessionId, annotationId, savedName)

  if (api?.writeFileBuffer) await api.writeFileBuffer(path, buffer)
  return { fileName, id: savedName }
}
