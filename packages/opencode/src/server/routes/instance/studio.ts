import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { createEditorEntry, createGeneration, getGeneration } from "@/studio/studio-service"
import { checkStudioPermission, fetchPromptTags } from "@/tool/internel_image_generate"
import { errors } from "../../error"

const StudioPermissionInput = z.object({
  uid: z.string().optional(),
})

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
  .get("/generations/:generationID", async (c) => c.json(await getGeneration(c.req.param("generationID")))),
)
