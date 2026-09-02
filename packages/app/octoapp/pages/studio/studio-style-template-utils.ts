import type { StudioStyleTemplateListItem } from "./studio-style-template-menu"
import { styleModelId } from "./data"

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
