import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { PositiveInt, withStatics } from "@/util/schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable cross-session auto memory (default: true)",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model for memory extraction in the format provider/model. Defaults to the title model.",
  }),
  budget_tokens: Schema.optional(PositiveInt).annotate({
    description: "Maximum estimated tokens for the injected memory index (default: 2000)",
  }),
  extraction_interval_seconds: Schema.optional(PositiveInt).annotate({
    description: "Minimum interval in seconds between memory extractions per session (default: 60)",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMemory from "./memory"
