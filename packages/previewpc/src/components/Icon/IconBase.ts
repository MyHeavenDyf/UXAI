
import * as LucideIcons from "lucide-vue-next"


export const sizeConfig = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
} as const

const toPascalCase = (str: string) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
}

export function getLucideIconComponentRef(name: string) {
  if (!name) return null
  const componentName = toPascalCase(name)
  return (LucideIcons as any)[componentName] || LucideIcons.CircleEllipsis
}
