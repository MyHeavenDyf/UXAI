import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { PositiveInt, withStatics } from "@/util/schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable cross-session agent-maintained memory (default: true)",
  }),
  budget_tokens: Schema.optional(PositiveInt).annotate({
    description:
      "Token budget for the injected memory index and the post-write size reminder threshold (default: 2000)",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMemory from "./memory"
