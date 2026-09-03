import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
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
  generation: `${root}/generations/:generationID`,
  generationCancel: `${root}/generations/:generationID/cancel`,
  generationReboot: `${root}/generations/:generationID/reboot`,
  editorEntries: `${root}/editor-entries`,
  promptTags: `${root}/prompt-tags`,
  promptGen: `${root}/prompt-gen`,
  styleDescriptionGen: `${root}/style-description-gen`,
  templatePublish: `${root}/template-publish`,
  templateList: `${root}/template-list`,
  templateDetail: `${root}/template-detail/:templateID`,
  permission: `${root}/permissions/check`,
} as const

export const StudioPermissionPayload = Schema.Struct({
  uid: Schema.optional(Schema.String),
})

export const StudioPromptGenPayload = Schema.Struct({
  base64img: Schema.String,
})

const StudioStyleDimensionId = Schema.Literals([
  "tonal",
  "composition",
  "volume",
  "surface",
  "color",
  "linework",
  "shape_structure",
  "role_design",
  "lettering",
  "post_processing",
])

export const StudioStyleDescriptionGenPayload = Schema.Struct({
  style_keywords: Schema.String,
  style_images: Schema.Array(
    Schema.Struct({
      url: Schema.String,
    }),
  ),
  style_dimensions: Schema.Array(StudioStyleDimensionId),
})

const StudioTemplateImagePayload = Schema.Struct({
  url: Schema.String,
})

const StudioStyleDescriptionPayload = Schema.Struct({
  overview: Schema.String,
  tonal: Schema.optional(Schema.String),
  composition: Schema.optional(Schema.String),
  volume: Schema.optional(Schema.String),
  surface: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  linework: Schema.optional(Schema.String),
  shape_structure: Schema.optional(Schema.String),
  role_design: Schema.optional(Schema.String),
  lettering: Schema.optional(Schema.String),
  post_processing: Schema.optional(Schema.String),
})

const StudioTemplatePublishBaseFields = {
  allowed_user_id: Schema.NullOr(Schema.String),
  creator_user_id: Schema.String,
  example_images: Schema.Array(StudioTemplateImagePayload),
  permission_type: Schema.Union([Schema.Literal("all_users"), Schema.Literal("specified_users")]),
  prompt_setting: Schema.Union([Schema.Literal("required"), Schema.Literal("optional"), Schema.Literal("not_supported")]),
  reference_image_count: Schema.Union([Schema.Literal(0), Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)]),
  reference_image_setting: Schema.Union([Schema.Literal("fixed"), Schema.Literal("optional"), Schema.Literal("not_supported")]),
  title: Schema.String,
  usage_instructions: Schema.String,
}

const StudioStyleTemplatePublishPayload = Schema.Struct({
  ...StudioTemplatePublishBaseFields,
  template_type: Schema.Literal("extract_style"),
  style_description: StudioStyleDescriptionPayload,
  style_images: Schema.Array(StudioTemplateImagePayload),
  style_keywords: Schema.String,
})

const StudioRecipeTemplatePublishPayload = Schema.Struct({
  ...StudioTemplatePublishBaseFields,
  template_type: Schema.Literal("preset_recipe"),
  fixed_reference_images: Schema.Array(StudioTemplateImagePayload),
  play_description: Schema.String,
})

export const StudioTemplatePublishPayload = Schema.Union([
  StudioStyleTemplatePublishPayload,
  StudioRecipeTemplatePublishPayload,
])

export const StudioTemplateListQuery = Schema.Struct({
  user_id: Schema.String,
  only_public: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  page: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  page_size: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(20), Schema.isLessThanOrEqualTo(20)),
})

export const StudioTemplateDetailQuery = Schema.Struct({
  user_id: Schema.String,
})

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
  displayPrompt: Schema.optional(Schema.String),
  detailPrompt: Schema.optional(Schema.String),
  detailTitle: Schema.optional(Schema.String),
  initialSessionTitle: Schema.optional(Schema.String),
  shouldSetSessionTitle: Schema.optional(Schema.Boolean),
  refinedPrompt: Schema.optional(Schema.String),
  effectivePrompt: Schema.optional(Schema.String),
  promptRefineModels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
  ),
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Int),
  imageTool: Schema.optional(Schema.Union([Schema.Literal("jimeng"), Schema.Literal("internel")])),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const StudioEditorEntryPayload = Schema.Struct({
  sessionID: Schema.String,
  capability: Schema.Literals([
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
  ]),
  entryID: Schema.String,
})

const StudioEditorEntryResult = Schema.Struct({
  entryID: Schema.String,
  userMessageID: Schema.String,
  assistantMessageID: Schema.String,
})

const StudioGenerationImage = Schema.Struct({
  id: Schema.String,
  kind: Schema.optional(Schema.Union([Schema.Literal("image"), Schema.Literal("video")])),
  url: Schema.String,
  thumbnailUrl: Schema.optional(Schema.String),
  remoteUrl: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
})

