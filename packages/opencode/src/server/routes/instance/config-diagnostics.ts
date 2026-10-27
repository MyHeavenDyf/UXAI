import { randomUUID } from "node:crypto"
import { Cause, Effect, Schema, type SchemaIssue } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import * as InstanceState from "@/effect/instance-state"

// Never format a schema error's message: it can contain the complete config,
// including credentials. Only expose field paths and schema node types.
export function configFailure(error: unknown) {
  const issues: { path: string[]; type: string; expected?: string }[] = []
  const visit = (issue: SchemaIssue.Issue, path: string[] = [], depth = 0): void => {
    if (issues.length >= 20 || depth >= 20) return
    if (issue._tag === "Pointer") {
      visit(issue.issue, [...path, ...issue.path.map((key) => String(key).slice(0, 160))], depth + 1)
      return
    }
    if ("issues" in issue) {
      issue.issues.forEach((child) => visit(child, path, depth + 1))
      return
    }
    if ("issue" in issue) {
      visit(issue.issue, path, depth + 1)
      return
    }
    issues.push({ path, type: issue._tag, ...("ast" in issue ? { expected: issue.ast._tag } : {}) })
  }
  const schema = HttpApiError.HttpApiSchemaError.is(error) ? error.cause : error
  if (Schema.isSchemaError(schema)) visit(schema.issue)
  const data = error && typeof error === "object" && "data" in error ? error.data : undefined
  // Config parsing wraps validation failures in a NamedError. Do not log its
  // message or issue messages, which may embed invalid values or raw JSON.
  if (data && typeof data === "object" && "issues" in data && Array.isArray(data.issues)) {
    data.issues.slice(0, 20).forEach((issue: unknown) => {
      if (!issue || typeof issue !== "object" || !("path" in issue) || !Array.isArray(issue.path)) return
      issues.push({
        path: issue.path.map((key: unknown) => String(key).slice(0, 160)),
        type: "ConfigValidation",
      })
    })
  }
  return {
    name: error && typeof error === "object" && "name" in error && typeof error.name === "string"
      ? error.name.slice(0, 100) : typeof error,
    ...(HttpApiError.HttpApiSchemaError.is(error) ? { kind: error.kind } : {}),
    ...(error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^E[A-Z0-9_]+$/.test(error.code)
      ? { code: error.code } : {}),
    ...(data && typeof data === "object" && "path" in data && typeof data.path === "string" ? { source: data.path } : {}),
    ...(issues.length ? { issues } : {}),
  }
}

export function configCause(cause: Cause.Cause<unknown>) {
  return cause.reasons.slice(0, 10).map((reason) => {
    if (Cause.isFailReason(reason)) return configFailure(reason.error)
    if (Cause.isDieReason(reason)) return configFailure(reason.defect)
    return { name: "Interrupted" }
  })
}

export function traceConfigRead<A, E, R>(effect: Effect.Effect<A, E, R>, backend: string) {
  return Effect.gen(function* () {
    const metadata = { readID: randomUUID(), directory: (yield* InstanceState.context).directory, backend }
    const started = Date.now()
    console.info("[octo:config]", JSON.stringify({ ...metadata, stage: "read:start" }))
    return yield* effect.pipe(
      Effect.tap(() => Effect.sync(() => console.info("[octo:config]", JSON.stringify({
        ...metadata, stage: "read:success", elapsedMs: Date.now() - started,
      })))),
      Effect.tapCause((cause) => Effect.sync(() => console.error("[octo:config]", JSON.stringify({
        ...metadata, stage: "read:failed", elapsedMs: Date.now() - started, errors: configCause(cause),
      })))),
    )
  })
}
