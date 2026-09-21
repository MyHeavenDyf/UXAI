export const REQUIRED_HEADINGS = [
  "## Goal",
  "## Constraints & Preferences",
  "## Progress",
  "## Key Decisions",
  "## Next Steps",
  "## Critical Context",
  "## Relevant Files",
] as const

const CORE_HEADINGS = new Set<string>(["## Goal", "## Progress", "## Next Steps"])

function normalizeHeading(line: string) {
  const title = line.trim().replace(/^(?:#\s*)+/, "").replace(/\s*#+$/, "").trim()
  return REQUIRED_HEADINGS.find((heading) => heading.slice(3) === title) ?? line.trim()
}

export function validate(summary: string | undefined) {
  const lines = summary?.split(/\r?\n/).map(normalizeHeading) ?? []
  const missing = REQUIRED_HEADINGS.filter((heading) => !lines.includes(heading))
  return {
    valid: !!summary?.trim() && missing.length === 0,
    missing,
    missingCore: missing.filter((heading) => CORE_HEADINGS.has(heading)),
  }
}

export function repair(summary: string | undefined) {
  const validation = validate(summary)
  if (!summary?.trim()) {
    return { ...validation, summary, repaired: [] as string[] }
  }

  const original = summary.trim().split(/\r?\n/)
  const lines = original.map(normalizeHeading)
  const normalized = REQUIRED_HEADINGS.filter(
    (heading) => !original.some((line) => line.trim() === heading) && lines.includes(heading),
  )
  const missing = REQUIRED_HEADINGS.filter((heading) => !lines.includes(heading))
  for (const heading of missing) {
    const next = REQUIRED_HEADINGS.slice(REQUIRED_HEADINGS.indexOf(heading) + 1).find((item) =>
      lines.some((line) => line.trim() === item),
    )
    const index = next ? lines.findIndex((line) => line.trim() === next) : lines.length
    const prefix = index > 0 && lines[index - 1]?.trim() ? [""] : []
    lines.splice(index, 0, ...prefix, heading, "- (none)", "")
  }

  const value = lines.join("\n").trim()
  return { ...validate(value), summary: value, repaired: [...normalized, ...missing] }
}

export * as CompactionSummary from "./compaction-summary"
