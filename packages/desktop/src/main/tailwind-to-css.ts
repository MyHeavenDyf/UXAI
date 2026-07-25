import { __unstable__loadDesignSystem } from "tailwindcss"
import _tailwindIndexCss from "tailwindcss/index.css?raw"

export const tailwindConfig: any = {
  theme: {
    extend: {
      colors: {
        "primary": "#0067D1",
        "on-primary": "#FFFFFF",
        "primary-container": "#E6F2FD",
        "on-primary-container": "#191919",
        "primary-fixed": "#0067D1",
        "primary-fixed-dim": "#004EA8",
        "on-primary-fixed": "#FFFFFF",
        "on-primary-fixed-variant": "#F3F3F3",
        "surface": "#F3F3F3",
        "surface-dim": "#DFDFDF",
        "surface-bright": "#FFFFFF",
        "on-surface": "#191919",
        "surface-variant": "#F3F3F3",
        "on-surface-variant": "#777777",
        "surface-container-lowest": "#F3F3F3",
        "surface-container-low": "rgba(255,255,255,0.5)",
        "surface-container": "rgba(255,255,255,0.65)",
        "surface-container-high": "rgba(255,255,255,0.8)",
        "surface-container-highest": "#FFFFFF",
        "inverse-surface": "#191919",
        "inverse-on-surface": "#FFFFFF",
        "inverse-on-surface-variant": "#C9C9C9",
        "inverse-primary": "#0067D1",
        "error": "#E02128",
        "on-error": "#FFFFFF",
        "error-container": "#FEE7E8",
        "on-error-container": "#191919",
        "success": "#09AA71",
        "on-success": "#FFFFFF",
        "success-container": "#E7FBF2",
        "on-success-container": "#191919",
        "critical": "#F4840C",
        "on-critical": "#FFFFFF",
        "critical-container": "#FEF5E8",
        "on-critical-container": "#191919",
        "warning": "#FCC800",
        "on-warning": "#FFFFFF",
        "warning-container": "#FEFCE0",
        "on-warning-container": "#191919",
        "info": "#0067D1",
        "on-info": "#FFFFFF",
        "info-container": "#E6F2FD",
        "on-info-container": "#191919",
        // hui的token
        "hui-brand-hover": "#2E86DE",
        "hui-brand-focus": "#0067D1",
        "hui-brand-active": "#004EA8",
        "hui-brand-disabled": "#8ABEF3",
        "hui-brand-color": "#0067D1",
        "hui-text-primary": "#191919",
        "hui-text-secondary": "#777777",
        "hui-text-placeholder": "#AEAEAE",
        "hui-text-disabled": "#C9C9C9",
        "hui-text-inverse": "#FFFFFF",
        "hui-text-inverse-disabled": "#FFFFFF",
        "hui-text-on": "#0067D1",
        "hui-link": "#0067D1",
        "hui-link-hover": "#2E86DE",
        "hui-link-active": "#004EA8",
        "hui-link-visited": "#715AFB",
        "hui-link-disabled": "#8ABEF3",
        "hui-bg-1": "#F3F3F3",
        "hui-bg-2": "#FFFFFF",
        "hui-bg-3": "#FFFFFF",
        "hui-bg-4": "#FFFFFF",
        "hui-bg-5": "#FFFFFF",
        "hui-bg-6": "#C9C9C933",
        "hui-bg-mask": "#AEAEAE4D",
        "hui-hover": "#191919",
        "hui-select": "#E6F2FD",
        "hui-fill": "#191919",
        "hui-fill-subtle": "#FFFFFF",
        "hui-fill-disabled": "#DFDFDF",
        "hui-fill-disabled-subtle": "#191919",
        "hui-icon-primary": "#191919",
        "hui-icon-hover": "#2E86DE",
        "hui-icon-focus": "#0067D1",
        "hui-icon-active": "#004EA8",
        "hui-icon-disabled": "#AEAEAE",
        "hui-icon-inverse": "#FFFFFF",
        "hui-icon-secondary": "#777777",
        "hui-icon-tertiary": "#939393",
        "hui-icon-placeholder": "#AEAEAE",
        "hui-border-color": "#C9C9C9",
        "hui-border-hover": "#191919",
        "hui-border-focus": "#0067D1",
        "hui-border-active": "#B8D9F9",
        "hui-border-disabled": "#C9C9C9",
        "hui-border-separator": "#DFDFDF",
        "hui-border-separator-sbutle": "#F3F3F3",
        "hui-error": "#E02128",
        "hui-error-hover": "#E7434A",
        "hui-error-active": "#C7000B",
        "hui-error-disabled": "#FABDC1",
        "hui-error-subtle": "#F59297",
        "hui-error-subtler": "#FEE7E8",
        "hui-alert": "#F4840C",
        "hui-alert-hover": "#F69E39",
        "hui-alert-active": "#C76207",
        "hui-alert-disabled": "#FDE2BD",
        "hui-alert-subtle": "#FCCE92",
        "hui-alert-subtler": "#FEF5E8",
        "hui-warning": "#FCC800",
        "hui-warning-hover": "#FCD72E",
        "hui-warning-active": "#D19F00",
        "hui-warning-disabled": "#FEF8B8",
        "hui-warning-bold": "#D19F00",
        "hui-warning-subtle": "#FEF08A",
        "hui-warning-subtler": "#FEFCE0",
        "hui-success": "#09AA71",
        "hui-success-hover": "#36C18D",
        "hui-success-active": "#058358",
        "hui-success-disabled": "#BCF2DB",
        "hui-success-subtle": "#8FE5C2",
        "hui-success-subtler": "#E7FBF2",
        "hui-info-primary": "#2070F3",
        "hui-info-primary-subtle": "#8CA3FA",
        "hui-info-primary-subtler": "#EEF3FE",
        "hui-info-secondary": "#8CA3FA",
        "hui-info-secondary-hover": "#B0BFFD",
        "hui-info-secondary-active": "#668CF7",
        "hui-info-secondary-disabled": "#D0D8FD",
        "hui-info-secondary-subtle": "#EEF3FE",
        "hui-chart-1": "#2070F3",
        "hui-chart-2": "#62B42E",
        "hui-chart-3": "#715AFB",
        "hui-chart-4": "#2CB8C9",
        "hui-chart-5": "#F69E39",
        "hui-chart-6": "#5CA2E9",
        "hui-chart-7": "#BF68FA",
        "hui-chart-8": "#ED448A",
        "hui-chart-9": "#BFB9FA",
        "hui-chart-10": "#D19F00",
        "hui-chart-11": "#B8D9F9",
        "hui-chart-12": "#488E20",
        "hui-chart-13": "#D9B1FD",
        "hui-chart-14": "#1C94A4",
        "hui-chart-15": "#FCCE92",
        "hui-chart-16": "#C40054",
        "hui-chart-17": "#A4ECF1",
        "hui-chart-18": "#1F55B5",
        "hui-chart-19": "#C6E9A8",
        "hui-chart-20": "#3F21B5",
        "hui-chart-21": "#FCC3E0",
        "hui-chart-22": "#127180",
        "hui-chart-23": "#FEF08A",
        "hui-chart-24": "#651B8B",
        "hui-chart-25": "#8FE5C2",
        "hui-none": "#AEAEAE",
        "hui-none-hover": "#C9C9C9",
        "hui-none-active": "#939393",
        "hui-none-disabled": "#DFDFDF",
        "hui-none-subtle": "#F3F3F3",
        "hui-scrollbar": "#DFDFDF",
        "hui-scrollbar-hover": "#AEAEAE",
        "hui-card-gray-disabled": "#AEAEAE",
        "hui-card-white-disabled": "#FFFFFF80",
        "hui-sidenav-bg": "#F3F3F380",
        "hui-table-header": "#1919190D",
        "hui-table-zebra": "#9393930D",
        "hui-radiogp-bg": "#FFFFFF",
        "hui-radiogp-text": "#0067D1",
        "hui-message-bg-info": "#EEF3FE",
        "hui-message-bg-success": "#E7FBF2",
        "hui-message-bg-warning": "#FEFCE0",
        "hui-message-bg-alert": "#FEF5E8",
        "hui-message-bg-error": "#FEE7E8",
        "hui-tag-text-purple": "#8A21BC",
        "hui-tag-bg-purple": "#F7EDFE99",
        "hui-tag-text-cyan": "#094C57",
        "hui-tag-bg-cyan": "#1C94A426",
        "hui-tag-text-rose": "#C40054",
        "hui-tag-bg-rose": "#FEE5F2",
        "hui-tag-text-green": "#316614",
        "hui-tag-bg-green": "#DFF4CC",
        "hui-tag-text-pink": "#9F1C8D",
        "hui-tag-bg-pink": "#FDE6FC",
        "hui-tag-text-indigo": "#281675",
        "hui-tag-bg-indigo": "#D5D3FD99",
        "hui-tag-text-none": "#393939",
        "hui-tag-bg-none": "#1919190D",
        "hui-tag-text-error": "#C7000B",
        "hui-tag-bg-error": "#FEE7E8",
        "hui-tag-text-alert": "#954304",
        "hui-tag-bg-alert": "#FDE2BD",
        "hui-tag-text-warning": "#614500",
        "hui-tag-bg-warning": "#FDE55C99",
        "hui-tag-text-success": "#036142",
        "hui-tag-bg-success": "#BCF2DB99",
        "hui-tag-text-info": "#1F55B5",
        "hui-tag-bg-info": "#D0D8FD80",
        "hui-alert-urgent": "#F43146",
        "hui-alert-primary": "#EC6F1A",
        "hui-alert-secondary": "#EEBA18",
        "hui-alert-success": "#2DA769",
        "hui-alert-running": "#5990FD",
        "hui-alert-none": "#939393",
        "hui-table-1": "#E6F2FD",
        "hui-table-2": "#B8D9F9",
        "hui-table-sticky-1": "#E6F2FD",
        "hui-table-sticky-2": "#B8D9F9",
        "hui-table-sticky-bg": "#FFFFFF",
        "hui-table-sticky-header": "#F3F3F3",
        "hui-brand-5": "#E6F2FD",
        "hui-brand-10": "#B8D9F9",
        "hui-brand-20": "#8ABEF3",
        "hui-brand-30": "#5CA2E9",
        "hui-brand-40": "#2E86DE",
        "hui-brand-50": "#0067D1",
        "hui-brand-60": "#004EA8",
        "hui-brand-70": "#003D83",
        "hui-brand-80": "#002E6A",
        "hui-brand-90": "#00214B",
        "hui-gray-0": "#FFFFFF",
        "hui-gray-5": "#F3F3F3",
        "hui-gray-10": "#DFDFDF",
        "hui-gray-20": "#C9C9C9",
        "hui-gray-30": "#AEAEAE",
        "hui-gray-40": "#939393",
        "hui-gray-50": "#777777",
        "hui-gray-60": "#595959",
        "hui-gray-70": "#393939",
        "hui-gray-80": "#2A2A2A",
        "hui-gray-90": "#191919",
        "hui-gray-100": "#000000",
        "hui-red-5": "#FEE7E8",
        "hui-red-10": "#FABDC1",
        "hui-red-20": "#F59297",
        "hui-red-30": "#EE696F",
        "hui-red-40": "#E7434A",
        "hui-red-50": "#E02128",
        "hui-red-60": "#C7000B",
        "hui-red-70": "#850F12",
        "hui-red-80": "#59080A",
        "hui-red-90": "#350305",
        "hui-rose-5": "#FEE5F2",
        "hui-rose-10": "#FCC3E0",
        "hui-rose-20": "#F99AC7",
        "hui-rose-30": "#F470AB",
        "hui-rose-40": "#ED448A",
        "hui-rose-50": "#E61866",
        "hui-rose-60": "#C40054",
        "hui-rose-70": "#811439",
        "hui-rose-80": "#540D24",
        "hui-rose-90": "#330614",
        "hui-orange-5": "#FEF5E8",
        "hui-orange-10": "#FDE2BD",
        "hui-orange-20": "#FCCE92",
        "hui-orange-30": "#F9B766",
        "hui-orange-40": "#F69E39",
        "hui-orange-50": "#F4840C",
        "hui-orange-60": "#C76207",
        "hui-orange-70": "#954304",
        "hui-orange-80": "#642802",
        "hui-orange-90": "#3D1601",
        "hui-yellow-5": "#FEFCE0",
        "hui-yellow-10": "#FEF8B8",
        "hui-yellow-20": "#FEF08A",
        "hui-yellow-30": "#FDE55C",
        "hui-yellow-40": "#FCD72E",
        "hui-yellow-50": "#FCC800",
        "hui-yellow-60": "#D19F00",
        "hui-yellow-70": "#9E7400",
        "hui-yellow-80": "#614500",
        "hui-yellow-90": "#2E1F00",
        "hui-green-5": "#F2FBE9",
        "hui-green-10": "#DFF4CC",
        "hui-green-20": "#C6E9A8",
        "hui-green-30": "#A8DB81",
        "hui-green-40": "#87C859",
        "hui-green-50": "#62B42E",
        "hui-green-60": "#488E20",
        "hui-green-70": "#316614",
        "hui-green-80": "#1B3E0A",
        "hui-green-90": "#0C2004",
        "hui-mint-5": "#E7FBF2",
        "hui-mint-10": "#BCF2DB",
        "hui-mint-20": "#8FE5C2",
        "hui-mint-30": "#63D5A8",
        "hui-mint-40": "#36C18D",
        "hui-mint-50": "#09AA71",
        "hui-mint-60": "#058358",
        "hui-mint-70": "#036142",
        "hui-mint-80": "#02422E",
        "hui-mint-90": "#00291D",
        "hui-cyan-5": "#E8FCFD",
        "hui-cyan-10": "#C9F6F9",
        "hui-cyan-20": "#A4ECF1",
        "hui-cyan-30": "#7DDFE7",
        "hui-cyan-40": "#55CCD9",
        "hui-cyan-50": "#2CB8C9",
        "hui-cyan-60": "#1C94A4",
        "hui-cyan-70": "#127180",
        "hui-cyan-80": "#094C57",
        "hui-cyan-90": "#04282F",
        "hui-blue-5": "#EEF3FE",
        "hui-blue-10": "#D0D8FD",
        "hui-blue-20": "#B0BFFD",
        "hui-blue-30": "#8CA3FA",
        "hui-blue-40": "#668CF7",
        "hui-blue-50": "#2070F3",
        "hui-blue-60": "#1F55B5",
        "hui-blue-70": "#1B3F86",
        "hui-blue-80": "#112857",
        "hui-blue-90": "#081635",
        "hui-indigo-5": "#EEEEFE",
        "hui-indigo-10": "#D5D3FD",
        "hui-indigo-20": "#BFB9FA",
        "hui-indigo-30": "#A89FF9",
        "hui-indigo-40": "#8E81F4",
        "hui-indigo-50": "#715AFB",
        "hui-indigo-60": "#5531EB",
        "hui-indigo-70": "#3F21B5",
        "hui-indigo-80": "#281675",
        "hui-indigo-90": "#160B48",
        "hui-purple-5": "#F7EDFE",
        "hui-purple-10": "#E8CFFE",
        "hui-purple-20": "#D9B1FD",
        "hui-purple-30": "#CB8EFB",
        "hui-purple-40": "#BF68FA",
        "hui-purple-50": "#B62BF7",
        "hui-purple-60": "#8A21BC",
        "hui-purple-70": "#651B8B",
        "hui-purple-80": "#41125A",
        "hui-purple-90": "#260937",
        "hui-pink-5": "#FDE6FC",
        "hui-pink-10": "#F9C5F6",
        "hui-pink-20": "#F39DEC",
        "hui-pink-30": "#EB74DF",
        "hui-pink-40": "#E049CE",
        "hui-pink-50": "#D41DBC",
        "hui-pink-60": "#9F1C8D",
        "hui-pink-70": "#751868",
        "hui-pink-80": "#4C0F43",
        "hui-pink-90": "#2E0728",
      },
      "spacing": {
        'inline': '0.5rem',
        'stack': '0.75rem',
        'gutter': '1rem', 
        'inset': '1.5rem',
        'section': '1rem', 
        'page': '2rem'    
      },
      boxShadow: {
        sm: "1px 1px 6px 0px rgba(0, 0, 0, 0.08)",
        md: "0px 4px 12px 0px rgba(0, 0, 0, 0.16)",
        lg: "0px 8px 24px 0px rgba(0, 0, 0, 0.16)",
        xl: "0px 16px 48px 0px rgba(0, 0, 0, 0.16)",
        card: "1px 1px 6px 0px rgba(0, 0, 0, 0.08)",
        popover: "0px 8px 24px 0px rgba(0, 0, 0, 0.16)",
        modal: "0px 16px 48px 0px rgba(0, 0, 0, 0.16)",
      },
      borderColor: {
        base: "#C9C9C9",
        divider: "#F3F3F3",
        selected: "#0067D1",
        error: "#E02128",
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        md: "4px",
        lg: "6px",
        xl: "8px",
        full: "9999px",
        badge: "4px",
        action: "4px",
        container: "8px",
        overlay: "8px",
      },
      outlineColor: {
        brand: "#0067D1",
        error: "#E02128",
      },
      outlineWidth: {
        focus: "1px",
      },
      outlineOffset: {
        gap: "2px",
      },
      fontSize: {
        xs: ["10px", { lineHeight: "1.8" }],
        sm: ["12px", { lineHeight: "1.6" }],
        md: ["14px", { lineHeight: "1.5" }],
        lg: ["16px", { lineHeight: "1.5" }],
        xl: ["18px", { lineHeight: "1.5" }],
        "2xl": ["20px", { lineHeight: "1.4" }],
        "3xl": ["24px", { lineHeight: "1.4" }],
        "4xl": ["28px", { lineHeight: "1.4" }],
        "5xl": ["36px", { lineHeight: "1.4" }],
        "6xl": ["48px", { lineHeight: "1.3" }],
        "7xl": ["60px", { lineHeight: "1.3" }],
        "8xl": ["72px", { lineHeight: "1.2" }],
        "9xl": ["96px", { lineHeight: "1.2" }],
      },
    },
  },
}

