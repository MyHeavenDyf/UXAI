import z from "zod"
import type { Part } from "@opencode-ai/sdk/v2/client"

const base = { version: z.literal(1), revision: z.number().int().positive() }
const reasoning = z.object({ version: z.literal(1) })
const preview = z.object({ version: z.literal(1), attempt: z.union([z.literal(1), z.literal(2)]), resultPartID: z.string().min(1) })

export function previewMetadata(part?: Part) {
  if (part?.type !== "text") return
  const parsed = preview.safeParse(part.metadata?.studioPromptExpansionPreview)
  return parsed.success ? parsed.data : undefined
}

export function isExpansionPreview(part?: Part): part is Extract<Part, { type: "text" }> {
  return part?.type === "text" && previewMetadata(part) !== undefined
}

export function latestExpansionPreview(parts: Part[], resultPartID: string) {
  return parts.filter(isExpansionPreview)
    .filter((part) => previewMetadata(part)?.resultPartID === resultPartID)
    .sort((a, b) => (previewMetadata(b)?.attempt ?? 0) - (previewMetadata(a)?.attempt ?? 0) || b.id.localeCompare(a.id))[0]
}

export function isExpansionReasoning(part?: Part): part is Extract<Part, { type: "reasoning" }> {
  return part?.type === "reasoning" && reasoning.safeParse(part.metadata?.studioPromptExpansionReasoning).success
}
const guide = z.object({ ...base, kind: z.literal("guide"), status: z.enum(["armed", "consumed"]) })
const result = z.object({
  ...base,
  kind: z.literal("result"),
  guidePartID: z.string(),
  status: z.enum(["running", "cancelling", "completed", "failed", "cancelled"]),
  tags: z.array(z.string()).optional(),
})

export function promptMetadata(part?: Part) {
  if (part?.type !== "text") return
  const parsed = z
    .union([guide, result])
    .safeParse(part.metadata?.studioPromptRecommendation ?? part.metadata?.studioPromptExpansion)
  return parsed.success ? parsed.data : undefined
}

export function mergePromptPart(previous: Part | undefined, next: Part) {
  if (previous?.id === next.id &&
    ((isExpansionReasoning(previous) && isExpansionReasoning(next)) || (isExpansionPreview(previous) && isExpansionPreview(next)))) {
    if (previous.time?.end !== undefined && next.time?.end === undefined) return previous
    if (next.time?.end !== undefined) {
      return previous.time?.end !== undefined && previous.text.startsWith(next.text) ? previous : next
    }
    return previous.text.startsWith(next.text) ? previous : next
  }
  const old = promptMetadata(previous)
  const current = promptMetadata(next)
  return previous && old && (!current || old.revision >= current.revision) ? previous : next
}
