import { closestStudioAspectRatio } from "./turns"

export async function adjustStudioImageForEdit(
  sourceUrl: string,
  opts: { maxSize: number; maxDimension: number; minSide: number },
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Failed to load image for adjustment"))
    image.src = sourceUrl
  })
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("无法读取图片尺寸")
  const scale = Math.max(
    Math.min(1, opts.maxDimension / Math.max(img.naturalWidth, img.naturalHeight)),
    opts.minSide / Math.min(img.naturalWidth, img.naturalHeight),
  )
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  if (Math.max(w, h) > opts.maxDimension) throw new Error(`图片最大尺寸不能超过 ${opts.maxDimension}px`)

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0, w, h)

  // Compress if file size exceeds maxSize
  let quality = 0.92
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  while (blob && blob.size > opts.maxSize && quality > 0.1) {
    quality = Math.max(0.1, quality - 0.1)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  }

  if (!blob) throw new Error("图片处理失败，请重试")
  if (blob.size > opts.maxSize) throw new Error(`处理后的图片不能超过 ${opts.maxSize / 1024 / 1024}MiB`)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Failed to read adjusted image"))
    reader.readAsDataURL(blob)
  })
}

export async function prepareStudioUpscaleImage(source: string) {
  return prepareStudioImageOperation(source, "image.upscale")
}

export async function prepareStudioImageOperation(source: string, capability: "image.upscale" | "image.cutout" | "image.inpaint") {
  const sourceImage = await adjustStudioImageForEdit(source, {
    maxSize: (capability === "image.upscale" ? 20 : 8) * 1024 * 1024,
    maxDimension: 7500,
    minSide: capability === "image.inpaint" ? 300 : capability === "image.cutout" ? 50 : 0,
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error("无法读取处理后的图片"))
    element.src = sourceImage
  })
  return { sourceImage, aspectRatio: closestStudioAspectRatio(image.naturalWidth, image.naturalHeight) }
}

export async function resizeStudioCompositeImage(composite: string, source: string) {
  const images = await Promise.all([composite, source].map((url) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("无法读取智能重绘合成图"))
    image.src = url
  })))
  const canvas = document.createElement("canvas")
  canvas.width = images[1].naturalWidth
  canvas.height = images[1].naturalHeight
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建智能重绘画布")
  context.drawImage(images[0], 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/png")
}
