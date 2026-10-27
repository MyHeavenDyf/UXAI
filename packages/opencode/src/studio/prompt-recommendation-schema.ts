import { Schema } from "effect"
import z from "zod"

export const InitializePayload = Schema.Struct({
  requestID: Schema.String,
  sessionID: Schema.optional(Schema.String),
  expectedStateToken: Schema.optional(Schema.String),
})
export const ExpansionPayload = Schema.Struct({
  requestID: Schema.String,
  sessionID: Schema.String,
  guidePartID: Schema.String,
  prompt: Schema.String,
  images: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
      }),
    ),
  ),
  availableModels: Schema.Array(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
})
export const ExpansionStatus = Schema.Literals(["running", "cancelling", "completed", "failed", "cancelled"])
export const RecommendationSummary = Schema.Struct({
  sessionID: Schema.String,
  guideMessageID: Schema.String,
  guidePartID: Schema.String,
  guideRevision: Schema.Number,
  status: Schema.Literals(["armed", "running", "cancelling", "completed", "failed", "cancelled"]),
  resultRevision: Schema.optional(Schema.Number),
  userMessageID: Schema.optional(Schema.String),
  assistantMessageID: Schema.optional(Schema.String),
  submission: Schema.optional(Schema.Struct({ requestID: Schema.String })),
})
export const RecommendationState = Schema.Struct({
  stateToken: Schema.String,
  recommendation: Schema.NullOr(RecommendationSummary),
})
export const RecommendationResponse = Schema.Struct({
  ...RecommendationSummary.fields,
  stateToken: Schema.String,
})
export const RecommendationErrorBody = Schema.Struct({
  name: Schema.Literal("StudioPromptRecommendationError"),
  data: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    guidePartID: Schema.optional(Schema.String),
    stateToken: Schema.optional(Schema.String),
  }),
})

export const guideSchema = z.object({
  version: z.literal(1),
  kind: z.literal("guide"),
  revision: z.number().int().positive(),
  initializeRequestID: z.string().uuid(),
  initializeDigest: z.string(),
  status: z.enum(["armed", "consumed"]),
  submission: z
    .object({
      requestID: z.string().uuid(),
      digest: z.string(),
      userMessageID: z.string(),
      assistantMessageID: z.string(),
      resultPartID: z.string(),
    })
    .optional(),
})
export const resultSchema = z.object({
  version: z.literal(1),
  kind: z.literal("result"),
  revision: z.number().int().positive(),
  guidePartID: z.string(),
  status: z.enum(["running", "cancelling", "completed", "failed", "cancelled"]),
  tags: z.array(z.string()).optional(),
  errorCode: z.string().optional(),
})
export const initializeSchema = z.object({
  requestID: z.string().uuid(),
  sessionID: z.string().optional(),
  expectedStateToken: z.string().optional(),
})
export const submissionSchema = z.object({
  sessionID: z.string(),
  guidePartID: z.string(),
  requestID: z.string().uuid(),
  images: z
    .array(
      z.object({
        path: z.string().min(1).max(4096),
      }),
    )
    .max(3)
    .default([]),
  availableModels: z
    .array(z.object({ providerID: z.string().trim().min(1).max(256), modelID: z.string().trim().min(1).max(256) }))
    .min(1)
    .max(100),
  prompt: z
    .string()
    .trim()
    .refine((text) => [...text].length >= 1 && [...text].length <= 2000),
})
export type Submission = z.infer<typeof submissionSchema>
export type ExpansionInput = Omit<Submission, "images"> & {
  images: { path: string; mime: "image/png" | "image/jpeg" | "image/webp"; base64: string }[]
}
export type Guide = z.infer<typeof guideSchema>
export type Expansion = z.infer<typeof resultSchema>

export class RecommendationError extends Error {
  override readonly name = "StudioPromptRecommendationError"
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 413 | 429 | 503 = 400,
    readonly details?: { guidePartID?: string; stateToken?: string },
  ) {
    super(code)
  }
  body() {
    return {
      name: this.name,
      data: {
        code: this.code,
        message: "Studio prompt recommendation request could not be completed.",
        ...this.details,
      },
    }
  }
}
export function safeError(error: unknown) {
  return error instanceof RecommendationError ? error : new RecommendationError("MODEL_REQUEST_FAILED", 503)
}
export const GUIDE_TEXT = "你好～我可以帮你丰富提示词，快来分享你的灵感，一起创造有趣的内容～"
