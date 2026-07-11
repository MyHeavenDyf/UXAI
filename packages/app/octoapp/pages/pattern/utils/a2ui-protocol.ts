export type A2UIElement = {
  id: string
  component: string
  props?: Record<string, unknown>
  children?: string[] | { path: string; componentId: string }
}

export type A2UIDocument = {
  state?: Record<string, unknown>
  rootId: string
  elements: A2UIElement[]
}

export function detectA2UIJson(text: string): A2UIDocument | null {
  try {
    const raw = text.includes("```json")
      ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
      : text
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.elements) && parsed.rootId) {
      return parsed as A2UIDocument
    }
  } catch {}
  return null
}
