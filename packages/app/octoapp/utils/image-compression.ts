// 超限图片自动压缩(design 页上传链路,微信式静默压缩):
// 长边按 ≈0.8 步进逐档下探(4096→…→1024,首档不放大、取原图尺寸),每档只降质量到 0.75——清晰度优先,
// 完整质量阶梯(0.85→0.45)仅在最后一档兜底,避免大图被压到 1024@0.45 的糊状观感。
// 缩放走逐级减半采样(每步 ≤0.5 + imageSmoothingQuality high),大比例一步缩放会明显丢细节。
// 产物保持原格式:png→png(无损,quality 被 toBlob 忽略,只靠降尺寸)、jpg/jpeg→jpeg、webp→webp;
// 白名单外格式(如 bmp)统一 jpeg。扩展名随实际字节同步,避免 mime 错配(见 upload.ts IMAGE_MIME 注)。
// 返回 null:GIF(canvas 会丢动画)、解码失败、到最后一档且质量 0.45 仍超限——由调用方回退超限报错。
export async function compressImageFile(file: File, maxSizeBytes: number): Promise<File | null> {
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
  const format = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
  const maxEdge = Math.max(bitmap.width, bitmap.height)
  // 逐档下探的长边序列:上限不超原图(不放大重采样);小图(<1024)只留原始尺寸一档,靠质量兜底
  const levels = Array.from(new Set([4096, 3200, 2560, 2048, 1600, 1280, 1024].map((level) => Math.min(level, maxEdge))))
  let compressed: Blob | null = null

  for (const [index, level] of levels.entries()) {
    const canvas = drawProgressively(bitmap, level)
    const qualities = format === "image/png" ? [undefined]
      : index === levels.length - 1 ? [0.85, 0.75, 0.65, 0.55, 0.45]
      : [0.85, 0.75]
    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality))
      if (blob && blob.size <= maxSizeBytes) {
        compressed = blob
        break
      }
    }
    if (compressed) break
  }
  bitmap.close()

  if (!compressed) return null
  const targetExt = format === "image/jpeg" ? (ext === "jpeg" ? "jpeg" : "jpg") : ext
  return new File([compressed], `${dot > 0 ? file.name.slice(0, dot) : file.name}.${targetExt}`, { type: compressed.type })
}

/** 逐级减半采样:先把长边每步 0.5 降到目标附近(保细节),最后一步画到位;全程 high 平滑质量。 */
function drawProgressively(bitmap: ImageBitmap, longEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  let source: ImageBitmap | HTMLCanvasElement = bitmap
  let sourceWidth = bitmap.width
  let sourceHeight = bitmap.height
  while (Math.floor(sourceWidth / 2) >= width) {
    const half = document.createElement("canvas")
    half.width = Math.floor(sourceWidth / 2)
    half.height = Math.floor(sourceHeight / 2)
    const context = half.getContext("2d")!
    context.imageSmoothingQuality = "high"
    context.drawImage(source, 0, 0, half.width, half.height)
    source = half
    sourceWidth = half.width
    sourceHeight = half.height
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")!
  context.imageSmoothingQuality = "high"
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}
