import z from "zod"

export const STUDIO_OUTPAINT_RATIOS = ["1:1", "9:16", "16:9"] as const
export type StudioOutpaintRatio = (typeof STUDIO_OUTPAINT_RATIOS)[number]
export const STUDIO_OUTPAINT_PROMPT = "保留主体和画面风格，扩展更大尺寸和更多环境内容"
export const StudioOutpaintMetrics = z.object({
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  left: z.number().int().nonnegative(),
  right: z.number().int().nonnegative(),
  top: z.number().int().nonnegative(),
  bottom: z.number().int().nonnegative(),
  realWidth: z.number().int().positive(),
  realHeight: z.number().int().positive(),
})
export type StudioOutpaintMetrics = z.infer<typeof StudioOutpaintMetrics>

export function studioOutpaintMetricsError(input: StudioOutpaintMetrics) {
  if (!StudioOutpaintMetrics.safeParse(input).success) return "扩图尺寸和边距必须是有效像素值"
  if (![input.left, input.right, input.top, input.bottom].some((value) => value > 0)) return "请先扩展至少一个方向"
  if (
    input.realWidth !== input.sourceWidth + input.left + input.right ||
    input.realHeight !== input.sourceHeight + input.top + input.bottom
  )
    return "扩图目标尺寸与边距不一致"
}

export function scaleStudioOutpaintMetrics(input: StudioOutpaintMetrics, width: number, height: number) {
  const error = studioOutpaintMetricsError(input)
  if (error) throw new Error(error)
  const left = Math.round((input.left * width) / input.sourceWidth)
  const right = Math.round((input.right * width) / input.sourceWidth)
  const top = Math.round((input.top * height) / input.sourceHeight)
  const bottom = Math.round((input.bottom * height) / input.sourceHeight)
  const result = StudioOutpaintMetrics.parse({
    sourceWidth: width,
    sourceHeight: height,
    left,
    right,
    top,
    bottom,
    realWidth: width + left + right,
    realHeight: height + top + bottom,
  })
  if (studioOutpaintMetricsError(result)) throw new Error("扩展范围过小，请增大扩图范围后重试")
  return result
}
