/**
 * 从 artifact title 提取子类型
 * 规则：name.subtype（不含主扩展名）
 * 例如：index.shadcn → "shadcn"
 * 例如：button.shadcn → "shadcn"
 */
export function extractSubtypeFromTitle(title: string): string | undefined {
  const parts = title.split('.')
  if (parts.length >= 2) {
    return parts[parts.length - 1]
  }
  return undefined
}

/**
 * 从文件名提取子类型
 * 规则：name.subtype.ext → subtype
 * 例如：index.shadcn.html → "shadcn"
 */
export function extractSubtypeFromFilename(filename: string): string | undefined {
  const parts = filename.split('.')
  if (parts.length >= 3) {
    return parts[parts.length - 2]
  }
  return undefined
}