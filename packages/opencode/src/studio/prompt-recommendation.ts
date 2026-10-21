import { logRecommendationFailure } from "./prompt-recommendation-log"
import { createHash } from "node:crypto"
import path from "node:path"
import { readRecommendationImages } from "./prompt-recommendation-images"
import { Context, Effect, Layer } from "effect"
import { Slug } from "@opencode-ai/core/util/slug"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Database, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { insertCategory } from "@/session/session-category-query"
import { SyncEvent } from "@/sync"
import { StudioGenerationTable } from "./studio-generation.sql"
import { assertNoGeneration, studioSubmissionState } from "./prompt-recommendation-state"
import { acquireBudget, createPreparation, type PreparationBudget } from "./prompt-recommendation-budget"
import { expandPrompt, selectExpansionModel, type ExpansionServices } from "./prompt-expansion"
import {
  GUIDE_TEXT,
  guideSchema,
  resultSchema,
  initializeSchema,
  submissionSchema,
  RecommendationError,
  type Guide,
  type Expansion,
} from "./prompt-recommendation-schema"

type Preparation = { controller: AbortController; done: Promise<void> }
type Run = { assistantMessageID: string; controller: AbortController; done: Promise<void> }
class Runs extends Context.Service<
  Runs,
  { get: () => Effect.Effect<{ runs: Map<string, Run>; preparing: Set<Preparation>; closing: boolean }> }
>()("StudioRecommendationRuns") {}
const runsLayer = Layer.effect(
  Runs,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const current = { runs: new Map<string, Run>(), preparing: new Set<Preparation>(), closing: false }
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            current.closing = true
            current.runs.forEach((run) => run.controller.abort())
            current.preparing.forEach((item) => item.controller.abort())
            await Promise.allSettled([...current.runs.values(), ...current.preparing].map((run) => run.done))
            current.runs.clear()
          }),
        )
        return current
      }),
    )
    return Runs.of({ get: () => InstanceState.get(state) })
  }),
)
const runtime = makeRuntime(Runs, runsLayer)
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const scope = () => [Instance.project.id, WorkspaceContext.workspaceID ?? null, Instance.directory]

