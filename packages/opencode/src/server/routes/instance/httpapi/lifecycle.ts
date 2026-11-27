import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Exit } from "effect"
import { HttpEffect, HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { startStudioRequestTiming } from "@/server/studio-request-timing"

type MarkedInstance = {
  ctx: InstanceContext
  store: InstanceStore.Interface
  bridge: EffectBridge.Shape
}

// Disposal is requested by an endpoint handler, but must run from the outer
// server middleware after the response has been produced. The original Request
// object is the stable handoff key between those two phases.
const disposeAfterResponse = new WeakMap<object, MarkedInstance>()

const mark = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    return { ctx, store: yield* InstanceStore.Service, bridge: yield* EffectBridge.make() }
  })

export const markInstanceForDisposal = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    const marked = yield* mark(ctx)
    return yield* HttpEffect.appendPreResponseHandler((request, response) =>
      Effect.sync(() => {
        // The response is sent before disposeMiddleware performs the teardown.
        disposeAfterResponse.set(request.source, marked)
        return response
      }),
    )
  })

export const markInstanceForReload = (ctx: InstanceContext, next: InstanceStore.LoadInput) =>
  Effect.gen(function* () {
    const marked = yield* mark(ctx)
    return yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.as(Effect.uninterruptible(marked.bridge.run(marked.store.reload(next))), response),
    )
  })

export const disposeMiddleware: HttpMiddleware.HttpMiddleware = (effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const timing = startStudioRequestTiming(request.source, request.method, request.url)
    if (timing) {
      // Outer server middleware resumes after the native response is sent.
      // Attach headers in the pre-response hook, before that send happens.
      yield* HttpEffect.appendPreResponseHandler((_request, response) => Effect.sync(() => {
        timing.mark("response_ready")
        const timed = HttpServerResponse.setHeaders(response, timing.headers())
        timing.finish(response.status)
        return timed
      }))
    }
    const response = yield* effect.pipe(
      Effect.onExit((exit) => Effect.sync(() => timing?.finish(Exit.isSuccess(exit) ? exit.value.status : 500))),
    )
    const marked = disposeAfterResponse.get(request.source)
    if (!marked) return response
    disposeAfterResponse.delete(request.source)
    yield* Effect.uninterruptible(marked.bridge.run(marked.store.dispose(marked.ctx)))
    return response
  })
