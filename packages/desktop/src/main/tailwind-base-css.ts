/**
 * tailwind-base-css — 拼装 Tailwind v4 base CSS（theme + preflight + @property + @layer properties）
 *
 * 目的：导出的目标项目不依赖 Tailwind，但 utility 规则（.module.less）通过 var() 引用
 * Tailwind 主题变量（--color-primary、--spacing、--text-sm…）与 --tw-* 注册属性。
 * 这里产出一份共享 base CSS，由入口 main.tsx 引入一次，使 var() 引用可解析、
 * 浏览器重置（preflight）生效、--tw-* 注册属性语义（inherits:false）正确。
 *
 * 复用 tailwind-to-css 已加载的 designSystem.candidatesToCss 取候选 utility CSS，
 * theme/preflight 取自 tailwindcss 包内 ?raw 打包的静态文件——运行期不读盘，可打包进 bundle。
 */

import _themeCss from "tailwindcss/theme.css?raw"
import _preflightCss from "tailwindcss/preflight.css?raw"
import { designSystem, buildThemeCss } from "./tailwind-to-css"

const PROPERTY_BLOCK = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g
const INITIAL_VALUE = /initial-value:\s*([^;}]+)/

function extractThemeVars(src: string): string {
  const m = src.match(/@theme[^\n{]*\{([\s\S]*)\}/)
  return m ? m[1].trim() : ""
}

function buildThemeLayer(): string {
  const defaults = extractThemeVars(_themeCss)
  const overrides = extractThemeVars(buildThemeCss())
  const body = [defaults, overrides].filter(Boolean).join("\n")
  return `@layer theme {\n  :root, :host {\n${body}\n  }\n}`
}

function buildBaseLayer(): string {
  return `@layer base {\n${_preflightCss}\n}`
}

function buildUtilitiesAndProperties(candidates: string[]): {
  utilities: string
  properties: string
  propertiesLayer: string
} {
  if (!designSystem) return { utilities: "@layer utilities {}", properties: "", propertiesLayer: "" }

  const tokens = new Set<string>()
  for (const cn of candidates) for (const t of cn.split(/\s+/)) if (t) tokens.add(t)

  const utilityRules: string[] = []
  const propMap = new Map<string, string>()
  for (const css of designSystem.candidatesToCss([...tokens])) {
    if (!css) continue
    for (const m of css.matchAll(PROPERTY_BLOCK)) {
      if (!propMap.has(m[1])) propMap.set(m[1], m[0])
    }
    const rule = css.replace(/@property[^{]*\{[^}]*\}/g, "").trim()
    if (rule) utilityRules.push(rule)
  }

  const properties = [...propMap.values()].join("\n")
  const fallbackDecls: string[] = []
  for (const [name, block] of propMap) {
    const iv = block.match(INITIAL_VALUE)
    fallbackDecls.push(`      ${name}: ${iv ? iv[1].trim() : "initial"};`)
  }
  const propertiesLayer =
    fallbackDecls.length === 0
      ? ""
      : [
          "@layer properties {",
          "  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {",
          "    *, ::before, ::after, ::backdrop {",
          ...fallbackDecls,
          "    }",
          "  }",
          "}",
        ].join("\n")

  const utilities = `@layer utilities {\n${utilityRules.join("\n\n")}\n}`
  return { utilities, properties, propertiesLayer }
}

export function generateTailwindBaseCss(candidates: string[]): string {
  const { utilities, properties, propertiesLayer } = buildUtilitiesAndProperties(candidates)
  return (
    [
      "/*! tailwindcss v4 base (assembled by a2ui-transformer) */",
      "@layer theme, base, components, utilities;",
      buildThemeLayer(),
      buildBaseLayer(),
      utilities,
      properties,
      propertiesLayer,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  )
}
