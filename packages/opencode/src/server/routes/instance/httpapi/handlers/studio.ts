import {
  cancelGeneration,
  createEditorEntry,
  createGeneration,
  createPromptGen,
  createStyleDescriptionGenStream,
  deleteTemplate,
  getGeneration,
  getTemplateDetail,
  listTemplates,
  publishTemplate,
  rebootGeneration,
  refreshGeneration,
  searchTemplateUsers,
  updateTemplate,
  type StudioStyleDescriptionGenStreamEvent,
} from "@/studio/studio-service"
import {
  deleteStudioHistoryMedia,
  listStudioHistoryExcludedIds,
  listStudioHistoryMedia,
  snapshotSessionMedia,
  splitHistoryFilter,
  studioHistoryRevision,
} from "@/studio/studio-history-service"
import * as InstanceState from "@/effect/instance-state"
import { Instance, type InstanceContext } from "@/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { fetchPromptTags } from "@/tool/internel_image_generate"
import { Effect, Layer, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { InstanceHttpApi } from "../api"
import {
  ApiStudioGenerationError,
  StudioEditorEntryPayload,
  StudioGenerationPayload,
  StudioHistoryDeletePayload,
  StudioHistoryListQuery,
  StudioHistorySnapshotPayload,
  StudioPromptGenPayload,
  StudioStyleDescriptionGenPayload,
  StudioTemplateDetailQuery,
  StudioTemplateListQuery,
  StudioTemplatePublishPayload,
  StudioTemplateUpdatePayload,
  StudioTemplateUserSearchPayload,
} from "../groups/studio"
import { configureModelsApiHeaders } from "@/plugin/model-headers"
import { RecommendationError } from "@/studio/prompt-recommendation-schema"
import { recommendationRequest } from "@/studio/prompt-recommendation-http"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { LLM } from "@/session/llm"
import {
  ensureStudioSessionThumbnails,
  invalidateStudioMediaThumbnail,
  isStudioThumbnailTerminalError,
  loadStudioThumbnailSource,
  saveStudioMediaThumbnail,
  saveStudioVideoPoster,
} from "@/studio/studio-media-thumbnail"

function recommendationFailure(error: unknown) {
  if (error instanceof RecommendationError) return HttpServerResponse.jsonUnsafe(error.body(), { status: error.status })
  throw error
}

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

function styleDescriptionResponse(payload: typeof StudioStyleDescriptionGenPayload.Type, instance: InstanceContext) {
  return HttpServerResponse.stream(
    Stream.callback<StudioStyleDescriptionGenStreamEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const controller = new AbortController()
          void Instance.restore(instance, () =>
            createStyleDescriptionGenStream(
              {
                style_keywords: payload.style_keywords,
                style_images: payload.style_images.map((image) => ({ url: image.url })),
                style_dimensions: [...payload.style_dimensions],
              },
              {
                signal: controller.signal,
                onEvent: (event) => {
                  Queue.offerUnsafe(queue, event)
                },
              },
            ),
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
    ).pipe(Stream.map(styleDescriptionEventData), Stream.pipeThroughChannel(Sse.encode()), Stream.encodeText),
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
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const llm = yield* LLM.Service
    const recommendation = (
      action: "initialize" | "submit" | "state" | "cancel",
      params?: { sessionID: string; assistantMessageID?: string },
    ) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID
        const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest).pipe(Effect.orDie)
        const response = yield* Effect.promise(
          async () =>
            await Instance.restore(instance, () =>
              WorkspaceContext.provide({
                workspaceID: workspace,
                fn: () =>
                  recommendationRequest(request, action, params?.sessionID, params?.assistantMessageID, {
                    provider,
                    config,
                    llm,
                  }),
              }),
            ),
        )
        return HttpServerResponse.fromWeb(response)
      })
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
          ).catch(recommendationFailure),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const get = Effect.fn("StudioHttpApi.getGeneration")(function* (ctx: { params: { generationID: string } }) {
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

    const cancel = Effect.fn("StudioHttpApi.cancelGeneration")(function* (ctx: { params: { generationID: string } }) {
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

    const reboot = Effect.fn("StudioHttpApi.rebootGeneration")(function* (ctx: { params: { generationID: string } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () => rebootGeneration(ctx.params.generationID)).catch(recommendationFailure),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const refresh = Effect.fn("StudioHttpApi.refreshGeneration")(function* (ctx: { params: { generationID: string } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () => refreshGeneration(ctx.params.generationID)).catch(recommendationFailure),
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
        try: () => Instance.restore(instance, () => createEditorEntry(ctx.payload)).catch(recommendationFailure),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const ensureThumbnails = Effect.fn("StudioHttpApi.ensureSessionThumbnails")(function* (ctx: {
      params: { sessionID: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () => Promise.resolve(ensureStudioSessionThumbnails(ctx.params.sessionID))),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const saveVideoPoster = Effect.fn("StudioHttpApi.saveGenerationVideoPoster")(function* (ctx: {
      params: { generationID: string }
      payload: { mediaIndex: number; content: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            saveStudioVideoPoster({
              generationID: ctx.params.generationID,
              mediaIndex: ctx.payload.mediaIndex,
              content: ctx.payload.content,
            }),
          ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    const getThumbnailSource = Effect.fn("StudioHttpApi.getGenerationThumbnailSource")(function* (ctx: {
      params: { generationID: string; mediaIndex: string }
    }) {
      const instance = yield* InstanceState.context
      const source = yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            loadStudioThumbnailSource({
              generationID: ctx.params.generationID,
              mediaIndex: Number(ctx.params.mediaIndex),
            }),
          ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
              // 远端拉取的瞬时失败（超时/网络）应告知客户端可重试，避免其按终态放弃。
              retryable: !isStudioThumbnailTerminalError(error),
            },
          }),
      })
      return HttpServerResponse.raw(source.bytes, {
        contentType: source.contentType,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    })

    const saveThumbnail = Effect.fn("StudioHttpApi.saveGenerationThumbnail")(function* (ctx: {
      params: { generationID: string; mediaIndex: string }
      payload: { content: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            saveStudioMediaThumbnail({
              generationID: ctx.params.generationID,
              mediaIndex: Number(ctx.params.mediaIndex),
              content: ctx.payload.content,
            }),
          ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
              retryable: !isStudioThumbnailTerminalError(error),
            },
          }),
      })
    })

    const invalidateThumbnail = Effect.fn("StudioHttpApi.invalidateGenerationThumbnail")(function* (ctx: {
      params: { generationID: string; mediaIndex: string }
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            invalidateStudioMediaThumbnail({
              generationID: ctx.params.generationID,
              mediaIndex: Number(ctx.params.mediaIndex),
            }),
          ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
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

    const update = Effect.fn("StudioHttpApi.updateTemplate")(function* (ctx: {
      params: { templateID: string }
      query: typeof StudioTemplateDetailQuery.Type
      payload: typeof StudioTemplateUpdatePayload.Type
    }) {
      if (Number(ctx.params.templateID) !== ctx.payload.idx) return yield* new HttpApiError.BadRequest({})
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            updateTemplate({
              user_id: ctx.query.user_id,
              template: ctx.payload,
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

    const removeTemplate = Effect.fn("StudioHttpApi.deleteTemplate")(function* (ctx: {
      params: { templateID: string }
      query: typeof StudioTemplateDetailQuery.Type
    }) {
      const templateID = Number(ctx.params.templateID)
      if (!Number.isFinite(templateID)) return yield* new HttpApiError.BadRequest({})
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            deleteTemplate({
              template_id: templateID,
              user_id: ctx.query.user_id,
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

    const list = Effect.fn("StudioHttpApi.listTemplates")(function* (ctx: {
      query: typeof StudioTemplateListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            listTemplates({
              user_id: ctx.query.user_id,
              only_public: ctx.query.only_public === 1 ? 1 : 0,
              page: ctx.query.page,
              page_size: 20,
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

    const detail = Effect.fn("StudioHttpApi.getTemplateDetail")(function* (ctx: {
      params: { templateID: string }
      query: typeof StudioTemplateDetailQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () =>
          Instance.restore(instance, () =>
            getTemplateDetail({
              template_id: ctx.params.templateID,
              user_id: ctx.query.user_id,
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

    const searchUsers = Effect.fn("StudioHttpApi.searchTemplateUsers")(function* (ctx: {
      payload: typeof StudioTemplateUserSearchPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => searchTemplateUsers(ctx.payload)),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      })
    })

    const listHistory = Effect.fn("StudioHttpApi.listHistory")(function* (ctx: {
      query: typeof StudioHistoryListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => Promise.resolve(
          listStudioHistoryMedia(instance.directory, {
            kind: ctx.query.kind,
            resolutions: splitHistoryFilter(ctx.query.resolution),
            ratios: splitHistoryFilter(ctx.query.ratio),
            sort: ctx.query.sort,
            cursor: ctx.query.cursor,
            limit: ctx.query.limit,
          }),
        )),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    const snapshotSession = Effect.fn("StudioHttpApi.snapshotSession")(function* (ctx: {
      payload: typeof StudioHistorySnapshotPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => Promise.resolve({
          snapshotted: snapshotSessionMedia(instance.directory, ctx.payload.sessionID),
        })),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    const deleteHistoryMedia = Effect.fn("StudioHttpApi.deleteHistoryMedia")(function* (ctx: {
      payload: typeof StudioHistoryDeletePayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () =>
          deleteStudioHistoryMedia(instance.directory, [...ctx.payload.mediaIds]).then((deleted) => ({ deleted })),
        ),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    const listExcludedIds = Effect.fn("StudioHttpApi.listExcludedHistoryIds")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => Promise.resolve({
          ids: listStudioHistoryExcludedIds(instance.directory),
        })),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    const getHistoryRevision = Effect.fn("StudioHttpApi.getHistoryRevision")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.tryPromise({
        try: () => Instance.restore(instance, () => Promise.resolve(
          studioHistoryRevision(instance.directory),
        )),
        catch: (error) =>
          new ApiStudioGenerationError({
            name: "StudioGenerationError",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
      })
    })

    return handlers
      .handleRaw("initializeRecommendation", () => recommendation("initialize"))
      .handleRaw("submitExpansion", () => recommendation("submit"))
      .handleRaw("getRecommendationState", (ctx) => recommendation("state", ctx.params))
      .handleRaw("cancelExpansion", (ctx) => recommendation("cancel", ctx.params))
      .handle("createGeneration", create)
      .handle("createEditorEntry", createEntry)
      .handle("ensureSessionThumbnails", ensureThumbnails)
      .handle("saveGenerationVideoPoster", saveVideoPoster)
      .handleRaw("getGenerationThumbnailSource", getThumbnailSource)
      .handle("saveGenerationThumbnail", saveThumbnail)
      .handle("invalidateGenerationThumbnail", invalidateThumbnail)
      .handle("createPromptGen", promptGen)
      .handleRaw("createStyleDescriptionGen", styleDescriptionGen)
      .handle("publishTemplate", publish)
      .handle("updateTemplate", update)
      .handle("deleteTemplate", removeTemplate)
      .handle("listTemplates", list)
      .handle("getTemplateDetail", detail)
      .handle("searchTemplateUsers", searchUsers)
      .handle("getGeneration", get)
      .handle("cancelGeneration", cancel)
      .handle("rebootGeneration", reboot)
      .handle("refreshGeneration", refresh)
      .handle("listHistory", listHistory)
      .handle("snapshotSession", snapshotSession)
      .handle("deleteHistoryMedia", deleteHistoryMedia)
      .handle("listExcludedHistoryIds", listExcludedIds)
      .handle("getHistoryRevision", getHistoryRevision)
      .handle("listPromptTags", () =>
        Effect.tryPromise({
          try: () => fetchPromptTags(),
          catch: (error) =>
            new ApiStudioGenerationError({
              name: "StudioGenerationError",
              data: { message: error instanceof Error ? error.message : String(error) },
            }),
        }),
      )
  }),
).pipe(Layer.provide(LLM.layer))
