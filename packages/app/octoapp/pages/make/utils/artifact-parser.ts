/**
 * Streaming parser for <artifact identifier="..." type="..." title="...">...</artifact>
 * tags. Ported from open-design/apps/web/src/artifacts/parser.ts
 */

import { computeSkipRanges, FENCE_OPEN_RE, isRealArtifactOpenAt, rangeContains } from "./artifact-markdown-context"

export type ArtifactEvent =
  | { type: "text"; delta: string }
  | { type: "artifact:start"; identifier: string; artifactType: string; title: string; exports?: string; designSystemId?: string }
  | { type: "artifact:chunk"; identifier: string; delta: string }
  | { type: "artifact:end"; identifier: string; fullContent: string }

const OPEN_PREFIX = "<artifact"
const CLOSE_TAG = "</artifact>"

interface ParserState {
  inside: boolean
  buffer: string
  identifier: string
  artifactType: string
  title: string
  exports: string
  designSystemId: string
  content: string
}

function parseAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null = re.exec(raw)
  while (m !== null) {
    out[m[1] as string] = (m[2] ?? m[3] ?? "") as string
    m = re.exec(raw)
  }
  return out
}

type OpenTagMatch =
  | { kind: "complete"; start: number; end: number; attrs: string }
  | { kind: "partial"; start: number }
  | { kind: "none" }

function findOpenTag(buffer: string): OpenTagMatch {
  const len = buffer.length
  const { ranges, unclosedFenceStart } = computeSkipRanges(buffer)

  let earliestPartialOpen = -1
  let from = 0
  while (from < len) {
    const idx = buffer.indexOf(OPEN_PREFIX, from)
    if (idx === -1) break
    if (rangeContains(ranges, idx)) {
      from = idx + OPEN_PREFIX.length
      continue
    }
    if (unclosedFenceStart !== null && idx >= unclosedFenceStart) break
    const after = idx + OPEN_PREFIX.length
    const next = buffer.charAt(after)
    if (next === "") {
      if (earliestPartialOpen === -1) earliestPartialOpen = idx
      break
    }
    if (!isRealArtifactOpenAt(buffer, idx)) {
      from = after
      continue
    }
    let j = after
    let quote: '"' | "'" | null = null
    while (j < len) {
      const c = buffer.charAt(j)
      if (quote !== null) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === ">") {
        return { kind: "complete", start: idx, end: j + 1, attrs: buffer.slice(after, j) }
      }
      j++
    }
    if (earliestPartialOpen === -1) earliestPartialOpen = idx
    break
  }

  let holdback = -1
  const note = (pos: number | null) => {
    if (pos !== null && pos !== -1 && (holdback === -1 || pos < holdback)) holdback = pos
  }
  note(earliestPartialOpen)
  note(unclosedFenceStart)

  const lastNl = buffer.lastIndexOf("\n")
  if (lastNl < len - 1) {
    const tailLineStart = lastNl + 1
    const tail = buffer.slice(tailLineStart)
    if (FENCE_OPEN_RE.test(tail) || /^`{1,2}$/.test(tail)) {
      note(tailLineStart)
    }
  }

  let firstUnmatched = -1
  let parity = 0
  for (let k = lastNl + 1; k < len; k++) {
    if (buffer.charAt(k) !== "`") continue
    if (rangeContains(ranges, k)) continue
    if (parity === 0) {
      firstUnmatched = k
      parity = 1
    } else {
      firstUnmatched = -1
      parity = 0
    }
  }
  note(firstUnmatched)

  const tailLt = buffer.lastIndexOf("<")
  if (tailLt !== -1 && !rangeContains(ranges, tailLt)) {
    const slice = buffer.slice(tailLt)
    if (OPEN_PREFIX.startsWith(slice) && slice.length < OPEN_PREFIX.length) {
      note(tailLt)
    }
  }

  if (holdback !== -1) return { kind: "partial", start: holdback }
  return { kind: "none" }
}

