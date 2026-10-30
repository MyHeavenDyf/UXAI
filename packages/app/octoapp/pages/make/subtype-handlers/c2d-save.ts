import type { SubtypeHandlerContext } from './types'
import JSZip from 'jszip'

type DownloadData = { filename: string; base64: string }

async function folderExists(path: string, api: ReturnType<typeof import('../lib/electron-api').getDesktopApi>): Promise<boolean> {
  if (!api?.listDirectory) return false
  const parent = path.replace(/[/\\][^/\\]+$/, '')
  const items = await api.listDirectory(parent)
  if (!items) return false
  return items.some(item => item.path === path && item.type === 'directory')
}

export async function saveCanvasDownload(data: DownloadData, ctx: SubtypeHandlerContext): Promise<void> {
  const api = ctx.getDesktopApi()
  const baseDir = ctx.sdkDirectory
  const sid = ctx.sessionId
  const kind = ctx.workspaceKind

  if (!baseDir || (kind !== "code" && !sid) || !api?.writeFileBuffer) {
    ctx.showOctoToast({ title: "无法保存文件", variant: "error" })
    return
  }

  const uploadsDir = kind === "code" ? `${baseDir}` : `${baseDir}/.octo/${sid}/uploads`
  const lastDotIndex = data.filename.lastIndexOf('.')
  const baseName = lastDotIndex > 0 ? data.filename.slice(0, lastDotIndex) : data.filename
  const ext = lastDotIndex >= 0 ? data.filename.slice(lastDotIndex) : ''

  if (ext.toLowerCase() === '.zip' && api.listDirectory) {
    let folderName = baseName
    let folderPath = `${uploadsDir}/${folderName}`

    let counter = 0
    while (await folderExists(folderPath, api)) {
      counter++
      folderName = `${baseName} (${counter})`
      folderPath = `${uploadsDir}/${folderName}`
    }

    const buffer = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
    const zip = await JSZip.loadAsync(buffer)

    for (const [relativePath, file] of Object.entries(zip.files)) {
      if (!file.dir) {
        const content = await file.async('uint8array')
        await api.writeFileBuffer(`${folderPath}/${relativePath}`, content.buffer as ArrayBuffer)
      }
    }

    ctx.showOctoToast({ title: "已解压", description: folderName })
    ctx.onFilesRefresh?.()
    return
  }

  let finalFilename = data.filename

  if (api.fileExists) {
    let counter = 0
    while (await api.fileExists(`${uploadsDir}/${finalFilename}`)) {
      counter++
      finalFilename = `${baseName} (${counter})${ext}`
    }
  }

  const buffer = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
  await api.writeFileBuffer(`${uploadsDir}/${finalFilename}`, buffer.buffer as ArrayBuffer)
  ctx.showOctoToast({ title: "已保存", description: finalFilename })
}