function session(id: string) {
  const row = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, SessionID.make(id)))
      .get(),
  )
  if (
    !row ||
    row.directory !== Instance.directory ||
    row.project_id !== Instance.project.id ||
    (row.workspace_id ?? undefined) !== WorkspaceContext.workspaceID ||
    row.agent !== "octo_studio"
  )
    throw new RecommendationError("SESSION_NOT_FOUND", 404)
  return row
}
function part(id: string) {
  const row = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(eq(PartTable.id, PartID.make(id)))
      .get(),
  )
  if (!row) return
  const value = { ...row.data, id: row.id, messageID: row.message_id, sessionID: row.session_id } as MessageV2.Part
  return value.type === "text" ? value : undefined
}
function guide(id: string, sessionID: string) {
  const found = part(id)
  const metadata = guideSchema.safeParse(found?.metadata?.studioPromptRecommendation)
  if (!found || found.sessionID !== sessionID || !metadata.success)
    throw new RecommendationError("RECOMMENDATION_NOT_FOUND", 404)
  return { part: found, metadata: metadata.data }
}
function guides(sessionID: string) {
  return Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(eq(PartTable.session_id, SessionID.make(sessionID)))
      .all(),
  )
    .flatMap((row) => {
      const value = { ...row.data, id: row.id, messageID: row.message_id, sessionID: row.session_id } as MessageV2.Part
      if (value.type !== "text") return []
      const metadata = guideSchema.safeParse(value.metadata?.studioPromptRecommendation)
      return metadata.success ? [{ part: value, metadata: metadata.data }] : []
    })
    .sort((a, b) => a.part.messageID.localeCompare(b.part.messageID))
}
function writePart(value: MessageV2.TextPart | MessageV2.FilePart) {
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: value.sessionID, part: value, time: Date.now() })
}
function summarize(found: ReturnType<typeof guide>) {
  const submission = found.metadata.submission
  const result = submission
    ? resultSchema.safeParse(part(submission.resultPartID)?.metadata?.studioPromptExpansion)
    : undefined
  return {
    sessionID: found.part.sessionID,
    guideMessageID: found.part.messageID,
    guidePartID: found.part.id,
    guideRevision: found.metadata.revision,
    status:
      found.metadata.status === "armed"
        ? ("armed" as const)
        : result?.success
          ? result.data.status
          : ("failed" as const),
    ...(submission
      ? {
          submission: { requestID: submission.requestID },
          userMessageID: submission.userMessageID,
          assistantMessageID: submission.assistantMessageID,
          resultRevision: result?.success ? result.data.revision : undefined,
        }
      : {}),
  }
}
function snapshot(sessionID: string, guidePartID?: string) {
  const latest = guides(sessionID).at(-1)
  const summary = latest ? summarize(latest) : null
  return {
    stateToken: digest([scope(), sessionID, summary]),
    recommendation: guidePartID ? summarize(guide(guidePartID, sessionID)) : summary,
  }
}
function accepted(sessionID: string, guidePartID: string) {
  const state = snapshot(sessionID, guidePartID)
  return { ...state.recommendation!, stateToken: state.stateToken }
}
function finish(
  sessionID: string,
  resultPartID: string,
  status: "completed" | "failed" | "cancelled",
  result?: { expandedPrompt: string; tags: string[] },
  errorCode?: string,
) {
  Database.transaction(
    () => {
      const existingSession = Database.use((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, SessionID.make(sessionID)))
          .get(),
      )
      const value = part(resultPartID)
      const metadata = resultSchema.safeParse(value?.metadata?.studioPromptExpansion)
      if (!existingSession || !value || value.sessionID !== sessionID || !metadata.success) return
      if (metadata.data.status !== "running" && metadata.data.status !== "cancelling") return
      const original = part(metadata.data.guidePartID)
      const originalMetadata = guideSchema.safeParse(original?.metadata?.studioPromptRecommendation)
      if (
        original?.sessionID !== sessionID ||
        !originalMetadata.success ||
        originalMetadata.data.submission?.resultPartID !== resultPartID
      )
        return
      const finalStatus = metadata.data.status === "cancelling" ? "cancelled" : status
      writePart({
        ...value,
        text:
          finalStatus === "completed"
            ? result!.expandedPrompt
            : finalStatus === "cancelled"
              ? "扩写已取消。"
              : "扩写失败，请重新点击 AI推荐后提交。",
        metadata: {
          ...value.metadata,
          studioPromptExpansion: {
            ...metadata.data,
            revision: metadata.data.revision + 1,
            status: finalStatus,
            ...(finalStatus === "completed" ? { tags: result!.tags } : {}),
            ...(errorCode ? { errorCode } : {}),
          } satisfies Expansion,
        },
      })
      const message = Database.use((db) =>
        db.select().from(MessageTable).where(eq(MessageTable.id, value.messageID)).get(),
      )
      if (message) {
        const info = { ...message.data, id: message.id, sessionID: message.session_id } as MessageV2.Info
        if (info.role === "assistant")
          SyncEvent.run(MessageV2.Event.Updated, {
            sessionID: value.sessionID,
            info: {
              ...info,
              time: { ...info.time, completed: Date.now() },
              finish: finalStatus === "completed" ? "stop" : "other",
            },
          })
      }
    },
    { behavior: "immediate" },
  )
}

export async function getRecommendationState(sessionID: string, guidePartID?: string) {
  session(sessionID)
  const current = await runtime.runPromise((runs) => runs.get())
  Database.transaction(
    () => {
      guides(sessionID).forEach((found) => {
        const submission = found.metadata.submission
        if (!submission || current.runs.get(sessionID)?.assistantMessageID === submission.assistantMessageID) return
        const metadata = resultSchema.safeParse(part(submission.resultPartID)?.metadata?.studioPromptExpansion)
        if (!metadata.success || !["running", "cancelling"].includes(metadata.data.status)) return
        finish(
          sessionID,
          submission.resultPartID,
          metadata.data.status === "cancelling" ? "cancelled" : "failed",
          undefined,
          "EXECUTION_INTERRUPTED",
        )
      })
    },
    { behavior: "immediate" },
  )
  return snapshot(sessionID, guidePartID)
}