const StudioGenerationResult = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  status: Schema.Union([
    Schema.Literal("queued"),
    Schema.Literal("running"),
    Schema.Literal("succeeded"),
    Schema.Literal("create_failed"),
    Schema.Literal("failed"),
  ]),
  capability: StudioGenerationPayload.fields.capability,
  prompt: Schema.String,
  displayPrompt: Schema.optional(Schema.String),
  detailPrompt: Schema.optional(Schema.String),
  detailTitle: Schema.optional(Schema.String),
  provider: Schema.Union([Schema.Literal("jimeng"), Schema.Literal("internel")]),
  toolAction: Schema.optional(Schema.Union([
    Schema.Literal("generate_image"),
    Schema.Literal("generate_video"),
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
  videoMode: Schema.optional(Schema.Union([Schema.Literal("text"), Schema.Literal("first_last_frame")])),
  duration: Schema.optional(Schema.String),
  videoQualityMode: Schema.optional(Schema.Union([Schema.Literal("std"), Schema.Literal("pro")])),
  images: Schema.Array(StudioGenerationImage),
  progress: Schema.Number,
  order: Schema.optional(Schema.Number),
  rawStatus: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  error: Schema.optional(Schema.String),
  request: Schema.optional(Schema.Unknown),
  response: Schema.optional(Schema.Unknown),
  rawBody: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
})

export const StudioApi = HttpApi.make("studio")
  .add(
    HttpApiGroup.make("studio")
      .add(
        HttpApiEndpoint.get("listPromptTags", StudioPaths.promptTags, {
          success: described(Schema.Unknown, "Prompt tags list"),
          error: ApiStudioGenerationError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.prompt-tags.list",
            summary: "Get prompt tags",
            description: "Returns prompt tag categories from the internal image API.",
          }),
        ),
        HttpApiEndpoint.post("checkPermission", StudioPaths.permission, {
          payload: StudioPermissionPayload,
          success: described(Schema.Unknown, "Studio permission result"),
          error: ApiStudioGenerationError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.permissions.check",
            summary: "Check Studio permission",
            description: "Checks whether the current user can access the internal Studio entry.",
          }),
        ),
        HttpApiEndpoint.post("createPromptGen", StudioPaths.promptGen, {
          payload: StudioPromptGenPayload,
          success: described(Schema.Unknown, "Prompt generation result"),
          error: ApiStudioGenerationError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.prompt-gen.create",
            summary: "Generate prompt from reference image",
            description: "Returns generated prompt text from the internal image prompt generation API.",
          }),
        ),
        HttpApiEndpoint.post("createStyleDescriptionGen", StudioPaths.styleDescriptionGen, {
          payload: StudioStyleDescriptionGenPayload,
          success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.style-description-gen.create",
            summary: "Generate style description",
            description: "Streams style description fields from the internal Studio style template API.",
          }),
        ),
        HttpApiEndpoint.post("publishTemplate", StudioPaths.templatePublish, {
          payload: StudioTemplatePublishPayload,
          success: described(Schema.Unknown, "Studio template publish result"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.template-publish.create",
            summary: "Publish Studio template",
            description: "Publishes a Studio style template or preset recipe using the internal Studio style template API.",
          }),
        ),
        HttpApiEndpoint.get("listTemplates", StudioPaths.templateList, {
          query: StudioTemplateListQuery,
          success: described(Schema.Unknown, "Studio template list result"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.template-list.list",
            summary: "List Studio templates",
            description: "Returns paged Studio style templates from the internal Studio style template API.",
          }),
        ),
        HttpApiEndpoint.get("getTemplateDetail", StudioPaths.templateDetail, {
          params: { templateID: Schema.String },
          query: StudioTemplateDetailQuery,
          success: described(Schema.Unknown, "Studio template detail result"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.template-detail.get",
            summary: "Get Studio template detail",
            description: "Returns a Studio template by id from the internal Studio style template API.",
          }),
        ),
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
        HttpApiEndpoint.post("createEditorEntry", StudioPaths.editorEntries, {
          payload: StudioEditorEntryPayload,
          success: described(StudioEditorEntryResult, "Studio editor entry result"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.editor-entries.create",
            summary: "Create Studio editor entry",
            description: "Persists a Studio editor entry conversation turn without starting a generation.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("cancelGeneration", StudioPaths.generationCancel, {
          params: { generationID: Schema.String },
          success: described(StudioGenerationResult, "Cancelled Studio generation"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.generations.cancel",
            summary: "Cancel Studio generation",
            description: "Cancels an active asynchronous Studio generation.",
          }),
        ),
        HttpApiEndpoint.post("rebootGeneration", StudioPaths.generationReboot, {
          params: { generationID: Schema.String },
          success: described(StudioGenerationResult, "Rebooted Studio generation"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.generations.reboot",
            summary: "Reboot Studio generation",
            description: "Reboots a failed asynchronous Studio generation with an existing provider task id.",
          }),
        ),
        HttpApiEndpoint.get("getGeneration", StudioPaths.generation, {
          params: { generationID: Schema.String },
          success: described(StudioGenerationResult, "Studio generation status"),
          error: [HttpApiError.BadRequest, ApiStudioGenerationError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "studio.generations.get",
            summary: "Get Studio generation",
            description: "Get the current status and result of an asynchronous Studio generation.",
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
