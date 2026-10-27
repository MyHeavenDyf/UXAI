import { and, eq, inArray, Database } from "@/storage/db"
import type { MessageV2 } from "@/session/message-v2"
import { PartTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { StudioGenerationTable } from "./studio-generation.sql"
import { guideSchema, resultSchema, RecommendationError } from "./prompt-recommendation-schema"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

class Submissions extends Context.Service<
  Submissions,
  { get: () => Effect.Effect<{ sessions: Set<string>; closing: boolean }> }
>()("StudioSubmissions") {}
const layer = Layer.effect(
  Submissions,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const current = { sessions: new Set<string>(), closing: false }
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            current.closing = true
          }),
        )
        return current
      }),
    )
    return Submissions.of({ get: () => InstanceState.get(state) })
  }),
)
const runtime = makeRuntime(Submissions, layer)
export const studioSubmissionState = () => runtime.runPromise((service) => service.get())

export async function withStudioSubmission<A>(sessionID: string, work: () => Promise<A>) {
  const state = await studioSubmissionState()
  if (state.closing || state.sessions.has(sessionID)) throw new RecommendationError("SESSION_BUSY", 409)
  state.sessions.add(sessionID)
  try {
    return await work()
  } finally {
    state.sessions.delete(sessionID)
  }
}

export function assertCanGenerate(sessionID: string) {
  const busy = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(eq(PartTable.session_id, SessionID.make(sessionID)))
      .all(),
  ).some((row) => {
    const part = row.data as Omit<MessageV2.TextPart, "id" | "messageID" | "sessionID">
    if (part.type !== "text") return false
    const guide = guideSchema.safeParse(part.metadata?.studioPromptRecommendation)
    const result = resultSchema.safeParse(part.metadata?.studioPromptExpansion)
    return (
      (guide.success && guide.data.status === "armed") ||
      (result.success && (result.data.status === "running" || result.data.status === "cancelling"))
    )
  })
  if (busy) throw new RecommendationError("SESSION_BUSY", 409)
}

export function assertNoGeneration(sessionID: string) {
  const busy = Database.use((db) =>
    db
      .select({ id: StudioGenerationTable.id })
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.session_id, SessionID.make(sessionID)),
          inArray(StudioGenerationTable.status, ["creating", "queued", "running", "abnormal"]),
        ),
      )
      .get(),
  )
  if (busy) throw new RecommendationError("SESSION_BUSY", 409)
}
