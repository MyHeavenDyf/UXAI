import { describe, expect, spyOn, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { ConfigError } from "@/config/error"
import { configCause, configFailure } from "@/server/routes/instance/config-diagnostics"
import { configDiagnosticsLayer } from "@/server/routes/instance/httpapi/middleware/config-diagnostics"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

describe("config diagnostics", () => {
  test("reports invalid field paths and expected types without serializing values", () => {
    const decoded = Schema.decodeUnknownExit(Schema.Struct({ provider: Schema.Struct({ token: Schema.Number }) }))({
      provider: { token: "private-token-value" },
    })
    if (!Exit.isFailure(decoded)) throw new Error("Expected schema failure")
    const error = Cause.squash(decoded.cause)
    if (!Schema.isSchemaError(error)) throw new Error("Expected schema error")
    const summary = configFailure(new HttpApiError.HttpApiSchemaError({ kind: "Body", cause: error }))
    expect(summary).toMatchObject({ name: "HttpApiSchemaError", kind: "Body" })
    expect(summary.issues).toContainEqual({ path: ["provider", "token"], type: "InvalidType", expected: "Number" })
    expect(JSON.stringify(summary)).not.toContain("private-token-value")
  })

  test("omits raw JSON and custom validation messages from config parse failures", () => {
    const error = new ConfigError.JsonError({ path: "D:/user/octo.json", message: '{"token":"json-secret"}' })
    expect(configFailure(error)).toEqual({ name: "ConfigJsonError", source: "D:/user/octo.json" })
    expect(configCause(Cause.die(error))).toEqual([configFailure(error)])
    const invalid = new ConfigError.InvalidError({
      path: "/user/opencode.json",
      issues: [{ code: "custom", path: ["mcp", "local", "enabled"], message: "invalid private-token-value" }],
    })
    expect(configFailure(invalid)).toMatchObject({
      name: "ConfigInvalidError",
      source: "/user/opencode.json",
      issues: [{ path: ["mcp", "local", "enabled"], type: "ConfigValidation" }],
    })
    expect(JSON.stringify(configFailure(invalid))).not.toContain("private-token-value")
  })

  it.live("logs response validation failures without changing empty 400 responses or leaking secrets", () =>
    Effect.gen(function* () {
      const info = spyOn(console, "info")
      const error = spyOn(console, "error")
      yield* Effect.addFinalizer(() => Effect.sync(() => { info.mockRestore(); error.mockRestore() }))
      const api = HttpApi.make("config-diagnostic-test").add(
        HttpApiGroup.make("config").add(HttpApiEndpoint.get("get", "/config", {
          success: Schema.Struct({ retries: Schema.Number }),
        })),
      )
      const handlers = HttpApiBuilder.group(api, "config", (handlers) => handlers.handle("get", () =>
        Effect.succeed({ retries: "invalid-config-secret" as unknown as number }),
      ))
      yield* HttpApiBuilder.layer(api).pipe(
        Layer.provide(handlers),
        Layer.provide(configDiagnosticsLayer),
        (routes) => HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }),
        Layer.build,
      )
      const response = yield* HttpClient.get("/config?directory=D%3A%5C%E4%B8%AD%E6%96%87%26CANN&auth_token=query-secret")
      expect(response.status).toBe(400)
      expect(yield* response.text).toBe("")
      const logs = [...info.mock.calls, ...error.mock.calls]
        .filter((call) => call[0] === "[octo:config]")
        .map((call) => JSON.parse(String(call[1])))
      expect(logs).toContainEqual(expect.objectContaining({ stage: "request", directory: "D:\\中文&CANN" }))
      expect(logs).toContainEqual(expect.objectContaining({
        stage: "request:failed",
        errors: [expect.objectContaining({ kind: "Body", issues: [{ path: ["retries"], type: "InvalidType", expected: "Number" }] })],
      }))
      expect(new Set(logs.map((entry) => entry.requestID)).size).toBe(1)
      expect(JSON.stringify(logs)).not.toContain("invalid-config-secret")
      expect(JSON.stringify(logs)).not.toContain("query-secret")
    }),
  )
})
