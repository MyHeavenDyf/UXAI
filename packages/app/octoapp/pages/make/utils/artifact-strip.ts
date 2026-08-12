/**
 * Strip <artifact> tags from text, preserving code blocks.
 * Ported from open-design/apps/web/src/artifacts/strip.ts
 */

function computeSkipRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  // Fenced code blocks (``` or ~~~)
  const fenceRe = /^([`~]{3,})\s*\S*$/gm
  let match: RegExpExecArray | null
  while ((match = fenceRe.exec(text)) !== null) {
    const fence = match[1]
    const start = match.index + match[0].length + 1
    const closeIdx = text.indexOf("\n" + fence, start)
    const end = closeIdx === -1 ? text.length : closeIdx + fence.length + 1
    ranges.push([match.index, end])
  }
  // Inline code (`...`)
  const inlineRe = /`[^`]+`/g
  while ((match = inlineRe.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

function inSkipRange(ranges: Array<[number, number]>, idx: number): boolean {
  for (const [s, e] of ranges) {
    if (idx >= s && idx < e) return true
  }
  return false
}

/**
 * Strip <artifact> tags from text, preserving code blocks.
 * Ported from open-design/apps/web/src/artifacts/strip.ts
 * 大小写不敏感:<Artifact>, </ARTIFACT> 等都能识别并剥离
 */

const STRIP_OPEN_RE = /<artifact/gi
const STRIP_CLOSE_RE = /<\/artifact>/gi

function indexOfArtifact(result: string, from: number): number {
  STRIP_OPEN_RE.lastIndex = from
  const m = STRIP_OPEN_RE.exec(result)
  return m ? m.index : -1
}

function indexOfCloseArtifact(result: string, from: number): number {
  STRIP_CLOSE_RE.lastIndex = from
  const m = STRIP_CLOSE_RE.exec(result)
  return m ? m.index : -1
}

export function stripArtifact(text: string): string {
  if (!/<artifact/i.test(text)) return text
  const ranges = computeSkipRanges(text)

  // Find and remove the first real <artifact ...>...</artifact> block
  let result = text
  let searchFrom = 0
  while (searchFrom < result.length) {
    const openIdx = indexOfArtifact(result, searchFrom)
    if (openIdx === -1) break
    if (inSkipRange(ranges, openIdx)) {
      searchFrom = openIdx + 9
      continue
    }
    // Validate it's a real artifact tag (not e.g. <artifactual)
    const afterOpen = result.slice(openIdx + 9)
    if (afterOpen.length > 0 && afterOpen[0] !== " " && afterOpen[0] !== "\n" && afterOpen[0] !== "\t" && afterOpen[0] !== ">") {
      searchFrom = openIdx + 9
      continue
    }

    // Find closing </artifact> (case-insensitive)
    const closeIdx = indexOfCloseArtifact(result, openIdx)
    if (closeIdx === -1) {
      // Unclosed tag at end — remove from openIdx to end
      result = result.slice(0, openIdx)
      break
    }
    const endIdx = closeIdx + "</artifact>".length
    result = result.slice(0, openIdx) + result.slice(endIdx)
    // Continue stripping — there may be more artifacts after this one
  }

  return result.trim()
}
