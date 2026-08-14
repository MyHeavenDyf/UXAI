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

export function validate(summary: string | undefined) {
  const lines = summary?.split(/\r?\n/).map((line) => line.trim()) ?? []
  const missing = REQUIRED_HEADINGS.filter((heading) => !lines.includes(heading))
  return {
    valid: !!summary?.trim() && missing.length === 0,
    missing,
    missingCore: missing.filter((heading) => CORE_HEADINGS.has(heading)),
  }
}

export function repair(summary: string | undefined) {
  const validation = validate(summary)
  if (!summary?.trim() || validation.missingCore.length) {
    return { ...validation, summary, repaired: [] as string[] }
  }

  const lines = summary.trim().split(/\r?\n/)
  const repaired = validation.missing.filter((heading) => !CORE_HEADINGS.has(heading))
  for (const heading of repaired) {
    const next = REQUIRED_HEADINGS.slice(REQUIRED_HEADINGS.indexOf(heading) + 1).find((item) =>
      lines.some((line) => line.trim() === item),
    )
    const index = next ? lines.findIndex((line) => line.trim() === next) : lines.length
    const prefix = index > 0 && lines[index - 1]?.trim() ? [""] : []
    lines.splice(index, 0, ...prefix, heading, "- (none)", "")
  }

  const value = lines.join("\n").trim()
  return { ...validate(value), summary: value, repaired }
}

export * as CompactionSummary from "./compaction-summary"
