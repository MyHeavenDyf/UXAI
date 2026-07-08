export function truncateFilenameWithExt(filename: string, maxLen: number = 20): string {
  if (filename.length <= maxLen) return filename

  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) {
    return filename.slice(0, maxLen - 3) + '...'
  }

  const ext = filename.slice(lastDot)
  const namePart = filename.slice(0, lastDot)

  const available = maxLen - ext.length - 3
  if (available <= 0) {
    return '...' + ext
  }

  const keepStart = Math.ceil(available / 2)
  const keepEnd = Math.floor(available / 2)

  return namePart.slice(0, keepStart) + '...' + namePart.slice(-keepEnd) + ext
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}