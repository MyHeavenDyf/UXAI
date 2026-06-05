import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/studio"

export class ApiStudioGenerationError extends Schema.ErrorClass<ApiStudioGenerationError>("StudioGenerationError")(
  {
    name: Schema.Literal("StudioGenerationError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const StudioPaths = {
  generations: `${root}/generations`,
} as const

export const StudioGenerationPayload = Schema.Struct({
  sessionID: Schema.optional(Schema.String),
  capability: Schema.Literals([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ]),
  prompt: Schema.String,
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Int),
  imageTool: Schema.optional(Schema.Union([Schema.Literal("jimeng"), Schema.Literal("internel")])),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const StudioGenerationImage = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  thumbnailUrl: Schema.optional(Schema.String),
  remoteUrl: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
})

const StudioGenerationResult = Schema.Struct({
  id: Schema.String,
  status: Schema.Literal("succeeded"),
  capability: StudioGenerationPayload.fields.capability,
  prompt: Schema.String,
  provider: Schema.Union([Schema.Literal("jimeng"), Schema.Literal("internel")]),
  toolAction: Schema.optional(Schema.Union([
    Schema.Literal("generate_image"),
    Schema.Literal("super_resolution"),
    Schema.Literal("cutout"),
    Schema.Literal("inpainting"),
    Schema.Literal("outpainting"),
  ])),
  taskType: Schema.optional(Schema.String),
  task_type: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  model: Schema.String,
  aspectRatio: Schema.String,
  images: Schema.Array(StudioGenerationImage),
  request: Schema.optional(Schema.Unknown),
  response: Schema.optional(Schema.Unknown),
  rawBody: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  completedAt: Schema.Number,
})

export const StudioApi = HttpApi.make("studio")
  .add(
    HttpApiGroup.make("studio")
      .add(
        HttpApiEndpoint.post("createGeneration", StudioPaths.generations, {
          payload: StudioGenerationPayload,
          success: described(StudioGenerationResult, "Studio generation result"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.generations.create",
            summary: "Create Studio image generation",
            description: "Generate images using the built-in Studio image generation tool.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "studio",
          description: "Experimental HttpApi Studio routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
