import z from "zod"
import type { Part } from "@opencode-ai/sdk/v2/client"

const base = { version: z.literal(1), revision: z.number().int().positive() }
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
  const old = promptMetadata(previous)
  const current = promptMetadata(next)
  return previous && old && (!current || old.revision >= current.revision) ? previous : next
}
