// 超限图片自动压缩(design 页上传链路,微信式静默压缩):
// 先限长边(4096 逐级减半至 1024),每档内质量 0.85→0.45 递减,直到体积 ≤ maxSizeBytes。
// png/webp → webp(保透明),其余 → jpeg;扩展名随实际字节同步,避免 mime 错配(见 upload.ts IMAGE_MIME 注)。
// opts.webp=false 时 png 也压成 jpeg(外网模型白名单无 webp)。
// 返回 null:GIF(canvas 会丢动画)、解码失败、尺寸/质量到地板仍超限——由调用方回退超限报错。
export async function compressImageFile(file: File, maxSizeBytes: number, opts?: { webp?: boolean }): Promise<File | null> {
  if (file.size <= maxSizeBytes) return file
  const dot = file.name.lastIndexOf(".")
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ""
  if (ext === "gif" || file.type === "image/gif") return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    return null
  }
  const format = opts?.webp !== false && (ext === "png" || ext === "webp") ? "image/webp" : "image/jpeg"
  let compressed: Blob | null = null
  let longEdge = 4096

  while (!compressed && longEdge >= 1024) {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    for (let quality = 0.85; quality >= 0.4; quality -= 0.1) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality))
      if (blob && blob.size <= maxSizeBytes) {
        compressed = blob
        break
      }
    }
    longEdge = Math.floor(longEdge / 2)
  }
  bitmap.close()

  if (!compressed) return null
  const targetExt = compressed.type === "image/webp" ? "webp" : "jpg"
  return new File([compressed], `${dot > 0 ? file.name.slice(0, dot) : file.name}.${targetExt}`, { type: compressed.type })
}
