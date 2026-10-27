import { randomUUID } from "node:crypto"
import { Cause, Context, Effect, Exit, Option, Schema } from "effect"
import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

const diagnosticVersion = 2

// Do not invoke getters/toJSON or format errors, which can expose config values.
function field(value: unknown, key: PropertyKey): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return
  try {
    for (const current of [value, Object.getPrototypeOf(value)]) {
      if (!current) continue
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (descriptor && "value" in descriptor) return descriptor.value
    }
  } catch {
    // A diagnostic must not replace the original failure with a Proxy error.
    return undefined
  }
}

function valueType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number" && !Number.isFinite(value)) return "non-finite-number"
  return typeof value
}

/** Bounded structural extraction supports raw issues, Effect causes, legacy
 * ParseError/ZodError and unknown wrappers, without dumping any config values. */
export function configFailure(error: unknown) {
  const issues: { path: string[]; type: string; expected?: string; expectedKinds?: string[]; actualType?: string }[] = []
  const wrappers: { type: string; via: string; depth: number; fields: string[]; code?: string; source?: string; syscall?: string }[] = []
  const truncated = new Set<string>()
  const visited = new Set<object>()
  const pending = [{ value: error, path: [] as string[], depth: 0, via: "root" }]
  const label = (value: unknown) => typeof value === "string" && /^[A-Za-z][\w.-]{0,99}$/.test(value) ? value : undefined
  const state = { nodes: 0, cyclic: false, inspectionFailed: false }
  try {
    while (pending.length) {
      if (state.nodes >= 2048) { truncated.add("nodes"); break }
      if (issues.length >= 50) { truncated.add("issues"); break }
      const item = pending.pop()!
      state.nodes++
      if (!item.value || typeof item.value !== "object") continue
      if (visited.has(item.value)) { state.cyclic = true; continue }
      visited.add(item.value)
      if (item.depth >= 128) { truncated.add("depth"); continue }
      const rawPath = field(item.value, "path")
      if (Array.isArray(rawPath) && rawPath.length > 128) truncated.add("path")
      if (Array.isArray(rawPath) && rawPath.some((key) => typeof key === "string" && key.length > 160)) truncated.add("path-segment")
      const path = Array.isArray(rawPath)
        ? [...item.path, ...rawPath.slice(0, 128).map((key) => typeof key === "string" || typeof key === "number" || typeof key === "symbol"
          ? String(key).slice(0, 160) : "[non-property-key]")]
        : item.path
      if (path.length > 128) { truncated.add("path"); continue }
      const type = label(field(item.value, "_tag")) ?? label(field(item.value, "name")) ?? "Object"
      const fields = Object.getOwnPropertyNames(item.value)
      if (fields.length > 16) truncated.add("wrapper-fields")
      if (wrappers.length >= 32) truncated.add("wrappers")
      if (wrappers.length < 32) wrappers.push({
        type, via: item.via, depth: item.depth, fields: fields.slice(0, 16).map((key) => key.slice(0, 80)),
        ...(typeof field(item.value, "code") === "string" && /^E[A-Z0-9_]+$/.test(String(field(item.value, "code")))
          ? { code: String(field(item.value, "code")) } : {}),
        ...(typeof rawPath === "string" ? { source: rawPath.slice(0, 1024) } : {}),
        ...(typeof field(item.value, "syscall") === "string" && /^[a-z_]{1,32}$/.test(String(field(item.value, "syscall")))
          ? { syscall: String(field(item.value, "syscall")) } : {}),
      })
      const children = ["cause", "issue", "issues", "errors", "reasons", "error", "defect", "data", "left", "right"]
        .flatMap((key) => {
          const value = field(item.value, key)
          if (Array.isArray(value)) {
            if (value.length > 256) truncated.add("children")
            return value.slice(0, 256).map((value) => ({ value, via: key }))
          }
          return value && typeof value === "object" ? [{ value, via: key }] : []
        })
      if (!children.length && (Array.isArray(rawPath) || field(item.value, "actual") !== undefined || field(item.value, "ast") !== undefined)) {
        const actual = field(item.value, "actual")
        const expected = label(field(field(item.value, "ast"), "_tag"))
          ?? (["string", "number", "boolean", "array", "object", "integer", "null", "undefined"].includes(String(field(item.value, "expected")))
            ? String(field(item.value, "expected")) : undefined)
        const alternatives = field(field(item.value, "ast"), "types")
        if (Array.isArray(alternatives) && alternatives.length > 16) truncated.add("expectedKinds")
        issues.push({
          path,
          type: type === "Object" ? "ConfigValidation" : type,
          ...(expected ? { expected } : {}),
          ...(Array.isArray(alternatives) ? { expectedKinds: alternatives.slice(0, 16)
            .flatMap((ast) => label(field(ast, "_tag")) ?? []) } : {}),
          ...(type === "MissingKey" ? { actualType: "missing" } : {}),
          ...(actual !== undefined ? { actualType: field(actual, "_tag") === "Some"
            ? valueType(field(actual, "value")) : field(actual, "_tag") === "None" ? "missing" : valueType(actual) } : {}),
        })
      }
      pending.push(...children.reverse().map((child) => ({ ...child, path, depth: item.depth + 1 })))
    }
  } catch {
    state.inspectionFailed = true
  }
  const data = field(error, "data")
  return {
    name: typeof field(error, "name") === "string" ? String(field(error, "name")).slice(0, 100) : valueType(error),
    ...(["Params", "Headers", "Query", "Body", "Payload"].includes(String(field(error, "kind"))) ? { kind: field(error, "kind") } : {}),
    ...(typeof field(error, "code") === "string" && /^E[A-Z0-9_]+$/.test(String(field(error, "code"))) ? { code: field(error, "code") } : {}),
    ...(typeof field(data, "path") === "string" ? { source: field(data, "path") } : {}),
    issues,
    diagnostics: {
      version: diagnosticVersion, nodes: state.nodes, wrappers,
      extraction: issues.length ? "structured" : "no-structured-issues",
      truncated: truncated.size > 0, limits: [...truncated], cyclic: state.cyclic, inspectionFailed: state.inspectionFailed,
    },
  }
}

