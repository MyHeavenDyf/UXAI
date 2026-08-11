import { convertTailwindToLessRule, generateLessContent, convertTailwindToCSS } from '../packages/desktop/src/main/tailwind-to-css'

console.log('=== Test convertTailwindToCSS (inline style API) ===')
const styleObj = convertTailwindToCSS('flex p-4 bg-primary text-on-primary hover:bg-red-500', false)
console.log('convertTailwindToCSS result:', JSON.stringify(styleObj, null, 2))

console.log('\n=== Test convertTailwindToLessRule (CSS Modules .less API) ===')
const rule = convertTailwindToLessRule('flex p-4 bg-primary text-on-primary hover:bg-red-500', '.test123', { useVar: true })
if (rule) {
  console.log('selector:', rule.selector)
  console.log('declarations:', rule.declarations)
  console.log('variants:', rule.variants)
  console.log('\n--- generateLessContent ---')
  console.log(generateLessContent([rule]))
} else {
  console.log('NULL RULE! — convertTailwindToLessRule returned null')
  console.log('This means designSystem is null or candidatesToCss returned nothing.')
}

console.log('\n=== Test with useVar=false ===')
const rule2 = convertTailwindToLessRule('flex p-4 bg-primary', '.test456', { useVar: false })
if (rule2) {
  console.log('selector:', rule2.selector)
  console.log('declarations:', rule2.declarations)
} else {
  console.log('NULL RULE!')
}

console.log('\n=== Test single class: flex ===')
const rule3 = convertTailwindToLessRule('flex', '.test789', { useVar: true })
console.log('flex rule:', rule3 ? `${rule3.declarations.length} declarations` : 'NULL')
if (rule3) console.log(JSON.stringify(rule3.declarations, null, 2))
