import { createGeneration } from "@/studio/studio-service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiStudioGenerationError, StudioGenerationPayload } from "../groups/studio"

export const studioHandlers = HttpApiBuilder.group(InstanceHttpApi, "studio", (handlers) =>
  Effect.gen(function* () {
    const create = Effect.fn("StudioHttpApi.createGeneration")(function* (ctx: {
      payload: typeof StudioGenerationPayload.Type
    }) {
      console.log("[studio.httpapi] POST /studio/generations", {
        capability: ctx.payload.capability,
        prompt: ctx.payload.prompt,
        styleModel: ctx.payload.styleModel,
        aspectRatio: ctx.payload.aspectRatio,
        count: ctx.payload.count,
        referenceImageCount: ctx.payload.referenceImages?.length ?? 0,
        hasSourceImage: Boolean(ctx.payload.sourceImage),
      })
      return yield* Effect.tryPromise({
        try: () =>
          createGeneration({
            capability: ctx.payload.capability,
            prompt: ctx.payload.prompt,
            styleModel: ctx.payload.styleModel,
            aspectRatio: ctx.payload.aspectRatio,
            count: ctx.payload.count,
            referenceImages: ctx.payload.referenceImages ? [...ctx.payload.referenceImages] : undefined,
            sourceImage: ctx.payload.sourceImage,
            extra: ctx.payload.extra ? { ...ctx.payload.extra } : undefined,
          }),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    return handlers.handle("createGeneration", create)
  }),
)
