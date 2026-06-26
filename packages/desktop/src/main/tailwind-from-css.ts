import { twirl } from "twirlwind"

export function convertCssToTailwind(cssObject: Record<string, unknown>): string {
  if (!cssObject || typeof cssObject !== "object") return ""
  return twirl(cssObject as any)
}
