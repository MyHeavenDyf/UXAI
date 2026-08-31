import {
  cancelGeneration,
  createEditorEntry,
  createGeneration,
  createPromptGen,
  createStyleDescriptionGenStream,
  getGeneration,
  publishTemplate,
  rebootGeneration,
  type StudioStyleDescriptionGenStreamEvent,
} from "@/studio/studio-service"
import * as InstanceState from "@/effect/instance-state"
import { Instance, type InstanceContext } from "@/project/instance"
import { checkStudioPermission, fetchPromptTags } from "@/tool/internel_image_generate"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { InstanceHttpApi } from "../api"
import { ApiStudioGenerationError, StudioEditorEntryPayload, StudioGenerationPayload, StudioPermissionPayload, StudioPromptGenPayload, StudioStyleDescriptionGenPayload, StudioTemplatePublishPayload } from "../groups/studio"
import { configureModelsApiHeaders } from "@/plugin/model-headers"

function styleDescriptionEventData(data: StudioStyleDescriptionGenStreamEvent): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function styleDescriptionStreamError(error: unknown): StudioStyleDescriptionGenStreamEvent {
  return {
    type: "error",
    content: error instanceof Error ? error.message : String(error),
  }
}

function styleDescriptionResponse(
  payload: typeof StudioStyleDescriptionGenPayload.Type,
  instance: InstanceContext,
) {
  return HttpServerResponse.stream(
    Stream.callback<StudioStyleDescriptionGenStreamEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const controller = new AbortController()
          void Instance.restore(instance, () =>
            createStyleDescriptionGenStream({
              style_keywords: payload.style_keywords,
              style_images: payload.style_images.map((image) => ({ url: image.url })),
              style_dimensions: [...payload.style_dimensions],
            }, {
              signal: controller.signal,
              onEvent: (event) => {
                Queue.offerUnsafe(queue, event)
              },
            }),
          )
            .catch((error) => {
              if (!controller.signal.aborted) Queue.offerUnsafe(queue, styleDescriptionStreamError(error))
            })
            .finally(() => {
              Effect.runSync(Queue.shutdown(queue))
            })
          return controller
        }),
        (controller) => Effect.sync(() => controller.abort()),
      ),
    ).pipe(
      Stream.map(styleDescriptionEventData),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

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

    const styleDescriptionGen = Effect.fn("StudioHttpApi.createStyleDescriptionGen")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const instance = yield* InstanceState.context
      const body = yield* Effect.orDie(ctx.request.text)
      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new HttpApiError.BadRequest({}),
      })
      const payload = yield* Schema.decodeUnknownEffect(StudioStyleDescriptionGenPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return styleDescriptionResponse(payload, instance)
    })

    const publish = Effect.fn("StudioHttpApi.publishTemplate")(function* (ctx: {
      payload: typeof StudioTemplatePublishPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => publishTemplate(ctx.payload)),
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
      .handleRaw("createStyleDescriptionGen", styleDescriptionGen)
      .handle("publishTemplate", publish)
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