/** Only detect full documents (starting with <!DOCTYPE or <html) as truncated — component fragments don't count */
export function isTruncatedHtml(content: string): boolean {
  const isFullDoc = /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content)
  if (!isFullDoc) return false
  return !content.toLowerCase().includes("</html>")
}

/** Repair truncated HTML: strip incomplete trailing tags + add closing tags */
export function repairTruncatedHtml(content: string): string {
  if (!isTruncatedHtml(content)) return content
  let fixed = content.replace(/<[^>]*$/, "")
  if (!fixed.toLowerCase().includes("</body>")) fixed += "\n</body>"
  if (!fixed.toLowerCase().includes("</html>")) fixed += "\n</html>"
  return fixed
}

export function createArtifactParser() {
  const state: ParserState = {
    inside: false,
    buffer: "",
    identifier: "",
    artifactType: "",
    title: "",
    exports: "",
    designSystemId: "",
    content: "",
  }

  function* feed(delta: string): Generator<ArtifactEvent> {
    state.buffer += delta

    while (state.buffer.length > 0) {
      if (!state.inside) {
        const open = findOpenTag(state.buffer)
        if (open.kind === "none") {
          yield { type: "text", delta: state.buffer }
          state.buffer = ""
          return
        }
        if (open.kind === "partial") {
          if (open.start > 0) {
            yield { type: "text", delta: state.buffer.slice(0, open.start) }
            state.buffer = state.buffer.slice(open.start)
          }
          return
        }
        if (open.start > 0) {
          yield { type: "text", delta: state.buffer.slice(0, open.start) }
        }
        const attrs = parseAttrs(open.attrs)
        state.inside = true
        state.identifier = attrs["identifier"] ?? ""
        state.artifactType = attrs["type"] ?? ""
        state.title = attrs["title"] ?? ""
        state.exports = attrs["exports"] ?? ""
        state.designSystemId = attrs["design-system-id"] ?? ""
        state.content = ""
        state.buffer = state.buffer.slice(open.end)
        yield {
          type: "artifact:start",
          identifier: state.identifier,
          artifactType: state.artifactType,
          title: state.title,
          exports: state.exports || undefined,
          designSystemId: state.designSystemId || undefined,
        }
        continue
      }

      const closeIdx = state.buffer.indexOf(CLOSE_TAG)
      if (closeIdx === -1) {
        const flushUpTo = state.buffer.length - (CLOSE_TAG.length - 1)
        if (flushUpTo > 0) {
          const chunk = state.buffer.slice(0, flushUpTo)
          state.content += chunk
          state.buffer = state.buffer.slice(flushUpTo)
          yield { type: "artifact:chunk", identifier: state.identifier, delta: chunk }
        }
        return
      }
      const finalChunk = state.buffer.slice(0, closeIdx)
      if (finalChunk.length > 0) {
        state.content += finalChunk
        yield { type: "artifact:chunk", identifier: state.identifier, delta: finalChunk }
      }
      yield { type: "artifact:end", identifier: state.identifier, fullContent: state.content }
      state.buffer = state.buffer.slice(closeIdx + CLOSE_TAG.length)
      state.inside = false
      state.identifier = ""
      state.artifactType = ""
      state.title = ""
      state.exports = ""
      state.designSystemId = ""
      state.content = ""
    }
  }

  function* flush(): Generator<ArtifactEvent> {
    if (state.inside) {
      if (state.buffer.length > 0) {
        state.content += state.buffer
        yield { type: "artifact:chunk", identifier: state.identifier, delta: state.buffer }
        state.buffer = ""
      }
      yield { type: "artifact:end", identifier: state.identifier, fullContent: state.content }
    } else if (state.buffer.length > 0) {
      yield { type: "text", delta: state.buffer }
    }
    state.buffer = ""
    state.inside = false
  }

  return { feed, flush }
}