function buildThemeCss(): string {
  const ext = (tailwindConfig as { theme: { extend: Record<string, any> } }).theme.extend
  const lines: string[] = []
  for (const [name, hex] of Object.entries(ext.colors as Record<string, string>)) {
    lines.push(`  --color-${name}: ${hex};`)
  }
  for (const [name, val] of Object.entries(ext.borderColor as Record<string, string>)) {
    lines.push(`  --color-${name}: ${val};`)
  }
  for (const [name, [size, opts]] of Object.entries(ext.fontSize as Record<string, [string, { lineHeight?: string }]>)) {
    lines.push(`  --text-${name}: ${size};`)
    if (opts?.lineHeight) lines.push(`  --text-${name}--line-height: ${opts.lineHeight};`)
  }
  for (const [name, val] of Object.entries(ext.borderRadius as Record<string, string>)) {
    lines.push(`  --radius-${name}: ${val};`)
  }
  for (const [name, val] of Object.entries(ext.boxShadow as Record<string, string>)) {
    lines.push(`  --shadow-${name}: ${val};`)
  }
  for (const [name, val] of Object.entries(ext.spacing as Record<string, string>)) {
    lines.push(`  --spacing-${name}: ${val};`)
  }
  return `@import "tailwindcss";\n@theme {\n${lines.join("\n")}\n}`
}

