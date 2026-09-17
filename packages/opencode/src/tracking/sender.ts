import { randomUUID } from "node:crypto"
import { and, eq, lte, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schedule } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@/storage/db"
import { makeRuntime } from "@/effect/run-service"
import { ArtifactEventTable as Events } from "./artifact.sql"
import { cleanup, mode, replay } from "./store"
import { record } from "./facts"
import { recoverScans, recoverObservedScans } from "./scanner"
import { pollTasks } from "./tasks"

const LEASE_MS = 30_000

export function claim(now = Date.now()) {
  return Database.Client().transaction(
    (db) => {
      const row = db
        .select()
        .from(Events)
        .where(
          or(
            and(eq(Events.state, "pending"), lte(Events.next_at, now)),
            and(eq(Events.state, "sending"), lte(Events.lease_until, now)),
          ),
        )
        .orderBy(Events.created_at)
        .get()
      if (!row?.payload) return
      const lease = randomUUID()
      db.update(Events)
        .set({ state: "sending", lease, lease_until: now + LEASE_MS, attempts: row.attempts + 1 })
        .where(eq(Events.id, row.id))
        .run()
      return { ...row, lease, attempts: row.attempts + 1 }
    },
    { behavior: "immediate" },
  )
}

export function retryDelay(attempts: number, retryAfter?: string, now = Date.now()) {
  const specified = retryAfter
    ? /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - now
    : 0
  return Math.max(
    Number.isFinite(specified) ? specified : 0,
    Math.min(3_600_000, 1000 * 2 ** Math.min(attempts, 12)) * (0.75 + Math.random() * 0.5),
  )
}

export function finish(
  row: NonNullable<ReturnType<typeof claim>>,
  result: { status: number; ok: boolean; retryAfter?: string },
  now = Date.now(),
) {
  const retry = result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500
  Database.use((db) =>
    db
      .update(Events)
      .set({
        state: result.ok ? "sent" : retry ? "pending" : "failed",
        next_at: retry ? now + retryDelay(row.attempts, result.retryAfter, now) : 0,
        lease: null,
        lease_until: null,
        reason: result.ok ? null : `HTTP ${result.status}; ${retry ? "retry" : "response rejected"}`,
      })
      .where(and(eq(Events.id, row.id), eq(Events.lease, row.lease), eq(Events.state, "sending")))
      .run(),
  )
}

export class Service extends Context.Service<Service, { tick: Effect.Effect<void>; init: () => Effect.Effect<void> }>()(
  "@opencode/ArtifactSender",
) {}

export const deliver = (base: string, contract: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    for (let i = 0; i < 20; i++) {
      const row = yield* Effect.sync(() => claim())
      if (!row) break
      const result = yield* Effect.gen(function* () {
        const response = yield* http.execute(
          HttpClientRequest.post(`${base.replace(/\/$/, "")}/record/logger/interaction`).pipe(
            HttpClientRequest.bodyText(row.payload!, "application/json"),
          ),
        )
        if (response.status < 200 || response.status >= 300)
          return { status: response.status, ok: false, retryAfter: response.headers["retry-after"] }
        const body =
          contract === "code-0"
            ? yield* response.json.pipe(Effect.catchCause(() => Effect.succeed(undefined)))
            : undefined
        return {
          status: response.status,
          ok: response.status >= 200 && response.status < 300 && (contract === "http-2xx" || record(body).code === 0),
          retryAfter: response.headers["retry-after"],
        }
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.catchCause(() => Effect.succeed({ status: 0, ok: false, retryAfter: undefined })),
      )
      yield* Effect.sync(() => finish(row, result))
    }
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    let lastDiagnostic = ""
    console.info("[octo:artifact] worker initialized", {
      mode: mode(),
      reportConfigured: !!process.env.OCTO_REPORT_BASE_URL,
      successContract: process.env.OCTO_ARTIFACT_SUCCESS || "unset",
      scripts: process.env.OCTO_ARTIFACT_SCRIPTS === "1",
      diagnostics: process.env.OCTO_ARTIFACT_DIAGNOSTICS === "1",
    })
    yield* Effect.sync(recoverScans).pipe(
      Effect.catchCause(() => Effect.logWarning("[octo:artifact] scan recovery failed")),
    )
    const tick = Effect.gen(function* () {
      yield* Effect.sync(cleanup)
      yield* Effect.promise(() => pollTasks()).pipe(
        Effect.catchCause(() => Effect.logWarning("[octo:artifact] async task polling deferred")),
      )
      yield* Effect.sync(() => {
        replay()
        recoverObservedScans()
      }).pipe(Effect.catchCause(() => Effect.logWarning("[octo:artifact] replay deferred; sender continues draining")))
      yield* Effect.sync(() => {
        const states = Database.use((db) =>
          db
            .select({ state: Events.state, count: sql<number>`count(*)` })
            .from(Events)
            .groupBy(Events.state)
            .all(),
        )
        const diagnostic = JSON.stringify(states)
        if (diagnostic === lastDiagnostic) return
        lastDiagnostic = diagnostic
        console.info("[octo:artifact] queue", states)
      })
      const base = process.env.OCTO_REPORT_BASE_URL
      const contract = process.env.OCTO_ARTIFACT_SUCCESS
      // Existing server-owned pending events continue draining after rollout is disabled.
      if (!base || !["http-2xx", "code-0"].includes(contract ?? "")) return
      yield* deliver(base, contract!).pipe(Effect.provideService(HttpClient.HttpClient, http))
    }).pipe(Effect.catchCause(() => Effect.logWarning("[octo:artifact] worker failed; persisted facts retained")))
    // One scoped worker per shared runtime, independent of the visible session.
    yield* tick.pipe(Effect.repeat(Schedule.spaced("2 seconds")), Effect.forkScoped)
    return { tick, init: () => Effect.void }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))
export const runtime = makeRuntime(Service, defaultLayer)

let startup: Promise<void> | undefined
export function start() {
  startup ??= runtime.runPromise((service) => service.init())
  return startup
}

export * as ArtifactSender from "./sender"
