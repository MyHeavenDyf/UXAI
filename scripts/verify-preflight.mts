import { generateTailwindBaseCss } from '../packages/desktop/src/main/tailwind-base-css'

const css = await generateTailwindBaseCss(['flex', 'p-4', 'bg-primary', 'text-lg'])

console.log('=== Total length:', css.length, '===\n')

// 找 @layer base 块内的关键元素选择器
const elementSelectors = ['a {', 'a,', 'a:', 'h1', 'h2', 'h3', 'img', 'button', 'input', 'select', 'textarea', 'ol', 'ul', 'table', 'b, strong', 'b {', 'strong {', 'code', 'pre', 'hr', 'svg', 'video', 'canvas']

console.log('=== Preflight element rules found ===')
for (const sel of elementSelectors) {
  // 找到该选择器在 CSS 中的位置,打印上下文
  const idx = css.indexOf(sel)
  if (idx >= 0) {
    // 截取该位置前后的内容(找到 { 和 })
    const start = Math.max(0, idx - 30)
    const end = Math.min(css.length, idx + 200)
    const snippet = css.slice(start, end).replace(/\s+/g, ' ').trim()
    console.log(`✓ ${sel}  →  ...${snippet.slice(0, 180)}...`)
  } else {
    console.log(`✗ ${sel}  NOT FOUND`)
  }
}

console.log('\n=== @layer base block (first 3000 chars after "@layer base") ===')
const baseIdx = css.indexOf('@layer base')
if (baseIdx >= 0) {
  console.log(css.slice(baseIdx, baseIdx + 3000))
} else {
  console.log('NO @layer base FOUND')
}
