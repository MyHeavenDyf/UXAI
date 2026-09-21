export function extractSubtypeFromFilename(filename: string): string | undefined {
  const parts = filename.split('.')
  if (parts.length >= 3) {
    return parts[parts.length - 2]
  }
  return undefined
}

export function extractSubtypeFromTitle(title: string): string | undefined {
  const cleanTitle = title.replace(/\.(html|md|json|svg|txt)$/i, '')
  const parts = cleanTitle.split('.')
  if (parts.length >= 2) {
    return parts[parts.length - 1]
  }
  return undefined
}