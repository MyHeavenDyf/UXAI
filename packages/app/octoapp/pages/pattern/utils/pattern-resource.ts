import { getDesktopApi } from "./desktop-api"

export type PatternEntry = {
  name: string
  elements?: string
  business_scenario?: string
  layout_mode?: string
  path: string
}

export type PatternMatchItem = {
  pattern: PatternEntry
  score: number
  content: string | null
}

// 读取指定主题、类别（"page" | "block"）的 pattern 目录索引
export async function readPatternIndex(category: string, theme = "ICT3.1"): Promise<PatternEntry[] | null> {
  const api = getDesktopApi()
  if (!api?.getPatternIndex) return null
  const data = await api.getPatternIndex(category, theme)
  if (!data) return null
  const entries = (category === "page" ? data.pages : data.blocks) as PatternEntry[] | undefined
  return entries ?? null
}

// 读取指定主题、类别下的具体 pattern 文件内容
export async function readPatternFile(category: string, filename: string, theme = "ICT3.1"): Promise<string | null> {
  const api = getDesktopApi()
  if (!api?.getPatternFile) return null
  return api.getPatternFile(category, filename, theme)
}