let designSystem: Awaited<ReturnType<typeof __unstable__loadDesignSystem>> | null = null
try {
  designSystem = await __unstable__loadDesignSystem(buildThemeCss(), {
    loadStylesheet: async (id: string, base: string) => {
      if (id === "tailwindcss") return { path: id, base, content: _tailwindIndexCss }
      throw new Error(`cannot resolve stylesheet ${id}`)
    },
  })
} catch (e) {
  console.error("[tailwind-to-css] v4 design system init failed:", e)
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function splitDeclarations(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const ch of body) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (ch === ";" && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function findMatchingParen(s: string, start: number): number {
  let depth = 1
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") depth++
    else if (s[i] === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function resolveValue(value: string, localVars: Map<string, string>): string {
  const resolve = (s: string, seen: Set<string>): string => {
    let result = ""
    let i = 0
    while (i < s.length) {
      const idx = s.indexOf("var(", i)
      if (idx < 0) {
        result += s.slice(i)
        break
      }
      result += s.slice(i, idx)
      const close = findMatchingParen(s, idx + 4)
      if (close < 0) {
        result += s.slice(idx)
        break
      }
      const content = s.slice(idx + 4, close)
      const resolved = resolve(content, seen)
      const commaIdx = resolved.indexOf(",")
      const name = (commaIdx < 0 ? resolved : resolved.slice(0, commaIdx)).trim()
      const fallback = commaIdx < 0 ? undefined : resolved.slice(commaIdx + 1).trim()
      if (seen.has(name)) {
        result += fallback ?? `var(${content})`
      } else {
        const next = new Set(seen).add(name)
        const local = localVars.get(name)
        const tv = designSystem ? (designSystem.resolveThemeValue(name.slice(2)) ?? designSystem.resolveThemeValue(name)) : undefined
        const resolved2 = local ?? tv ?? (name === "--spacing" ? "0.25rem" : fallback)
        result += resolved2 !== undefined ? resolve(resolved2, next) : `var(${content})`
      }
      i = close + 1
    }
    return result
  }
  let r = resolve(value, new Set())
  r = r.replace(/calc\(([\d.]+)\s*\/\s*([\d.]+)\)/g, (_, a: string, b: string) =>
    `${Math.round((parseFloat(a) / parseFloat(b)) * 1000) / 1000}`,
  )
  r = r.replace(/calc\(([\d.]+)rem\s*\*\s*(-?[\d.]+)\)/g, (_, rem: string, n: string) =>
    `${Math.round(parseFloat(rem) * parseFloat(n) * 16)}px`,
  )
  r = r.replace(/calc\(var\(--spacing\)\s*\*\s*(-?[\d.]+)\)/g, (_, n: string) =>
    `${parseFloat(n) * 4}px`,
  )
  return r
}

const logicalToPhysical: Record<string, string[]> = {
  paddingInline: ["paddingLeft", "paddingRight"],
  paddingBlock: ["paddingTop", "paddingBottom"],
  marginInline: ["marginLeft", "marginRight"],
  marginBlock: ["marginTop", "marginBottom"],
  insetInline: ["left", "right"],
  insetBlock: ["top", "bottom"],
}

function parseCssToProperties(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  const propertyVars = new Map<string, string>()
  for (const m of css.matchAll(/@property\s+(--[\w-]+)\s*\{[^}]*?initial-value:\s*([^;}]+)/g)) {
    propertyVars.set(m[1], m[2].trim())
  }
  const withoutProperty = css.replace(/@property[^{]*\{[^}]*\}/g, "")
  for (const m of withoutProperty.matchAll(/\{([^}]*)\}/g)) {
    const body = m[1]
    const localVars = new Map(propertyVars)
    const decls = splitDeclarations(body)
    for (const decl of decls) {
      const idx = decl.indexOf(":")
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim()
      const val = decl.slice(idx + 1).trim()
      if (prop.startsWith("--")) localVars.set(prop, val)
    }
    for (const decl of decls) {
      const idx = decl.indexOf(":")
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim()
      if (prop.startsWith("--")) continue
      const val = decl.slice(idx + 1).trim()
      const camelProp = kebabToCamel(prop)
      const resolved = resolveValue(val, localVars)
      const physicals = logicalToPhysical[camelProp]
      if (physicals) {
        for (const p of physicals) result[p] = resolved
      } else {
        result[camelProp] = resolved
      }
    }
  }
  return result
}

export function convertTailwindToCSS(className: string): Record<string, string> {
  if (!className.trim()) return {}
  if (!designSystem) return {}
  const classes = className.split(/\s+/).filter(Boolean)
  const cssStrings = designSystem.candidatesToCss(classes)
  const result: Record<string, string> = {}
  for (const css of cssStrings) {
    if (!css) continue
    Object.assign(result, parseCssToProperties(css))
  }
  return result
}
