import { generateTailwindBaseCss } from '../packages/desktop/src/main/tailwind-base-css'

const candidates = ['flex', 'p-4', 'hover:bg-red-500', 'bg-primary', 'text-on-primary', 'md:text-lg']

const css = await generateTailwindBaseCss(candidates)

console.log('=== Generated tailwind-base.css length:', css.length, '===')
console.log('=== First 1500 chars ===')
console.log(css.slice(0, 1500))
console.log('...')
console.log('=== Last 800 chars ===')
console.log(css.slice(-800))

console.log('\n=== Assertions ===')
const checks: [string, boolean][] = [
  ['contains preflight (box-sizing in @layer base)', css.includes('box-sizing: border-box')],
  ['contains theme var --color-primary', css.includes('--color-primary')],
  ['contains .flex { display: flex }', /\.flex\s*\{[^}]*display:\s*flex/.test(css)],
  ['contains .p-4 padding', /\.p-4\s*\{[^}]*padding/.test(css)],
  ['contains escaped hover variant selector', /\.hover\\:bg-red-500/.test(css)],
  ['contains md:text-lg media query (range syntax)', /@media\s*\(width\s*>=\s*48rem\)/.test(css)],
  ['contains bg-primary referencing var(--color-primary)', /\.bg-primary\s*\{[^}]*var\(--color-primary\)/.test(css)],
  ['contains @layer order', css.includes('@layer theme, base, components, utilities')],
  ['contains HarmonyOS Sans font (HUI theme applied)', css.includes('HarmonyOS Sans')],
]
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

const allPass = checks.every(([, ok]) => ok)
console.log(allPass ? '\n✅ All checks passed' : '\n❌ Some checks failed')
process.exit(allPass ? 0 : 1)
