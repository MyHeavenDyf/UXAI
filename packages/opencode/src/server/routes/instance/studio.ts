import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { lazy } from "@/util/lazy"
import { cancelGeneration, createEditorEntry, createGeneration, createPromptGen, createStyleDescriptionGenStream, getGeneration, publishTemplate, rebootGeneration } from "@/studio/studio-service"
import { checkStudioPermission, fetchPromptTags } from "@/tool/internel_image_generate"
import { errors } from "../../error"
import { configureModelsApiHeaders } from "@/plugin/model-headers"

const StudioPermissionInput = z.object({
  uid: z.string().optional(),
})

const StudioPromptGenInput = z.object({
  base64img: z.string().min(1),
})

const StudioStyleDimensionId = z.enum([
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

const StudioStyleDescriptionGenInput = z.object({
  style_keywords: z.string(),
  style_images: z.array(z.object({ url: z.string().min(1) })).min(3),
  style_dimensions: z.array(StudioStyleDimensionId),
})

const StudioTemplateImageInput = z.object({
  url: z.string().min(1),
})

const StudioTemplatePublishBaseInput = z.object({
  allowed_user_id: z.string().nullable(),
  creator_user_id: z.string(),
  example_images: z.array(StudioTemplateImageInput).min(1).max(20),
  permission_type: z.enum(["all_users", "specified_users"]),
  prompt_setting: z.enum(["required", "optional", "not_supported"]),
  reference_image_count: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  reference_image_setting: z.enum(["fixed", "optional", "not_supported"]),
  title: z.string().min(1),
  usage_instructions: z.string().min(1),
})

const StudioStyleTemplatePublishInput = StudioTemplatePublishBaseInput.extend({
  template_type: z.literal("extract_style"),
  style_description: z.object({
    overview: z.string(),
    tonal: z.string().optional(),
    composition: z.string().optional(),
    volume: z.string().optional(),
    surface: z.string().optional(),
    color: z.string().optional(),
    linework: z.string().optional(),
    shape_structure: z.string().optional(),
    role_design: z.string().optional(),
    lettering: z.string().optional(),
    post_processing: z.string().optional(),
  }),
  style_images: z.array(StudioTemplateImageInput).min(3).max(30),
  style_keywords: z.string(),
})

const StudioRecipeTemplatePublishInput = StudioTemplatePublishBaseInput.extend({
  template_type: z.literal("preset_recipe"),
  fixed_reference_images: z.array(StudioTemplateImageInput).max(3),
  play_description: z.string().min(1),
})

const StudioTemplatePublishInput = z.discriminatedUnion("template_type", [
  StudioStyleTemplatePublishInput,
  StudioRecipeTemplatePublishInput,
])

const StudioGenerationInput = z.object({
  sessionID: z.string().optional(),
  capability: z.enum([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ]),
  prompt: z.string().min(1),
  displayPrompt: z.string().optional(),
  detailPrompt: z.string().optional(),
  detailTitle: z.string().optional(),
  initialSessionTitle: z.string().optional(),
  shouldSetSessionTitle: z.boolean().optional(),
  refinedPrompt: z.string().optional(),
  effectivePrompt: z.string().optional(),
  promptRefineModels: z
    .array(
      z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
    )
    .optional(),
  styleModel: z.string().optional(),
  aspectRatio: z.string().optional(),
  count: z.number().int().min(1).max(4).optional(),
  imageTool: z.enum(["jimeng", "internel"]).optional(),
  referenceImages: z.array(z.string()).optional(),
  sourceImage: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

const StudioEditorEntryInput = z.object({
  sessionID: z.string(),
  capability: z.enum([
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
  ]),
  entryID: z.string().min(1),
})

export const StudioRoutes = lazy(() =>
  new Hono()
    .get(
      "/prompt-tags",
      describeRoute({
        summary: "Get prompt tags",
        description: "Returns prompt tag categories from the internal image API.",
        operationId: "studio.prompt-tags.list",
        responses: {
          200: {
            description: "Prompt tags list",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(502),
        },
      }),
      async (c) => {
        const data = await fetchPromptTags()
        return c.json(data)
      },
    )
    .post(
      "/prompt-gen",
      describeRoute({
        summary: "Generate prompt from reference image",
        description: "Returns generated prompt text from the internal image prompt generation API.",
        operationId: "studio.prompt-gen.create",
        responses: {
          200: {
            description: "Prompt generation result",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(400, 502),
        },
      }),
      validator("json", StudioPromptGenInput),
      async (c) => c.json(await createPromptGen(c.req.valid("json"))),
    )
    .post(
      "/style-description-gen",
      describeRoute({
        summary: "Generate style description",
        description: "Streams style description fields from the internal Studio style template API.",
        operationId: "studio.style-description-gen.create",
        responses: {
          200: {
            description: "Style description generation stream",
            content: {
              "text/event-stream": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400, 502),
        },
      }),
      validator("json", StudioStyleDescriptionGenInput),
      async (c) => {
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        const input = c.req.valid("json")
        return streamSSE(c, async (stream) => {
          const controller = new AbortController()
          stream.onAbort(() => controller.abort())

          try {
            await createStyleDescriptionGenStream(input, {
              signal: controller.signal,
              onEvent: (event) => stream.writeSSE({ data: JSON.stringify(event) }),
            })
          } catch (error) {
            if (!controller.signal.aborted) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "error",
                  content: error instanceof Error ? error.message : String(error),
                }),
              })
            }
          }
        })
      },
    )
    .post(
      "/permissions/check",
      describeRoute({
        summary: "Check Studio permission",
        description: "Checks whether the current user can access the internal Studio entry.",
        operationId: "studio.permissions.check",
        responses: {
          200: {
            description: "Studio permission result",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(502),
        },
      }),
      validator("json", StudioPermissionInput),
      async (c) => c.json(await checkStudioPermission(c.req.valid("json").uid)),
    )
    .post(
      "/template-publish",
      describeRoute({
        summary: "Publish Studio template",
        description: "Publishes a Studio style template or preset recipe using the internal Studio style template API.",
        operationId: "studio.template-publish.create",
        responses: {
          200: {
            description: "Studio template publish result",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(400, 502),
        },
      }),
      validator("json", StudioTemplatePublishInput),
      async (c) => c.json(await publishTemplate(c.req.valid("json"))),
    )
    .post(
      "/editor-entries",
      describeRoute({
        summary: "Create Studio editor entry",
        description: "Persists a Studio editor entry conversation turn without starting a generation.",
        operationId: "studio.editor-entries.create",
        responses: {
          200: {
            description: "Studio editor entry created",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(400),
        },
      }),
      validator("json", StudioEditorEntryInput),
      async (c) => c.json(await createEditorEntry(c.req.valid("json"))),
    )
    .post(
      "/generations",
      describeRoute({
        summary: "Create Studio image generation",
        description: "Generate images using the built-in Studio image generation tool.",
        operationId: "studio.generations.create",
        responses: {
          202: {
            description: "Studio generation accepted",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", StudioGenerationInput),
      async (c) => {
        configureModelsApiHeaders(Object.fromEntries(c.req.raw.headers.entries()))
        const input = c.req.valid("json")
        console.log("[studio.route] POST /studio/generations", {
          sessionID: input.sessionID,
          capability: input.capability,
          prompt: input.prompt,
          styleModel: input.styleModel,
          aspectRatio: input.aspectRatio,
          count: input.count,
          imageTool: input.imageTool,
          referenceImageCount: input.referenceImages?.length ?? 0,
          hasSourceImage: Boolean(input.sourceImage),
        })
        return c.json(await createGeneration(input), 202)
      },
    )
  .post("/generations/:generationID/cancel", async (c) => c.json(await cancelGeneration(c.req.param("generationID"))))
  .post("/generations/:generationID/reboot", async (c) => c.json(await rebootGeneration(c.req.param("generationID"))))
  .get("/generations/:generationID", async (c) => c.json(await getGeneration(c.req.param("generationID")))),
)
