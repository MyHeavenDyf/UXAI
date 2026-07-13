import { TW_PREFIXES } from "./constants"

export function isTailwindToken(cls: string): boolean {
  for (const p of TW_PREFIXES) {
    if (cls === p) return true
    if (cls.startsWith(p) || cls.startsWith(p + '[')) return true
  }
  return false
}

export function _px(cls: string, prefix: string): number | null {
  const m = cls.match(new RegExp(`${prefix}-\\[(\\d+)px\\]`))
  if (m) return Number(m[1])
  const n = Number(cls.startsWith(`${prefix}-`) ? cls.slice(prefix.length + 1) : '')
  if (!isNaN(n)) {
    const px = n * 4
    if ([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64].includes(px)) return px
  }
  return null
}

export function _pxGap(cls: string, cb: (v: number) => void) {
  let m = cls.match(/gap-\[(\d+)px\]/)
  if (m) { cb(Number(m[1])); return }
  m = cls.match(/gap-(\d+)/)
  if (m) {
    const px = Number(m[1]) * 4
    if ([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64].includes(px)) cb(px)
  }
}

export function camelToKebab(s: string) { return s.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) }

export function normalizeCssKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(obj)) out[camelToKebab(key)] = String(obj[key]).toLowerCase()
  return out
}

export function toHex(color: string): string {
  if (!color.startsWith('rgb')) return color
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return color
  return '#' + [Number(m[1]), Number(m[2]), Number(m[3])].map(n => n.toString(16).padStart(2, '0')).join('')
}
