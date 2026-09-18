import { checkStudioPermission, studioPermissionServerTiming, type StudioPermissionTiming } from "@/tool/internel_image_generate"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { StudioGlobalPermissionPayload } from "../groups/studio-global"

export const studioGlobalHandlers = HttpApiBuilder.group(RootHttpApi, "studio.global", (handlers) =>
  handlers.handle("checkPermission", (ctx: { payload: typeof StudioGlobalPermissionPayload.Type }) => {
    const handlerStartedAt = performance.now()
    const timing: { value?: StudioPermissionTiming } = {}
    const headers = () => ({
      "Server-Timing": studioPermissionServerTiming(timing.value, performance.now() - handlerStartedAt),
    })
    return Effect.tryPromise({
      try: () => checkStudioPermission(ctx.payload.uid, (value) => {
        timing.value = value
      }),
      catch: (error) => error,
    }).pipe(
      Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { headers: headers() })),
      Effect.catch((error) => Effect.succeed(HttpServerResponse.jsonUnsafe(
        {
          name: "StudioPermissionError" as const,
          data: { message: error instanceof Error ? error.message : String(error) },
        },
        { status: 502, headers: headers() },
      ))),
    )
  }),
)
