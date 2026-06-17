import type { StudioAspectRatio, StudioCapability, StudioImageTool } from "./types"

export const STUDIO_CAPABILITIES: { id: StudioCapability; label: string; description: string; tone: string }[] = [
  { id: "image.generate", label: "图片生成", description: "创意无限，一图即成", tone: "#1267ff" },
  { id: "video.generate", label: "视频生成", description: "一键成片，AI演绎无限可能", tone: "#704cff" },
  { id: "image.upscale", label: "变清晰", description: "一键高清，AI还原真实质感", tone: "#00a6d6" },
  { id: "image.cutout", label: "抠图", description: "快速分离主体与背景", tone: "#111827" },
  { id: "image.inpaint", label: "智能重绘", description: "自由编辑，AI赋予局部创作能力", tone: "#00ad6f" },
  { id: "image.outpaint", label: "扩图", description: "保留主体，扩展更大尺寸和内容", tone: "#2563eb" },
  { id: "image.fusion", label: "场景融合", description: "融合主体、风格和空间氛围", tone: "#c026d3" },
]

export const STUDIO_STYLE_MODELS = [
  { id: "seedream-5-lite", label: "Seedream 5.0 Lite", color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  { id: "qwen", label: "千问", color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  { id: "bd-icon", label: "BDIcon", color: "linear-gradient(135deg, #5eead4, #3b82f6)" },
  { id: "portrait", label: "质感人像", color: "linear-gradient(135deg, #f59e0b, #fde68a)" },
  { id: "developer", label: "开发者人物形象", color: "linear-gradient(135deg, #e5e7eb, #ffffff)" },
  { id: "xiaoyi", label: "小艺agent", color: "linear-gradient(135deg, #f9a8d4, #7dd3fc)" },
  { id: "smart-3d", label: "智慧3D", color: "linear-gradient(135deg, #a7f3d0, #bfdbfe)" },
  { id: "abstract", label: "抽象几何背景", color: "linear-gradient(135deg, #60a5fa, #dbeafe)" },
  { id: "yunbao", label: "云宝", color: "linear-gradient(135deg, #fef3c7, #f0abfc)" },
  { id: "hdesign", label: "H Design 3D", color: "linear-gradient(135deg, #bae6fd, #ffffff)" },
  { id: "hongmeng", label: "鸿蒙插画", color: "linear-gradient(135deg, #fed7aa, #fecaca)" },
  { id: "hdesign-illustration", label: "H Design插画", color: "linear-gradient(135deg, #93c5fd, #f5f3ff)" },
  { id: "3d-abstract", label: "3D抽象元素", color: "linear-gradient(135deg, #cffafe, #ddd6fe)" },
].map((item, index) => ({ ...item, iconIndex: item.id === "seedream-5-lite" ? 1 : index }))

export const STUDIO_ASPECT_RATIOS: StudioAspectRatio[] = ["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"]

export const STUDIO_IMAGE_TOOLS: { id: StudioImageTool; label: string; description: string }[] = [
  { id: "internel", label: "内部", description: "内部门户生图工具" },
  { id: "jimeng", label: "即梦", description: "默认的即梦生图工具" },
]

export function capabilityLabel(id: StudioCapability) {
  return STUDIO_CAPABILITIES.find((item) => item.id === id)?.label ?? "图片生成"
}

export function styleModelLabel(id: string) {
  return STUDIO_STYLE_MODELS.find((item) => item.id === id)?.label ?? "千问"
}

export function imageToolLabel(id: StudioImageTool) {
  return STUDIO_IMAGE_TOOLS.find((item) => item.id === id)?.label ?? "内部"
}
