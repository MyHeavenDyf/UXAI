export function normalizeReleaseNotes(releaseNotes: string | Array<{ note: string | null }> | null | undefined) {
  if (typeof releaseNotes === "string") return releaseNotes.trim() || undefined
  if (!Array.isArray(releaseNotes)) return
  return (
    releaseNotes
      .map((item) => item.note?.trim())
      .filter((note): note is string => Boolean(note))
      .join("\n\n") || undefined
  )
}
