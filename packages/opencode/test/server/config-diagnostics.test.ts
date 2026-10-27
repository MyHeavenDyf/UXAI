import { describe, expect, spyOn, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { ConfigError } from "@/config/error"
import { configCause, configFailure, configTraceFailure, createConfigTrace, diagnoseConfigValue } from "@/server/routes/instance/config-diagnostics"
import { configDiagnosticsLayer } from "@/server/routes/instance/httpapi/middleware/config-diagnostics"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

describe("config diagnostics", () => {
  test("extracts raw and deeply wrapped issues and explicitly reports cycles and limits", () => {
    const decoded = Schema.decodeUnknownExit(Schema.Struct({ username: Schema.Number }))({ username: "secret-value" })
    if (!Exit.isFailure(decoded)) throw new Error("Expected failure")
    const error = Cause.squash(decoded.cause)
    if (!Schema.isSchemaError(error)) throw new Error("Expected schema error")
    const deep = Array.from({ length: 40 }).reduce<unknown>((cause) => ({ name: "Wrapper", cause }), error.issue)
    expect(configFailure(deep).issues).toContainEqual({ path: ["username"], type: "InvalidType", expected: "Number", actualType: "string" })
    const limited = Array.from({ length: 150 }).reduce<unknown>((cause) => ({ cause }), error.issue)
    expect(configFailure(limited).diagnostics).toMatchObject({ truncated: true })
    expect(configFailure(limited).diagnostics.limits).toContain("depth")
    const cycle: { name: string; cause?: unknown } = { name: "CyclicWrapper" }
    cycle.cause = cycle
    expect(configFailure(cycle).diagnostics.cyclic).toBe(true)
    expect(configFailure({ name: "UnknownWrapper", cause: { unsupportedFormat: "private-secret" } }).diagnostics)
      .toMatchObject({ extraction: "no-structured-issues", inspectionFailed: false })
    expect(JSON.stringify(configFailure(deep))).not.toContain("secret-value")
  })

  test("shows issue count truncation instead of silently dropping validation fields", () => {
    const result = configFailure({ issues: Array.from({ length: 75 }, (_, index) => ({
      path: ["provider", String(index)], code: "invalid_type", expected: "number", message: "credential-secret",
    })) })
    expect(result.issues).toHaveLength(50)
    expect(result.diagnostics).toMatchObject({ truncated: true })
    expect(result.diagnostics.limits).toContain("issues")
    expect(JSON.stringify(result)).not.toContain("credential-secret")
  })

  test("independently finds canonical config fields when the HTTP error contains no readable issue", () => {
    const logging = spyOn(console, "error")
    try {
      const trace = createConfigTrace({ backend: "httpapi", directory: "D:/project" })
      trace.read.stage = "success"
      trace.read.value = { username: 123, provider: { custom: { options: { token: "private-token" } } } }
      trace.read.captured = true
      configTraceFailure(trace, [{ name: "HttpApiSchemaError", kind: "Body" }])
      const summary = JSON.parse(String(logging.mock.calls[0]?.[1]))
      expect(summary).toMatchObject({ diagnosticVersion: 2, requestID: trace.requestID, phase: "response", readStage: "success" })
      expect(summary.configProbe.schema.status).toBe("failed")
      expect(summary.configProbe.schema.errors[0].issues).toContainEqual(expect.objectContaining({
        path: ["username"], expected: "Union", expectedKinds: expect.arrayContaining(["String"]), actualType: "number",
      }))
      expect(summary.configProbe.json.status).toBe("compatible")
      expect(JSON.stringify(summary)).not.toContain("private-token")
    } finally {
      logging.mockRestore()
    }
  })

  test("distinguishes JSON bigint and circular references without exposing values", () => {
    const bigint = diagnoseConfigValue({ provider: { custom: { options: { identifier: 987654321n } } } })
    expect(bigint).toMatchObject({ schema: { status: "success" }, json: { status: "failed" } })
    expect(bigint.json?.failures).toContainEqual({ path: ["provider", "custom", "options", "identifier"], reason: "bigint" })
    const cycle: { token: string; self?: unknown } = { token: "cycle-secret" }
    cycle.self = cycle
    const circular = diagnoseConfigValue({ provider: { custom: { options: { nested: cycle } } } })
    expect(circular).toMatchObject({ schema: { status: "success" }, json: { status: "failed" } })
    expect(circular.json?.failures).toContainEqual({ path: ["provider", "custom", "options", "nested", "self"], reason: "circular-reference" })
    expect(JSON.stringify(circular)).not.toContain("cycle-secret")
    expect(JSON.stringify(bigint)).not.toContain("987654321")
  })

  test("does not invoke custom toJSON when checking serialization compatibility", () => {
    const state = { calls: 0 }
    const result = diagnoseConfigValue({ provider: { custom: { options: { nested: {
      toJSON() { state.calls++; throw new Error("toJSON-secret") },
    } } } } })
    expect(state.calls).toBe(0)
    expect(result.json).toMatchObject({ status: "indeterminate" })
    expect(result.json?.failures).toContainEqual({ path: ["provider", "custom", "options", "nested"], reason: "custom-toJSON-not-invoked" })
    expect(JSON.stringify(result)).not.toContain("toJSON-secret")
  })

  test("diagnostic inspection tolerates hostile error getters and proxy traps", () => {
    const error = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("proxy-secret") } })
    expect(() => configFailure(error)).not.toThrow()
    expect(JSON.stringify(configFailure(error))).not.toContain("proxy-secret")
  })

  test("does not invoke configuration getters through either JSON scanning or schema validation", () => {
    const state = { calls: 0 }
    const result = diagnoseConfigValue({ provider: { custom: { options: {
      get token() { state.calls++; throw new Error("getter-secret") },
    } } } })
    expect(state.calls).toBe(0)
    expect(result.schema).toMatchObject({ status: "not-run", reason: "unsafe-or-truncated-value" })
    expect(result.json).toMatchObject({ status: "indeterminate" })
    expect(result.json?.failures).toContainEqual({ path: ["provider", "custom", "options", "token"], reason: "accessor-not-invoked" })
    expect(JSON.stringify(result)).not.toContain("getter-secret")
  })

  test("reports invalid field paths and expected types without serializing values", () => {
    const decoded = Schema.decodeUnknownExit(Schema.Struct({ provider: Schema.Struct({ token: Schema.Number }) }))({
      provider: { token: "private-token-value" },
    })
    if (!Exit.isFailure(decoded)) throw new Error("Expected schema failure")
    const error = Cause.squash(decoded.cause)
    if (!Schema.isSchemaError(error)) throw new Error("Expected schema error")
    const summary = configFailure(new HttpApiError.HttpApiSchemaError({ kind: "Body", cause: error }))
    expect(summary).toMatchObject({ name: "HttpApiSchemaError", kind: "Body" })
    expect(summary.issues).toContainEqual({ path: ["provider", "token"], type: "InvalidType", expected: "Number", actualType: "string" })
    expect(JSON.stringify(summary)).not.toContain("private-token-value")
  })

  test("omits raw JSON and custom validation messages from config parse failures", () => {
    const error = new ConfigError.JsonError({ path: "D:/user/octo.json", message: '{"token":"json-secret"}' })
    expect(configFailure(error)).toMatchObject({ name: "ConfigJsonError", source: "D:/user/octo.json" })
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
        errors: [expect.objectContaining({ kind: "Body", issues: [{ path: ["retries"], type: "InvalidType", expected: "Number", actualType: "string" }] })],
      }))
      expect(new Set(logs.map((entry) => entry.requestID)).size).toBe(1)
      expect(JSON.stringify(logs)).not.toContain("invalid-config-secret")
      expect(JSON.stringify(logs)).not.toContain("query-secret")
    }),
  )
})
