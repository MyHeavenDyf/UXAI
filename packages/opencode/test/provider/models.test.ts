import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ModelsDev } from "../../src/provider/models"
import { it } from "../lib/effect"

type MockState = {
  calls: string[]
}

const buildLayer = (state: Ref.Ref<MockState>) =>
  Layer.fresh(ModelsDev.layer).pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            yield* Ref.update(state, (current) => ({ calls: [...current.calls, request.url] }))
            return HttpClientResponse.fromWeb(request, new Response("{}"))
          }),
        ),
      ),
    ),
    Layer.provide(AppFileSystem.defaultLayer),
  )

const provided = <A, E>(state: Ref.Ref<MockState>, effect: Effect.Effect<A, E, ModelsDev.Service>) =>
  effect.pipe(Effect.provide(buildLayer(state)))

const expectBundledProviders = (providers: Record<string, ModelsDev.Provider>) => {
  expect(providers.w3).toBeDefined()
  expect(providers.opencode).toBeUndefined()
  expect(providers.bpit).toBeUndefined()
}

describe("ModelsDev Service", () => {
  it.live("returns the bundled snapshot without removed providers", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<MockState>({ calls: [] })
      const providers = yield* provided(
        state,
        ModelsDev.Service.use((service) => service.get()),
      )

      expectBundledProviders(providers)
      expect((yield* Ref.get(state)).calls).toEqual([])
    }),
  )

  it.live("caches the bundled snapshot", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<MockState>({ calls: [] })
      const result = yield* provided(
        state,
        Effect.gen(function* () {
          const service = yield* ModelsDev.Service
          return [yield* service.get(), yield* service.get()]
        }),
      )

      expectBundledProviders(result[0])
      expect(result[1]).toBe(result[0])
      expect((yield* Ref.get(state)).calls).toEqual([])
    }),
  )

  it.live("does not fetch when refresh is requested", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<MockState>({ calls: [] })
      const providers = yield* provided(
        state,
        Effect.gen(function* () {
          const service = yield* ModelsDev.Service
          yield* service.refresh(true)
          return yield* service.get()
        }),
      )

      expectBundledProviders(providers)
      expect((yield* Ref.get(state)).calls).toEqual([])
    }),
  )
})