export function configCause(cause: Cause.Cause<unknown>) {
  const reasons = cause.reasons.slice(0, 10).map((reason) => {
    if (Cause.isFailReason(reason)) return configFailure(reason.error)
    if (Cause.isDieReason(reason)) return configFailure(reason.defect)
    return { name: "Interrupted" }
  })
  return cause.reasons.length > 10
    ? [...reasons, { name: "DiagnosticLimit", truncated: true, limit: "cause-reasons", total: cause.reasons.length }]
    : reasons
}

/** Full validation is failure-only: successful requests keep their single
 * encode. Probe the canonical schema independently of HTTP wrapper formats. */
export function diagnoseConfigValue(value: unknown) {
  try {
    const failures: { path: string[]; reason: string }[] = []
    const ancestors = new Set<object>()
    const state = { nodes: 0, truncated: false, indeterminate: false }
    const inspect = (value: unknown, path: string[] = []) => {
      if (state.nodes++ >= 4096 || path.length >= 128 || failures.length >= 30) { state.truncated = true; return }
      if (typeof value === "bigint") { failures.push({ path, reason: "bigint" }); return }
      if (!value || typeof value !== "object") return
      if (ancestors.has(value)) { failures.push({ path, reason: "circular-reference" }); return }
      if (typeof field(value, "toJSON") === "function") {
        state.indeterminate = true
        failures.push({ path, reason: "custom-toJSON-not-invoked" })
        return
      }
      ancestors.add(value)
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable) continue
        if (!("value" in descriptor)) {
          state.indeterminate = true
          failures.push({ path: [...path, key.slice(0, 160)], reason: "accessor-not-invoked" })
          continue
        }
        inspect(descriptor.value, [...path, key.slice(0, 160)])
        if (state.truncated) break
      }
      ancestors.delete(value)
    }
    inspect(value)
    // Schema codecs may read properties too. Do not run them when the safe
    // scan found getters/custom conversions or exceeded its work budget.
    const validated = state.indeterminate || state.truncated ? undefined
      : Schema.encodeUnknownExit(Config.Info)(value, { errors: "all" })
    return {
      schema: validated === undefined ? { status: "not-run", reason: "unsafe-or-truncated-value" }
        : Exit.isSuccess(validated) ? { status: "success" }
        : { status: "failed", errors: configCause(validated.cause) },
      json: {
        status: state.indeterminate || state.truncated ? "indeterminate" : failures.length ? "failed" : "compatible",
        failures, truncated: state.truncated, nodes: state.nodes,
      },
    }
  } catch (error) {
    return { status: "diagnostic-failed", error: configFailure(error) }
  }
}

export function createConfigTrace(input: { backend: string; directory?: string; requestID?: string }) {
  return {
    ...input,
    requestID: input.requestID ?? randomUUID(),
    started: Date.now(),
    errors: [] as unknown[],
    read: {
      stage: "not-started" as "not-started" | "started" | "success" | "failed",
      captured: false, value: undefined as unknown, directory: undefined as string | undefined,
    },
  }
}

export class ConfigTraceContext extends Context.Service<ConfigTraceContext, ReturnType<typeof createConfigTrace>>()(
  "@opencode/ConfigDiagnosticRequest",
) {}

export function configTraceLog(trace: ReturnType<typeof createConfigTrace>, stage: string, extra: Record<string, unknown> = {}) {
  console[stage.includes("failed") ? "error" : "info"]("[octo:config]", JSON.stringify({
    diagnosticVersion, version: InstallationVersion, requestID: trace.requestID, backend: trace.backend, directory: trace.directory,
    stage, readStage: trace.read.stage, resolvedDirectory: trace.read.directory,
    elapsedMs: Date.now() - trace.started, ...extra,
  }))
}

export function configTraceFailure(trace: ReturnType<typeof createConfigTrace>, errors: unknown) {
  configTraceLog(trace, "request:failed", {
    errors,
    phase: trace.read.stage === "not-started" ? "before-config-read" : trace.read.stage === "failed" ? "config-read" : "response",
    configProbe: trace.read.captured ? diagnoseConfigValue(trace.read.value) : { status: "not-read" },
  })
}

export function traceConfigRead<A, E, R>(effect: Effect.Effect<A, E, R>, backend: string, request?: ReturnType<typeof createConfigTrace>) {
  return Effect.gen(function* () {
    const trace = request ?? Option.getOrUndefined(yield* Effect.serviceOption(ConfigTraceContext))
      ?? createConfigTrace({ backend, directory: (yield* InstanceState.context).directory })
    trace.read.stage = "started"
    trace.read.directory = (yield* InstanceState.context).directory
    configTraceLog(trace, "read:start", { readID: randomUUID() })
    return yield* effect.pipe(
      Effect.tap((value) => Effect.sync(() => {
        trace.read.stage = "success"
        trace.read.value = value
        trace.read.captured = true
        configTraceLog(trace, "read:success")
      })),
      Effect.tapCause((cause) => Effect.sync(() => {
        trace.read.stage = "failed"
        configTraceLog(trace, "read:failed", { errors: configCause(cause) })
      })),
    )
  })
}
