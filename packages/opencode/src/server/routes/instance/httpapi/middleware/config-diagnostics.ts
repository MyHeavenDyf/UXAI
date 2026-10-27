import { Effect } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { configCause, configTraceFailure, configTraceLog, ConfigTraceContext, createConfigTrace } from "../../config-diagnostics"

// Run outside instance/auth routing so an early rejection is visible too.
export const configDiagnosticsLayer = HttpRouter.middleware()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (request.method !== "GET" || !["/config", "/api/config"].includes(url.pathname)) return yield* effect
    const trace = createConfigTrace({
      backend: "httpapi",
      directory: url.searchParams.get("directory") ?? request.headers["x-opencode-directory"],
    })
    configTraceLog(trace, "request", {
      path: url.pathname, platform: process.platform, arch: process.arch,
      runtime: { node: process.versions.node, electron: process.versions.electron, bun: process.versions.bun },
    })
    return yield* effect.pipe(
      Effect.tap((response) => Effect.sync(() => {
        configTraceLog(trace, "response", { status: response.status })
        if (response.status >= 400) configTraceFailure(trace,
          trace.errors.length ? trace.errors : [{ name: "HTTPResponse", status: response.status }])
      })),
      Effect.tapCause((cause) => Effect.sync(() => configTraceFailure(trace, configCause(cause)))),
      Effect.provideService(ConfigTraceContext, trace),
    )
  }),
  { global: true },
)
