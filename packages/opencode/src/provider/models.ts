import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Installation } from "../installation"
import { Flag } from "@opencode-ai/core/flag/flag"
import { withTransientReadRetry } from "@/util/effect-http-client"

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  isExternal: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated", "active"])),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  options: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
  variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.MutableJson))),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const source = Flag.OPENCODE_MODELS_URL || "https://models.dev"

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      const url = new URL(source)
      if (url.pathname === "/") url.pathname = "/api.json"
      if (url.pathname.endsWith("/")) url.pathname = `${url.pathname}api.json`
      return yield* HttpClientRequest.get(url.toString()).pipe(
        HttpClientRequest.setHeader("User-Agent", Installation.USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Provider))),
        Effect.timeout("10 seconds"),
      )
    })
    return Service.of({
      get: () => fetchApi().pipe(Effect.orDie),
      refresh: Effect.fn("ModelsDev.refresh")(function* () {
        yield* fetchApi().pipe(Effect.orDie)
      }),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as ModelsDev from "./models"