export async function initializeRecommendation(value: unknown, preparationBudget?: PreparationBudget) {
  const budget = preparationBudget ?? createPreparation()
  try {
    budget.check()
    const parsed = initializeSchema.safeParse(value)
    if (
      !parsed.success ||
      (parsed.data.sessionID && !parsed.data.expectedStateToken) ||
      (!parsed.data.sessionID && parsed.data.expectedStateToken)
    )
      throw new RecommendationError("INVALID_INPUT")
    const input = parsed.data
    const stableID = PartID.make(`prt_${digest([scope(), input.requestID])}`)
    if (input.sessionID) await getRecommendationState(input.sessionID)
    const submissions = await studioSubmissionState()
    budget.check()
    return Database.transaction(
      () => {
        const existing = part(stableID)
        if (existing) {
          session(existing.sessionID)
          const found = guide(existing.id, existing.sessionID)
          if (
            found.metadata.initializeRequestID !== input.requestID ||
            found.metadata.initializeDigest !== digest(input)
          )
            throw new RecommendationError("IDEMPOTENCY_CONFLICT", 409)
          return accepted(existing.sessionID, existing.id)
        }
        const id = input.sessionID ? SessionID.make(input.sessionID) : SessionID.descending()
        if (input.sessionID) {
          session(id)
          if (submissions.closing || submissions.sessions.has(id)) throw new RecommendationError("SESSION_BUSY", 409)
          const state = snapshot(id)
          const details = { guidePartID: state.recommendation?.guidePartID, stateToken: state.stateToken }
          if (state.stateToken !== input.expectedStateToken)
            throw new RecommendationError("RECOMMENDATION_STATE_CHANGED", 409, details)
          if (state.recommendation && ["armed", "running", "cancelling"].includes(state.recommendation.status))
            throw new RecommendationError("RECOMMENDATION_ALREADY_ACTIVE", 409, details)
          assertNoGeneration(id)
        }
        if (!input.sessionID) {
          SyncEvent.run(Session.Event.Created, {
            sessionID: id,
            info: {
              id,
              slug: Slug.create(),
              projectID: Instance.project.id,
              workspaceID: WorkspaceContext.workspaceID,
              directory: Instance.directory,
              version: InstallationVersion,
              title: "丰富提示词",
              agent: "octo_studio",
              time: { created: Date.now(), updated: Date.now() },
              sort_order: 0,
              pinned: false,
            },
          })
          insertCategory(id, "octo_studio")
        }
        const empty = !Database.use((db) =>
          db.select({ id: MessageTable.id }).from(MessageTable).where(eq(MessageTable.session_id, id)).get(),
        )
        if (input.sessionID && empty) {
          // A historical generation can exist without visible messages.
          const count = Database.use((db) =>
            db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.session_id, id)).get(),
          )
          if (!count) SyncEvent.run(Session.Event.Updated, { sessionID: id, info: { title: "丰富提示词" } })
        }
        const pair = messages(id, "点击AI推荐", true)
        writePart({
          id: stableID,
          sessionID: id,
          messageID: pair.assistant.id,
          type: "text",
          text: GUIDE_TEXT,
          metadata: {
            studioPromptRecommendation: {
              version: 1,
              kind: "guide",
              revision: 1,
              initializeRequestID: input.requestID,
              initializeDigest: digest(input),
              status: "armed",
            } satisfies Guide,
          },
        })
        return accepted(id, stableID)
      },
      { behavior: "immediate" },
    )
  } catch (error) {
    budget.check()
    throw error
  } finally {
    if (!preparationBudget) budget.dispose()
  }
}

