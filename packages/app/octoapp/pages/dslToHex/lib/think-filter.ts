const THINK_OPEN = "<think>"
const THINK_CLOSE = "</think>"
const THINK_OPEN_LEN = THINK_OPEN.length
const THINK_CLOSE_LEN = THINK_CLOSE.length
const MAX_PREFIX_LEN = THINK_OPEN_LEN - 1

const PARTIAL_PREFIXES: string[] = []
for (let i = 1; i < THINK_OPEN_LEN; i++) {
  PARTIAL_PREFIXES.push(THINK_OPEN.slice(0, i))
}

function endsWithPartialPrefix(text: string): number {
  for (let i = PARTIAL_PREFIXES.length - 1; i >= 0; i--) {
    if (text.endsWith(PARTIAL_PREFIXES[i])) return PARTIAL_PREFIXES[i].length
  }
  return 0
}

export interface ThinkFilter {
  feed(delta: string): string
  flush(): string
  reset(): void
}

export function createThinkFilter(): ThinkFilter {
  let inThink = false
  let pending = ""

  function processOpenTag(): string {
    const working = pending
    const idx = working.indexOf(THINK_OPEN)
    if (idx !== -1) {
      const clean = working.slice(0, idx)
      pending = working.slice(idx + THINK_OPEN_LEN)
      inThink = true
      let more = ""
      if (pending.length > 0) more = processCloseTag()
      return clean + more
    }
    const prefixLen = endsWithPartialPrefix(working)
    if (prefixLen > 0) {
      const safeEnd = working.length - prefixLen
      const clean = working.slice(0, safeEnd)
      pending = working.slice(safeEnd)
      return clean
    }
    const clean = working
    pending = ""
    return clean
  }

  function processCloseTag(): string {
    const idx = pending.indexOf(THINK_CLOSE)
    if (idx !== -1) {
      pending = pending.slice(idx + THINK_CLOSE_LEN)
      inThink = false
      let more = ""
      if (pending.length > 0) more = processOpenTag()
      return more
    }
    return ""
  }

  return {
    feed(delta: string): string {
      if (!delta) return ""
      pending += delta
      if (inThink) {
        return processCloseTag()
      }
      return processOpenTag()
    },
    flush(): string {
      if (inThink) {
        pending = ""
        return ""
      }
      const result = pending
      pending = ""
      return result
    },
    reset(): void {
      inThink = false
      pending = ""
    },
  }
}

export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
}
