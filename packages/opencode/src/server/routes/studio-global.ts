import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { checkStudioPermission } from "@/tool/internel_image_generate"
import { lazy } from "@/util/lazy"

const StudioPermissionInput = z.object({
  uid: z.string().optional(),
})

const StudioPermissionError = z.object({
  name: z.literal("StudioPermissionError"),
  data: z.object({ message: z.string() }),
})

export const StudioGlobalRoutes = lazy(() =>
  new Hono().post(
    "/permissions/check",
    describeRoute({
      summary: "Check Studio permission",
      description: "Checks Studio capabilities without initializing a workspace instance.",
      operationId: "global.studio.permissions.check",
      responses: {
        200: {
          description: "Studio permission result",
          content: { "application/json": { schema: resolver(z.unknown()) } },
        },
        502: {
          description: "Studio permission provider error",
          content: { "application/json": { schema: resolver(StudioPermissionError) } },
        },
      },
    }),
    validator("json", StudioPermissionInput),
    async (c) =>
      checkStudioPermission(c.req.valid("json").uid)
        .then((result) => c.json(result))
        .catch((error) =>
          c.json(
            {
              name: "StudioPermissionError" as const,
              data: { message: error instanceof Error ? error.message : String(error) },
            },
            502,
          ),
        ),
  ),
)
