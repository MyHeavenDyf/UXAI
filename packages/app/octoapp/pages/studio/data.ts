import type { StudioAspectRatio, StudioCapability, StudioImageTool } from "./types"
import { boardReferenceLimit } from "@opencode-ai/core/studio-board"
import { STUDIO_STYLE_MODEL_CONFIG, findStudioStyleModel, studioStyleModelIdentity } from "@opencode-ai/core/studio/model-availability"

export const STUDIO_CAPABILITIES: { id: StudioCapability; label: string; description: string; tone: string }[] = [
  { id: "image.generate", label: "图片生成", description: "创意无限，一图即成", tone: "#1267ff" },
  { id: "video.generate", label: "视频生成", description: "一键成片，AI演绎无限可能", tone: "#704cff" },
  { id: "image.upscale", label: "变清晰", description: "一键高清，AI还原真实质感", tone: "#00a6d6" },
  { id: "image.cutout", label: "抠图", description: "快速分离主体与背景", tone: "#111827" },
  { id: "image.inpaint", label: "智能重绘", description: "自由编辑，AI赋予局部创作能力", tone: "#00ad6f" },
  { id: "image.outpaint", label: "扩图", description: "保留主体，扩展更大尺寸和内容", tone: "#2563eb" },
  { id: "image.fusion", label: "场景融合", description: "融合主体、风格和空间氛围", tone: "#c026d3" },
]

const styleModelPresentation: Record<string, { icon: string; color: string }> = {
  "seedream-5-pro": { icon: "/studio/studio_seedream_v2.svg", color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  qwen: { icon: "/studio/studioModel1.png", color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  "bd-icon": { icon: "/studio/studioModel2.png", color: "linear-gradient(135deg, #5eead4, #3b82f6)" },
  portrait: { icon: "/studio/studioModel3.png", color: "linear-gradient(135deg, #f59e0b, #fde68a)" },
  developer: { icon: "/studio/studioModel4.png", color: "linear-gradient(135deg, #e5e7eb, #ffffff)" },
  xiaoyi: { icon: "/studio/studioModel5.png", color: "linear-gradient(135deg, #f9a8d4, #7dd3fc)" },
  "smart-3d": { icon: "/studio/studioModel6.png", color: "linear-gradient(135deg, #a7f3d0, #bfdbfe)" },
  abstract: { icon: "/studio/studioModel7.png", color: "linear-gradient(135deg, #60a5fa, #dbeafe)" },
  yunbao: { icon: "/studio/studioModel8.png", color: "linear-gradient(135deg, #fef3c7, #f0abfc)" },
  hdesign: { icon: "/studio/studioModel13.svg", color: "linear-gradient(135deg, #bae6fd, #ffffff)" },
  hongmeng: { icon: "/studio/studioModel10.png", color: "linear-gradient(135deg, #fed7aa, #fecaca)" },
  "hdesign-illustration": { icon: "/studio/studioModel14.svg", color: "linear-gradient(135deg, #93c5fd, #f5f3ff)" },
  "3d-abstract": { icon: "/studio/studioModel12.png", color: "linear-gradient(135deg, #cffafe, #ddd6fe)" },
}

export const STUDIO_STYLE_MODELS = STUDIO_STYLE_MODEL_CONFIG.map((model) => ({ ...model, ...styleModelPresentation[model.id] }))

export const STUDIO_ASPECT_RATIOS: StudioAspectRatio[] = ["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"]

export const STUDIO_IMAGE_TOOLS: { id: StudioImageTool; label: string; description: string }[] = [
  { id: "internel", label: "内部", description: "内部门户生图工具" },
  { id: "jimeng", label: "即梦", description: "默认的即梦生图工具" },
]

export function capabilityLabel(id: StudioCapability) {
  return STUDIO_CAPABILITIES.find((item) => item.id === id)?.label ?? "图片生成"
}

export function styleModelLabel(id: string) {
  return studioStyleModelIdentity(id)?.label ?? (id || "千问")
}

export function styleModelId(value?: string) {
  return studioStyleModelIdentity(value)?.id
}

export function isStyleModelAvailable(value?: string) {
  return Boolean(findStudioStyleModel(value))
}

export function styleModelRequiresSeedreamPermission(id: string) {
  return studioStyleModelIdentity(id)?.requiresSeedreamPermission === true
}

export function isSeedreamStyleModel(value?: string) {
  const id = styleModelId(value)
  return id === "seedream-5-lite" || id === "seedream-5-pro"
}

export function referenceImageLimit(styleModel: string) {
  return boardReferenceLimit(styleModelId(styleModel) ?? "")
}

export function imageToolLabel(id: StudioImageTool) {
  return STUDIO_IMAGE_TOOLS.find((item) => item.id === id)?.label ?? "内部"
}
