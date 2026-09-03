import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ModelsDev } from "../../src/provider/models"
import { it } from "../lib/effect"

const fixture = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128_000, output: 8_192 },
      },
    },
  },
}

const provided = <A, E>(
  state: Ref.Ref<{ body: unknown; status: number; calls: string[] }>,
  effect: Effect.Effect<A, E, ModelsDev.Service>,
) =>
  effect.pipe(
    Effect.provide(
      Layer.fresh(ModelsDev.layer).pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.gen(function* () {
                yield* Ref.update(state, (value) => ({ ...value, calls: [...value.calls, request.url] }))
                const value = yield* Ref.get(state)
                return HttpClientResponse.fromWeb(request, Response.json(value.body, { status: value.status }))
              }),
            ),
          ),
        ),
      ),
    ),
  )

describe("ModelsDev Service", () => {
  it.live("loads every catalog directly from the remote endpoint", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<{ body: unknown; status: number; calls: string[] }>({
        body: fixture,
        status: 200,
        calls: [],
      })
      const result = yield* provided(
        state,
        Effect.gen(function* () {
          const service = yield* ModelsDev.Service
          return yield* Effect.all([service.get(), service.get()], { concurrency: "unbounded" })
        }),
      )
      expect(result).toEqual([fixture, fixture])
      expect((yield* Ref.get(state)).calls).toHaveLength(2)
    }),
  )

  it.live("fails when the remote endpoint is unavailable", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<{ body: unknown; status: number; calls: string[] }>({
        body: { error: true },
        status: 503,
        calls: [],
      })
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            provided(
              state,
              ModelsDev.Service.use((service) => service.get()),
            ),
          ),
        ),
      ).toBe(true)
    }),
  )

  it.live("fails when the remote response does not match the model schema", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make<{ body: unknown; status: number; calls: string[] }>({
        body: { acme: { id: "acme" } },
        status: 200,
        calls: [],
      })
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            provided(
              state,
              ModelsDev.Service.use((service) => service.get()),
            ),
          ),
        ),
      ).toBe(true)
    }),
  )
})
