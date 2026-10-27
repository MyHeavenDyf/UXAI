import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

const log = Log.create({ service: "server" })

const statusForNamedError = (error: NamedError): number => {
  if (error instanceof NotFoundError) return 404
  if (error instanceof Provider.ModelNotFoundError) return 400
  if (error.name === "ProviderAuthValidationFailed") return 400
  if (error.name.startsWith("Worktree")) return 400
  return 500
}

const responseFor = (error: unknown): HttpServerResponse.HttpServerResponse | undefined => {
  if (error instanceof NamedError) {
    const status = statusForNamedError(error)
    log.info("error-middleware:named", { name: error.name, status, message: error.message })
    return HttpServerResponse.jsonUnsafe(error.toObject(), { status })
  }
  if (error instanceof Session.BusyError) {
    log.info("error-middleware:busy", { message: error.message })
    return HttpServerResponse.jsonUnsafe(new NamedError.Unknown({ message: error.message }).toObject(), {
      status: 400,
    })
  }
  return undefined
}

// Catches both defects and typed NamedError fails so that endpoints which forgot to declare
// an `error` type still produce a serialized JSON response instead of an empty 400 body.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      // Handle typed NamedError / BusyError failures (Effect.fail) — even if endpoint did not declare them.
      const failReason = cause.reasons
        .filter(Cause.isFailReason)
        .find((reason) => reason.error instanceof NamedError || reason.error instanceof Session.BusyError)
      if (failReason) {
        const error = failReason.error as unknown
        const response = responseFor(error)
        if (response) {
          log.info("error-middleware:typed-fail", {
            name: error instanceof NamedError ? error.name : "BusyError",
          })
          return Effect.succeed(response)
        }
      }

      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) {
        log.warn("error-middleware:passthrough", { cause: Cause.pretty(cause) })
        return Effect.failCause(cause)
      }

      const error = defect.defect
      log.error("failed", { error, cause: Cause.pretty(cause) })

      const response = responseFor(error)
      if (response) return Effect.succeed(response)

      log.warn("error-middleware:unknown-defect", {
        type: typeof error,
        constructor: error?.constructor?.name,
        message: error instanceof Error ? error.message : String(error),
      })
      return Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          new NamedError.Unknown({
            message: error instanceof Error && error.stack ? error.stack : String(error),
          }).toObject(),
          { status: 500 },
        ),
      )
    }),
  ),
).layer
