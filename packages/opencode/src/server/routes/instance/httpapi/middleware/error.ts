import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { iife } from "@/util/iife"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

const log = Log.create({ service: "server" })

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
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

      if (error instanceof NamedError) {
        const status = iife(() => {
          if (error instanceof NotFoundError) return 404
          if (error instanceof Provider.ModelNotFoundError) return 400
          if (error.name === "ProviderAuthValidationFailed") return 400
          if (error.name.startsWith("Worktree")) return 400
          return 500
        })
        log.info("error-middleware:named", { name: error.name, status, message: error.message })
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(error.toObject(), {
            status,
          }),
        )
      }
      if (error instanceof Session.BusyError) {
        log.info("error-middleware:busy", { message: error.message })
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(new NamedError.Unknown({ message: error.message }).toObject(), {
            status: 400,
          }),
        )
      }

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
