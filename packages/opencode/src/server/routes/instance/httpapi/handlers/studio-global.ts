import { checkStudioPermission } from "@/tool/internel_image_generate"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ApiStudioPermissionError, StudioGlobalPermissionPayload } from "../groups/studio-global"

export const studioGlobalHandlers = HttpApiBuilder.group(RootHttpApi, "studio.global", (handlers) =>
  handlers.handle("checkPermission", (ctx: { payload: typeof StudioGlobalPermissionPayload.Type }) =>
    Effect.tryPromise({
      try: () => checkStudioPermission(ctx.payload.uid),
      catch: (error) =>
        new ApiStudioPermissionError({
          name: "StudioPermissionError",
          data: { message: error instanceof Error ? error.message : String(error) },
        }),
    }),
  ),
)
