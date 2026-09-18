import { randomUUID } from "node:crypto"
import { and, eq, lte, or } from "drizzle-orm"
import { Context, Effect, Layer, Schedule, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@/storage/db"
import { makeRuntime } from "@/effect/run-service"
import { ArtifactEventTable as Events } from "./delivery.sql"
import { recover } from "./store"
import { record } from "./facts"

export function endpoint(base: string) {
  const url = new URL(base)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("invalid-report-base-url")
  return `${base.replace(/\/+$/, "").replace(/\/record\/logger\/interaction$/, "")}/record/logger/interaction`
}

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
      if (!row) return
      const lease = randomUUID()
      db.update(Events)
        .set({ state: "sending", lease, lease_until: now + 30_000, attempts: row.attempts + 1 })
        .where(eq(Events.id, row.id))
        .run()
      return { ...row, lease, attempts: row.attempts + 1 }
    },
    { behavior: "immediate" },
  )
}

export function finish(
  row: NonNullable<ReturnType<typeof claim>>,
  result: { ok: boolean; status: number },
  now = Date.now(),
) {
  const retry = result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500
  const applied = Database.use((db) =>
    db
      .update(Events)
      .set({
        state: result.ok ? "sent" : retry ? "pending" : "failed",
        next_at: now + Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts, 12)),
        lease: null,
        lease_until: null,
        reason: result.ok ? null : `HTTP ${result.status}; ${retry ? "retry" : "response-rejected"}`,
      })
      .where(and(eq(Events.id, row.id), eq(Events.lease, row.lease), eq(Events.state, "sending")))
      .returning({ id: Events.id })
      .get(),
  )
  if (!applied) return
  console.info("[octo:artifact] delivery", {
    eventId: row.id,
    name: row.name,
    status: result.status,
    ok: result.ok,
    attempts: row.attempts,
  })
}

export const deliver = (url: string, contract: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    for (let i = 0; i < 20; i++) {
      const row = yield* Effect.sync(() => claim())
      if (!row) return
      const result = yield* Effect.gen(function* () {
        const response = yield* http.execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.setHeader("Idempotency-Key", row.id),
            HttpClientRequest.bodyText(JSON.stringify(row.payload), "application/json"),
          ),
        )
        const body =
          contract === "code-0" && response.status >= 200 && response.status < 300
            ? yield* response.json.pipe(Effect.catchCause(() => Effect.succeed(undefined)))
            : undefined
        return {
          status: response.status,
          ok: response.status >= 200 && response.status < 300 && (contract === "http-2xx" || record(body).code === 0),
        }
      }).pipe(
        Effect.timeout("10 seconds"),
        Effect.catchCause(() => Effect.succeed({ status: 0, ok: false })),
      )
      yield* Effect.sync(() => finish(row, result))
    }
  })

export class Service extends Context.Service<Service, { tick: Effect.Effect<void> }>()("@opencode/ArtifactDelivery") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const gate = Semaphore.makeUnsafe(1)
    console.info("[octo:artifact] server sender started", {
      database: Database.Path,
      reportConfigured: Boolean(process.env.OCTO_REPORT_BASE_URL || process.env.VITE_OCTO_REPORT_BASE_URL),
      successContract: process.env.OCTO_ARTIFACT_SUCCESS || "http-2xx",
    })
    const tick = Effect.gen(function* () {
      const base = process.env.OCTO_REPORT_BASE_URL || process.env.VITE_OCTO_REPORT_BASE_URL
      const contract = process.env.OCTO_ARTIFACT_SUCCESS || "http-2xx"
      const url = yield* Effect.try({ try: () => (base ? endpoint(base) : ""), catch: () => "invalid-url" }).pipe(
        Effect.catch(() => Effect.succeed("")),
      )
      if (!url || !["http-2xx", "code-0"].includes(contract)) {
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(Events)
              .set({
                reason: !url ? "missing-or-invalid-report-url" : "invalid-success-contract",
              })
              .where(eq(Events.state, "pending"))
              .run(),
          ),
        )
        return
      }
      yield* deliver(url, contract).pipe(Effect.provideService(HttpClient.HttpClient, http))
    }).pipe(
      gate.withPermits(1),
      Effect.catchCause(() => Effect.logWarning("[octo:artifact] sender failed; queue retained")),
    )
    // Replay saved results at startup and periodically as a crash/failure safety net.
    // This never executes MCP tools or polls remote business tasks.
    yield* Effect.sync(recover).pipe(
      Effect.catchCause(() => Effect.logWarning("[octo:artifact] recovery deferred")),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    )
    yield* tick.pipe(Effect.repeat(Schedule.spaced("5 seconds")), Effect.forkScoped)
    return { tick }
  }),
)

const runtime = makeRuntime(Service, layer.pipe(Layer.provide(FetchHttpClient.layer)))
export function wake() {
  runtime.runFork((service) => service.tick)
}
export * as ArtifactSender from "./sender"
