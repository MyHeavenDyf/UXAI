import { TailwindConverter } from 'css-to-tailwindcss'
import { tailwindConfig } from './tailwind-to-css'

const converter = new TailwindConverter({
  tailwindConfig,
})

export async function convertCssToTailwind(cssObject: Record<string, unknown>): Promise<string> {
  if (!cssObject || typeof cssObject !== "object" || Object.keys(cssObject).length === 0) return ""

  const rules = Object.entries(cssObject)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')

  const inputCSS = `.cls { ${rules} }`

  const { convertedRoot } = await converter.convertCSS(inputCSS)
  const result = convertedRoot.toString()

  for (const line of result.split('\n')) {
    const idx = line.indexOf('@apply')
    if (idx >= 0) return line.slice(idx + '@apply'.length).replace(/[;}]/g, '').trim()
  }
  return ""
}