function messages(sessionID: SessionID, text: string, entry: boolean, model?: { providerID: ProviderID; id: ModelID }) {
  const row = session(sessionID)
  const selected = model ?? {
    providerID: ProviderID.make(row.model?.providerID ?? "octo_studio"),
    id: ModelID.make(row.model?.id ?? "octo_studio"),
  }
  const user: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "octo_studio",
    model: { providerID: selected.providerID, modelID: selected.id },
  }
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: user.id,
    time: { created: Date.now(), ...(entry ? { completed: Date.now() } : {}) },
    providerID: selected.providerID,
    modelID: selected.id,
    mode: "octo_studio",
    agent: "octo_studio",
    path: { cwd: row.directory, root: row.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(entry ? { finish: "stop" } : {}),
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID, info: user })
  SyncEvent.run(MessageV2.Event.Updated, { sessionID, info: assistant })
  writePart({
    id: PartID.ascending(),
    sessionID,
    messageID: user.id,
    type: "text",
    text,
    ...(entry ? { synthetic: true, metadata: { studioPromptRecommendationEntry: true } } : {}),
  })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: Date.now() }).where(eq(SessionTable.id, sessionID)).run(),
  )
  return { user, assistant }
}

export async function submitExpansion(
  value: unknown,
  services?: ExpansionServices,
  preparationBudget?: PreparationBudget,
) {
  const budget = preparationBudget ?? createPreparation()
  try {
    budget.check()
    const parsed = submissionSchema.safeParse(value)
    if (!parsed.success) throw new RecommendationError("INVALID_INPUT")
    const input = {
      ...parsed.data,
      availableModels: parsed.data.availableModels.filter(
        (item, index, all) =>
          all.findIndex((other) => other.providerID === item.providerID && other.modelID === item.modelID) === index,
      ),
    }
    const row = session(input.sessionID)
    const hash = digest(input)
    const replay = () => {
      const found = guide(input.guidePartID, input.sessionID)
      if (!found.metadata.submission || found.metadata.submission.requestID !== input.requestID) return
      if (found.metadata.submission.digest !== hash) throw new RecommendationError("IDEMPOTENCY_CONFLICT", 409)
      return accepted(input.sessionID, input.guidePartID)
    }
    const repeated = replay()
    if (repeated) return repeated
    const current = await runtime.runPromise((runs) => runs.get())
    if (current.closing || current.runs.has(input.sessionID)) throw new RecommendationError("SESSION_BUSY", 409)
    const submissions = await studioSubmissionState()
    if (submissions.closing || submissions.sessions.has(input.sessionID))
      throw new RecommendationError("SESSION_BUSY", 409)
    if (guide(input.guidePartID, input.sessionID).metadata.status !== "armed")
      throw new RecommendationError("INVALID_RECOMMENDATION_STATE", 409)
    assertNoGeneration(input.sessionID)
    const release = acquireBudget("execution")
    const controller = new AbortController()
    const pending = Promise.withResolvers<void>()
    const preparation = { controller, done: pending.promise }
    current.preparing.add(preparation)
    let committed = false
    try {
      const signal = AbortSignal.any([controller.signal, budget.signal])
      const images = await readRecommendationImages(
        input.images,
        path.join(row.directory, ".octo", row.id, "uploads"),
        signal,
      )
      const expandedInput = { ...input, images }
      const model = await selectExpansionModel(expandedInput, row.model ?? undefined, signal, services)
      signal.throwIfAborted()
      budget.check()
      if (current.closing) throw new RecommendationError("SESSION_BUSY", 409)
      const acceptedResult = Database.transaction(
        () => {
          session(input.sessionID)
          if (current.closing || submissions.closing || submissions.sessions.has(input.sessionID))
            throw new RecommendationError("SESSION_BUSY", 409)
          const repeated = replay()
          if (repeated) return { response: repeated }
          const found = guide(input.guidePartID, input.sessionID)
          if (found.metadata.status !== "armed") throw new RecommendationError("INVALID_RECOMMENDATION_STATE", 409)
          assertNoGeneration(input.sessionID)
          const pair = messages(row.id, input.prompt, false, model)
          const resultPartID = PartID.ascending()
          images.forEach((image) =>
            writePart({
              id: PartID.ascending(),
              sessionID: row.id,
              messageID: pair.user.id,
              type: "file",
              mime: image.mime,
              url: image.path,
              filename: path.basename(image.path),
            }),
          )
          writePart({
            id: resultPartID,
            sessionID: row.id,
            messageID: pair.assistant.id,
            type: "text",
            text: "",
            metadata: {
              studioPromptExpansion: {
                version: 1,
                kind: "result",
                revision: 1,
                guidePartID: input.guidePartID,
                status: "running",
              } satisfies Expansion,
            },
          })
          writePart({
            ...found.part,
            metadata: {
              ...found.part.metadata,
              studioPromptRecommendation: {
                ...found.metadata,
                revision: found.metadata.revision + 1,
                status: "consumed",
                submission: {
                  requestID: input.requestID,
                  digest: hash,
                  userMessageID: pair.user.id,
                  assistantMessageID: pair.assistant.id,
                  resultPartID,
                },
              } satisfies Guide,
            },
          })
          return {
            response: accepted(input.sessionID, input.guidePartID),
            work: { user: pair.user, assistant: pair.assistant, resultPartID },
          }
        },
        { behavior: "immediate" },
      )
      if (!acceptedResult.work) return acceptedResult.response
      committed = true
      const work = acceptedResult.work
      const startedAt = Date.now()
      const context = {
        sessionID: row.id, requestID: input.requestID, guidePartID: input.guidePartID,
        assistantMessageID: work.assistant.id, providerID: model.providerID, modelID: model.id,
      }
      const done = Instance.bind(async () => {
        try {
          if (controller.signal.aborted) {
            logRecommendationFailure(controller.signal.reason, {
              ...context, stage: "execution", cancelled: true, elapsedMs: Date.now() - startedAt,
            })
            finish(row.id, work.resultPartID, "cancelled")
            return
          }
          const result = await expandPrompt(expandedInput, work.user, model, controller.signal, services)
          finish(row.id, work.resultPartID, "completed", result)
        } catch (error) {
          logRecommendationFailure(error, {
            ...context, stage: "execution", elapsedMs: Date.now() - startedAt,
            cancelled: controller.signal.aborted,
            code: error instanceof RecommendationError ? error.code : "INVALID_MODEL_OUTPUT",
          })
          finish(
            row.id,
            work.resultPartID,
            controller.signal.aborted ? "cancelled" : "failed",
            undefined,
            error instanceof RecommendationError ? error.code : "INVALID_MODEL_OUTPUT",
          )
        } finally {
          current.runs.delete(row.id)
          release()
        }
      })
      // Register synchronously before starting work; readers cannot mistake startup for interruption.
      const run: Run = { assistantMessageID: work.assistant.id, controller, done: Promise.resolve() }
      current.runs.set(row.id, run)
      run.done = Promise.resolve()
        .then(done)
        .catch((error) => {
          logRecommendationFailure(error, {
            ...context, stage: "terminal-persistence", code: "EXECUTION_INTERRUPTED",
            elapsedMs: Date.now() - startedAt,
          })
        })
      return acceptedResult.response
    } finally {
      current.preparing.delete(preparation)
      pending.resolve()
      if (!committed) {
        release()
      }
    }
  } catch (error) {
    budget.check()
    throw error
  } finally {
    if (!preparationBudget) budget.dispose()
  }
}

export async function cancelExpansion(sessionID: string, assistantMessageID: string) {
  session(sessionID)
  const current = await runtime.runPromise((runs) => runs.get())
  const found = guides(sessionID).find((item) => item.metadata.submission?.assistantMessageID === assistantMessageID)
  if (!found?.metadata.submission) throw new RecommendationError("RECOMMENDATION_NOT_FOUND", 404)
  const result = part(found.metadata.submission.resultPartID)
  const metadata = resultSchema.safeParse(result?.metadata?.studioPromptExpansion)
  if (result && metadata.success && metadata.data.status === "running") {
    Database.transaction(
      () =>
        writePart({
          ...result,
          metadata: {
            ...result.metadata,
            studioPromptExpansion: {
              ...metadata.data,
              revision: metadata.data.revision + 1,
              status: "cancelling",
            } satisfies Expansion,
          },
        }),
      { behavior: "immediate" },
    )
  }
  const run = current.runs.get(sessionID)
  if (run?.assistantMessageID === assistantMessageID) run.controller.abort()
  if (!run) await getRecommendationState(sessionID, found.part.id)
  return accepted(sessionID, found.part.id)
}
