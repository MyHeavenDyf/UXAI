import { createGeneration, getGeneration } from "@/studio/studio-service"
import * as InstanceState from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { fetchPromptTags } from "@/tool/internel_image_generate"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiStudioGenerationError, StudioGenerationPayload } from "../groups/studio"

export const studioHandlers = HttpApiBuilder.group(InstanceHttpApi, "studio", (handlers) =>
  Effect.gen(function* () {
    const create = Effect.fn("StudioHttpApi.createGeneration")(function* (ctx: {
      payload: typeof StudioGenerationPayload.Type
    }) {
      const instance = yield* InstanceState.context
      console.log("[studio.httpapi] POST /studio/generations", {
        sessionID: ctx.payload.sessionID,
        capability: ctx.payload.capability,
        prompt: ctx.payload.prompt,
        styleModel: ctx.payload.styleModel,
        aspectRatio: ctx.payload.aspectRatio,
        count: ctx.payload.count,
        imageTool: ctx.payload.imageTool,
        referenceImageCount: ctx.payload.referenceImages?.length ?? 0,
        hasSourceImage: Boolean(ctx.payload.sourceImage),
      })
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            createGeneration({
              sessionID: ctx.payload.sessionID,
              capability: ctx.payload.capability,
              prompt: ctx.payload.prompt,
              styleModel: ctx.payload.styleModel,
              aspectRatio: ctx.payload.aspectRatio,
              count: ctx.payload.count,
              imageTool: ctx.payload.imageTool,
              referenceImages: ctx.payload.referenceImages ? [...ctx.payload.referenceImages] : undefined,
              sourceImage: ctx.payload.sourceImage,
              extra: ctx.payload.extra ? { ...ctx.payload.extra } : undefined,
            }),
          ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const get = Effect.fn("StudioHttpApi.getGeneration")(function* (ctx: {
      params: { generationID: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => getGeneration(ctx.params.generationID)),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    return handlers
      .handle("createGeneration", create)
      .handle("getGeneration", get)
      .handle("listPromptTags", () =>
        Effect.tryPromise({
          try: () => fetchPromptTags(),
          catch: (error) =>
            new ApiStudioGenerationError({
              name: "StudioGenerationError",
              data: { message: error instanceof Error ? error.message : String(error) },
            }),
        })
      )
  }),
)
