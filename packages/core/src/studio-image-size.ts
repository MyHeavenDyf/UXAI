export function getModelResolutionKey(model: string) {
  if (model === "hdesign") return "hdesign"
  if (["seedream-5-pro", "seedream-5-lite"].includes(model)) return "2k"
  if (model.includes("2k")) return "2k"
  if (model.includes("3k")) return "3k"
  if (model.includes("4k")) return "4k"
  return "default"
}

export function getStudioImageAreaLimits(model: string) {
  if (model === "seedream-5-pro")
    return { min: 1280 * 720, max: Math.floor(2048 * 2048 * 1.1025), label: "1280×720, 2048×2048×1.1025" }
  const key = getModelResolutionKey(model)
  if (key === "default" || key === "hdesign" || model === "qwen") return
  return { min: 2560 * 1440, max: Math.round(3072 * 3072 * 1.1025), label: "2560×1440, 3072×3072×1.1025" }
}

export function isStudioCustomSizeValid(model: string, width?: number, height?: number) {
  if (width === undefined || height === undefined || !Number.isSafeInteger(width) || !Number.isSafeInteger(height))
    return false
  if (width <= 0 || height <= 0) return false
  const limits = getStudioImageAreaLimits(model)
  if (limits)
    return (
      width * height >= limits.min && width * height <= limits.max && width / height >= 1 / 16 && width / height <= 16
    )
  const max = model === "qwen" ? 1664 : 2500
  return width >= 250 && width <= max && height >= 250 && height <= max
}
