import { cancelGeneration, createEditorEntry, createGeneration, createPromptGen, getGeneration, rebootGeneration } from "@/studio/studio-service"
import * as InstanceState from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { checkStudioPermission, fetchPromptTags } from "@/tool/internel_image_generate"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiStudioGenerationError, StudioEditorEntryPayload, StudioGenerationPayload, StudioPermissionPayload, StudioPromptGenPayload } from "../groups/studio"
import { configureModelsApiHeaders } from "@/plugin/model-headers"

export const studioHandlers = HttpApiBuilder.group(InstanceHttpApi, "studio", (handlers) =>
  Effect.gen(function* () {
    const create = Effect.fn("StudioHttpApi.createGeneration")(function* (ctx: {
      payload: typeof StudioGenerationPayload.Type
    }) {
      configureModelsApiHeaders((yield* HttpServerRequest.HttpServerRequest).headers)
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
              displayPrompt: ctx.payload.displayPrompt,
              detailPrompt: ctx.payload.detailPrompt,
              detailTitle: ctx.payload.detailTitle,
              initialSessionTitle: ctx.payload.initialSessionTitle,
              shouldSetSessionTitle: ctx.payload.shouldSetSessionTitle,
              refinedPrompt: ctx.payload.refinedPrompt,
              effectivePrompt: ctx.payload.effectivePrompt,
              promptRefineModels: ctx.payload.promptRefineModels ? [...ctx.payload.promptRefineModels] : undefined,
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

    const cancel = Effect.fn("StudioHttpApi.cancelGeneration")(function* (ctx: {
      params: { generationID: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => cancelGeneration(ctx.params.generationID)),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const reboot = Effect.fn("StudioHttpApi.rebootGeneration")(function* (ctx: {
      params: { generationID: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => rebootGeneration(ctx.params.generationID)),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const createEntry = Effect.fn("StudioHttpApi.createEditorEntry")(function* (ctx: {
      payload: typeof StudioEditorEntryPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => createEditorEntry(ctx.payload)),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const promptGen = Effect.fn("StudioHttpApi.createPromptGen")(function* (ctx: {
      payload: typeof StudioPromptGenPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => createPromptGen(ctx.payload)),
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
      .handle("createEditorEntry", createEntry)
      .handle("createPromptGen", promptGen)
      .handle("getGeneration", get)
      .handle("cancelGeneration", cancel)
      .handle("rebootGeneration", reboot)
      .handle("checkPermission", (ctx: { payload: typeof StudioPermissionPayload.Type }) =>
        Effect.tryPromise({
          try: () => checkStudioPermission(ctx.payload.uid),
          catch: (error) =>
            new ApiStudioGenerationError({
              name: "StudioGenerationError",
              data: { message: error instanceof Error ? error.message : String(error) },
            }),
        })
      )
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
