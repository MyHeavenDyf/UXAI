import type { StudioStyleTemplateListItem } from "./studio-style-template-menu"
import { styleModelId } from "./data"

export type StudioStyleDimensionId =
  | "tonal"
  | "composition"
  | "volume"
  | "surface"
  | "color"
  | "linework"
  | "shape_structure"
  | "role_design"
  | "lettering"
  | "post_processing"
export type StudioStyleDescriptionFieldId = "overview" | StudioStyleDimensionId
export type StudioTemplateStyleDescription = {
  overview: string
} & Partial<Record<StudioStyleDimensionId, string>>

export const STUDIO_STYLE_TEMPLATE_DIMENSIONS = [
  {
    id: "tonal",
    label: "明暗",
    placeholder: "描述图片的明暗特征，包括整体亮度倾向、对比范围、层次丰富程度。",
  },
  {
    id: "composition",
    label: "构图",
    placeholder: "描述图片的构图特征，包括透视类型、背景处理方式、负空间、景深、视觉层级，以及画面的整体节奏感。",
  },
  {
    id: "volume",
    label: "体积感",
    placeholder: "描述图片的形体立体感，包括物体表面的过渡方式、过渡的边缘特征，以及形体边界的质量。",
  },
  {
    id: "surface",
    label: "表面质感",
    placeholder: "描述图片中物体的表面属性，包括质感、纹理特征、细节密度、工艺痕迹",
  },
  {
    id: "color",
    label: "色彩",
    placeholder: "描述图片的色彩系统，包括主导色、背景色、饱和度分布、点缀色",
  },
  {
    id: "linework",
    label: "线条",
    placeholder: "描述线条与笔触特征",
  },
  {
    id: "shape_structure",
    label: "造型特征",
    placeholder: "描述形状语言与造型构造",
  },
  {
    id: "role_design",
    label: "角色形象",
    placeholder: "描述角色或生物的造型设计，包括人物比例特征以及整体形态语言风格",
  },
  {
    id: "lettering",
    label: "字体",
    placeholder: "描述文字或者字体设计",
  },
  {
    id: "post_processing",
    label: "后期效果",
    placeholder: "描述后期处理效果",
  },
] satisfies { id: StudioStyleDimensionId; label: string; placeholder: string }[]

export const STUDIO_STYLE_TEMPLATE_DESCRIPTION_FIELDS = [
  { id: "overview", label: "概述" },
  ...STUDIO_STYLE_TEMPLATE_DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
  })),
] satisfies { id: StudioStyleDescriptionFieldId; label: string }[]

export function splitStyleTemplatePlayDescription(text: string) {
  const start = text.indexOf("【")
  if (start < 0) return { prefix: text, placeholder: "输入内容", suffix: "" }

  const chars = Array.from(text)
  const startIndex = chars.findIndex((char) => char === "【")
  const endIndex = chars
    .slice(startIndex)
    .reduce((state, char, index) => {
      if (state.endIndex >= 0) return state
      if (char === "【") return { depth: state.depth + 1, endIndex: -1 }
      if (char !== "】") return state
      const nextDepth = state.depth - 1
      return nextDepth === 0 ? { depth: 0, endIndex: startIndex + index } : { depth: nextDepth, endIndex: -1 }
    }, { depth: 0, endIndex: -1 }).endIndex

  if (endIndex < 0) return { prefix: text, placeholder: "输入内容", suffix: "" }
  return {
    prefix: chars.slice(0, startIndex).join(""),
    placeholder: chars.slice(startIndex + 1, endIndex).join("") || "输入内容",
    suffix: chars.slice(endIndex + 1).join(""),
  }
}

export function styleTemplateTargetModel(canUseSeedream: boolean, currentStyleModel?: string) {
  const current = styleModelId(currentStyleModel)
  if (current === "seedream-5-lite" || current === "qwen") return current
  return canUseSeedream ? "seedream-5-lite" : "qwen"
}

export function styleTemplateFinalPrompt(template: StudioStyleTemplateListItem, input: { custom: string; extraPrompt: string; mainPrompt: string }) {
  if (template.template_type === "extract_style") {
    return `${input.custom}${JSON.stringify(template.style_description ?? {})}`
  }
  const parts = splitStyleTemplatePlayDescription(template.play_description ?? "")
  return `${parts.prefix}${input.mainPrompt}${parts.suffix}${input.extraPrompt}`
}

export function styleTemplatePromptPayload(template: StudioStyleTemplateListItem, input: { custom: string; extraPrompt: string; mainPrompt: string }) {
  if (template.template_type === "extract_style") {
    return {
      ...(template.style_description ?? {}),
      custom: input.custom,
    }
  }
  return {
    custom: `${input.mainPrompt}${input.extraPrompt}`,
    extraPrompt: input.extraPrompt,
    mainPrompt: input.mainPrompt,
  }
}
