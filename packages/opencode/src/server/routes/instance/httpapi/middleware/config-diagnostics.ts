import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { configCause } from "../../config-diagnostics"

// Run outside instance/auth routing so an early rejection is visible too.
export const configDiagnosticsLayer = HttpRouter.middleware()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (request.method !== "GET" || !["/config", "/api/config"].includes(url.pathname)) return yield* effect
    const metadata = {
      requestID: randomUUID(),
      backend: "httpapi",
      path: url.pathname,
      directory: url.searchParams.get("directory") ?? request.headers["x-opencode-directory"],
    }
    const started = Date.now()
    console.info("[octo:config]", JSON.stringify({ ...metadata, stage: "request" }))
    return yield* effect.pipe(
      Effect.tap((response) => Effect.sync(() => console.info("[octo:config]", JSON.stringify({
        ...metadata, stage: "response", status: response.status, elapsedMs: Date.now() - started,
      })))),
      Effect.tapCause((cause) => Effect.sync(() => console.error("[octo:config]", JSON.stringify({
        ...metadata, stage: "request:failed", elapsedMs: Date.now() - started, errors: configCause(cause),
      })))),
    )
  }),
  { global: true },
)
