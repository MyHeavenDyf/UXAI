import { NodeHttpServer } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { createServer } from "node:http"
import { Hono } from "hono"
import { StudioTimingMiddleware } from "../../src/server/middleware"
import { disposeMiddleware } from "../../src/server/routes/instance/httpapi/lifecycle"
import {
  observeStudioHttpServer,
  startStudioRequestTiming,
  studioRequestTiming,
} from "../../src/server/studio-request-timing"
import { layer as nativeHttpServerLayer } from "../../src/server/httpapi-server.node"
import { testEffect } from "../lib/effect"

const it = testEffect(NodeHttpServer.layerTest)

// Exercise the production listener hooks; layerTest's own listener has no hooks.
const native = testEffect(
  HttpServer.layerTestClient.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(nativeHttpServerLayer({ hostname: "127.0.0.1", port: 0 })),
  ),
)

native.live("a stall before request dispatch remains visible when that request itself is fast", () =>
  Effect.gen(function* () {
    yield* HttpRouter.add("GET", "/session/test/message", HttpServerResponse.jsonUnsafe([])).pipe(
      (routes) => HttpRouter.serve(routes, { middleware: disposeMiddleware }),
      Layer.build,
    )
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 170)
    const response = yield* HttpClient.get("/session/test/message")
    const timing = response.headers["server-timing"]
    expect(response.status).toBe(200)
    expect(response.headers["x-studio-timing-version"]).toBe("2")
    expect(Number.isNaN(Date.parse(response.headers["x-studio-received-at"]))).toBe(false)
    expect(timing).toContain("http_middleware;dur=")
    expect(Number(timing.match(/prior_event_loop_lag;dur=(\d+)/)?.[1])).toBeGreaterThanOrEqual(50)
    expect(yield* response.json).toEqual([])
  }),
)

it.live("native HTTP requests expose the same timing object to handlers and clean up after responding", () =>
  Effect.gen(function* () {
    const sources: object[] = []
    yield* HttpRouter.add(
      "GET",
      "/session/test/message",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        sources.push(request.source)
        const timing = studioRequestTiming(request.source)
        expect(timing).toBeDefined()
        timing?.mark("messages_read")
        return HttpServerResponse.jsonUnsafe([{ message: "unchanged" }])
      }),
    ).pipe((routes) => HttpRouter.serve(routes, { middleware: disposeMiddleware }), Layer.build)
    const responses = yield* Effect.all(
      [
        HttpClient.get("/session/test/message?directory=private"),
        HttpClient.get("/session/test/message?directory=private"),
      ],
      { concurrency: "unbounded" },
    )
    expect(responses[0].status).toBe(200)
    expect(sources).toHaveLength(2)
    expect(responses[0].headers["x-studio-timing-id"]).toBeTruthy()
    expect(responses[0].headers["x-studio-timing-id"]).not.toBe(responses[1].headers["x-studio-timing-id"])
    expect(responses[0].headers["server-timing"]).toContain("messages_read;dur=")
    expect(yield* responses[0].json).toEqual([{ message: "unchanged" }])
    expect(sources.every((source) => studioRequestTiming(source) === undefined)).toBe(true)
  }),
)

test("legacy HTTP responses retain their body and return diagnostic timing headers", async () => {
  const sources: object[] = []
  const app = new Hono().use(StudioTimingMiddleware).get("/session/test/message", (c) => {
    sources.push(c.req.raw)
    studioRequestTiming(c.req.raw)?.mark("messages_read")
    return c.json([{ message: "unchanged" }])
  })
  const response = await app.request("/session/test/message")
  expect(response.headers.get("server-timing")).toContain("messages_read;dur=")
  expect(await response.json()).toEqual([{ message: "unchanged" }])
  expect(studioRequestTiming(sources[0])).toBeUndefined()
})

test("a synchronous stall is measured even when the timer has not had a chance to fire", () => {
  const source = {}
  const timing = startStudioRequestTiming(source, "POST", "/studio/prompt-recommendations")!
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 170)
    timing.mark("transaction_entered")
    expect(Number(timing.headers()["Server-Timing"].match(/event_loop_lag;dur=(\d+)/)?.[1])).toBeGreaterThanOrEqual(50)
    expect(timing.headers()["Server-Timing"]).toContain("transaction_entered;dur=")
  } finally {
    timing.finish(200)
  }
  expect(studioRequestTiming(source)).toBeUndefined()
  expect(startStudioRequestTiming({}, "GET", "/global/event")).toBeUndefined()
})

test("the process monitor detects a stall without any active request and can be stopped", () => {
  const server = createServer()
  const monitor = observeStudioHttpServer(server)
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 170)
    expect(monitor.recentLag()).toBeGreaterThanOrEqual(50)
    expect(server.listenerCount("request")).toBe(1)
  } finally {
    monitor.stop()
  }
  expect(server.listenerCount("request")).toBe(0)
})
