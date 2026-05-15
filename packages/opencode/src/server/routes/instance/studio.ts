import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { createGeneration } from "@/studio/studio-service"
import { errors } from "../../error"

const StudioGenerationInput = z.object({
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
  referenceImages: z.array(z.string()).optional(),
  sourceImage: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

export const StudioRoutes = lazy(() =>
  new Hono().post(
    "/generations",
    describeRoute({
      summary: "Create Studio image generation",
      description: "Generate images using the built-in Studio image generation tool.",
      operationId: "studio.generations.create",
      responses: {
        200: {
          description: "Studio generation result",
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
        capability: input.capability,
        prompt: input.prompt,
        styleModel: input.styleModel,
        aspectRatio: input.aspectRatio,
        count: input.count,
        referenceImageCount: input.referenceImages?.length ?? 0,
        hasSourceImage: Boolean(input.sourceImage),
      })
      return c.json(await createGeneration(input))
    },
  ),
)
