/**
 * Shared Markdown-context helpers for the artifact parser.
 * Ported from open-design/apps/web/src/artifacts/markdown-context.ts
 */

export const FENCE_OPEN_RE = /^```(\w[\w+-]*)?\s*$/
export const FENCE_CLOSE_RE = /^```\s*$/
export const INLINE_CODE_RE = /`[^`]+`/g

const HEADING_RE = /^#{1,4}\s+/
const UL_ITEM_RE = /^\s*[-*+]\s+/
const OL_ITEM_RE = /^\s*\d+\.\s+/

export function isRealArtifactOpenAt(content: string, idx: number): boolean {
  const next = content.charAt(idx + "<artifact".length)
  return next !== "" && /\s/.test(next)
}

export type Range = readonly [number, number]

export function computeSkipRanges(buffer: string): {
  ranges: Range[]
  unclosedFenceStart: number | null
} {
  const ranges: Range[] = []
  const blockRegions: Range[] = []

  let pos = 0
  let inFence = false
  let fenceStart = -1
  let blockStart = -1
  const closeBlockBefore = (idx: number) => {
    if (blockStart !== -1 && idx > blockStart) blockRegions.push([blockStart, idx])
    blockStart = -1
  }
  while (pos < buffer.length) {
    const eol = buffer.indexOf("\n", pos)
    const lineEnd = eol === -1 ? buffer.length : eol
    const line = buffer.slice(pos, lineEnd)
    const lineHasNewline = eol !== -1
    if (!inFence) {
      if (lineHasNewline && FENCE_OPEN_RE.test(line)) {
        closeBlockBefore(pos)
        inFence = true
        fenceStart = pos
      } else if (line.trim() === "") {
        closeBlockBefore(pos)
      } else if (HEADING_RE.test(line) || UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
        closeBlockBefore(pos)
        blockRegions.push([pos, lineEnd])
      } else {
        if (blockStart === -1) blockStart = pos
      }
    } else if (lineHasNewline && FENCE_CLOSE_RE.test(line)) {
      inFence = false
      ranges.push([fenceStart, eol + 1])
      fenceStart = -1
    }
    if (!lineHasNewline) break
    pos = eol + 1
  }
  if (!inFence) closeBlockBefore(buffer.length)

  for (const [s, e] of blockRegions) {
    INLINE_CODE_RE.lastIndex = 0
    const segment = buffer.slice(s, e)
    let m: RegExpExecArray | null = INLINE_CODE_RE.exec(segment)
    while (m !== null) {
      ranges.push([s + m.index, s + m.index + m[0].length])
      m = INLINE_CODE_RE.exec(segment)
    }
  }

  return { ranges, unclosedFenceStart: inFence ? fenceStart : null }
}

export function rangeContains(ranges: ReadonlyArray<Range>, p: number): boolean {
  for (const [s, e] of ranges) {
    if (p >= s && p < e) return true
  }
  return false
}
