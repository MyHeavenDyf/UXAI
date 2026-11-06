// Mask non-output regions while preserving offsets into the original model text.
export function expansionOutputContext(text: string) {
  const code: [number, number][] = []
  let fence: { start: number; char: string; size: number } | undefined
  for (const match of text.matchAll(/^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/gm)) {
    if (!fence) {
      fence = { start: match.index, char: match[1][0], size: match[1].length }
      continue
    }
    if (match[1][0] !== fence.char || match[1].length < fence.size || match[2].trim()) continue
    code.push([fence.start, match.index + match[0].length])
    fence = undefined
  }
  if (fence) code.push([fence.start, text.length])
  for (const match of text.matchAll(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g)) {
    if (code.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue
    code.push([match.index, match.index + match[0].length])
  }

  const reasoning: [number, number][] = []
  let think: { start: number; depth: number } | undefined
  for (const match of text.matchAll(/<\s*(\/?)\s*think\s*>/gi)) {
    if (code.some(([start, end]) => match.index >= start && match.index < end)) continue
    if (!match[1]) {
      if (think) think.depth++
      if (!think) think = { start: match.index, depth: 1 }
      continue
    }
    if (!think) {
      // Some providers omit <think> but still delimit the final answer with </think>.
      reasoning.splice(0, reasoning.length, [0, match.index + match[0].length])
      continue
    }
    think.depth--
    if (think.depth !== 0) continue
    reasoning.push([think.start, match.index + match[0].length])
    think = undefined
  }
  if (think) reasoning.push([think.start, text.length])

  const mask = (ranges: [number, number][]) => {
    const chars = text.split("")
    for (const [start, end] of ranges) {
      for (let index = start; index < end; index++) {
        if (chars[index] !== "\n") chars[index] = " "
      }
    }
    return chars.join("")
  }
  return { content: mask(reasoning), syntax: mask([...reasoning, ...code]) }
}
