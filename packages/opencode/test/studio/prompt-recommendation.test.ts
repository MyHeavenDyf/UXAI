import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database, eq, sql } from "@/storage/db"
import { SessionTable, MessageTable, PartTable } from "@/session/session.sql"
import { SessionID, PartID } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
import { initializeRecommendation, getRecommendationState, submitExpansion } from "@/studio/prompt-recommendation"
import { assertCanGenerate } from "@/studio/prompt-recommendation-state"
import { createPreparation, readRecommendationBody } from "@/studio/prompt-recommendation-budget"
import { InstanceState } from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.instance("one preparation deadline covers body reading and initialization without late persistence", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const budget = createPreparation(undefined, 100)
        const before = Database.use((db) => db.select().from(SessionTable).all()).length
        try {
          const chunks = async function* () {
            yield new TextEncoder().encode(JSON.stringify({ requestID: crypto.randomUUID() }))
          }
          const body = await readRecommendationBody(chunks(), budget.signal)
          await Bun.sleep(120)
          await expect(initializeRecommendation(body, budget)).rejects.toThrow("PREPARATION_TIMEOUT")
          expect(Database.use((db) => db.select().from(SessionTable).all())).toHaveLength(before)
        } finally {
          budget.dispose()
        }
      }),
    )
  }),
)

it.instance("expired preparation retains the armed guide and its submission opportunity", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
        const budget = createPreparation(undefined, 0)
        try {
          await expect(
            submitExpansion(
              {
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "城市",
                images: [],
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              },
              undefined,
              budget,
            ),
          ).rejects.toThrow("PREPARATION_TIMEOUT")
          expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("armed")
        } finally {
          budget.dispose()
        }
      }),
    )
  }),
)

it.instance("rolls back the session, category and messages if guide persistence fails", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const before = Database.use((db) => db.select().from(SessionTable).all()).length
        Database.use((db) =>
          db.run(
            sql.raw(
              "CREATE TEMP TRIGGER reject_recommendation_part BEFORE INSERT ON part BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END",
            ),
          ),
        )
        try {
          await expect(initializeRecommendation({ requestID: crypto.randomUUID() })).rejects.toThrow()
          expect(Database.use((db) => db.select().from(SessionTable).all())).toHaveLength(before)
        } finally {
          Database.use((db) => db.run(sql.raw("DROP TRIGGER reject_recommendation_part")))
        }
      }),
    )
  }),
)

it.instance("recovers orphan running state and rejects a delayed initialization with the old token", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const first = await initializeRecommendation({ requestID: crypto.randomUUID() })
        const row = Database.use((db) =>
          db
            .select()
            .from(PartTable)
            .where(eq(PartTable.id, PartID.make(first.guidePartID)))
            .get(),
        )!
        const resultPartID = PartID.ascending()
        const result: Omit<MessageV2.TextPart, "id" | "messageID" | "sessionID"> = {
          type: "text",
          text: "",
          metadata: {
            studioPromptExpansion: {
              version: 1,
              kind: "result",
              revision: 1,
              guidePartID: first.guidePartID,
              status: "running",
            },
          },
        }
        const previous = row.data as Omit<MessageV2.TextPart, "id" | "messageID" | "sessionID">
        const consumed = {
          ...previous,
          metadata: {
            ...previous.metadata,
            studioPromptRecommendation: {
              ...previous.metadata!.studioPromptRecommendation,
              revision: 2,
              status: "consumed",
              submission: {
                requestID: crypto.randomUUID(),
                digest: "test",
                userMessageID: first.guideMessageID,
                assistantMessageID: first.guideMessageID,
                resultPartID,
              },
            },
          },
        }
        Database.use((db) => {
          db.update(PartTable).set({ data: consumed }).where(eq(PartTable.id, row.id)).run()
          db.insert(PartTable)
            .values({
              id: resultPartID,
              session_id: row.session_id,
              message_id: row.message_id,
              time_created: Date.now(),
              time_updated: Date.now(),
              data: result,
            })
            .run()
        })
        const state = await getRecommendationState(first.sessionID)
        expect(state.recommendation?.status).toBe("failed")
        expect(state.recommendation?.resultRevision).toBe(2)
        await expect(
          initializeRecommendation({
            requestID: crypto.randomUUID(),
            sessionID: first.sessionID,
            expectedStateToken: first.stateToken,
          }),
        ).rejects.toThrow("RECOMMENDATION_STATE_CHANGED")
        const next = await initializeRecommendation({
          requestID: crypto.randomUUID(),
          sessionID: first.sessionID,
          expectedStateToken: state.stateToken,
        })
        expect(next.guidePartID).not.toBe(first.guidePartID)
        expect((await getRecommendationState(first.sessionID, first.guidePartID)).recommendation?.status).toBe("failed")
        expect(() => assertCanGenerate(first.sessionID)).toThrow("SESSION_BUSY")
      }),
    )
  }),
)

it.instance("atomically initializes a real session and replays the original blank-page request", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const request = { requestID: crypto.randomUUID() }
        const first = await initializeRecommendation(request)
        const second = await initializeRecommendation(request)
        expect(second).toEqual(first)
        expect(
          Database.use((db) =>
            db
              .select()
              .from(SessionTable)
              .where(eq(SessionTable.id, SessionID.make(first.sessionID)))
              .get(),
          )?.title,
        ).toBe("丰富提示词")
        expect(
          Database.use((db) =>
            db
              .select()
              .from(MessageTable)
              .where(eq(MessageTable.session_id, SessionID.make(first.sessionID)))
              .all(),
          ),
        ).toHaveLength(2)
        expect(
          Database.use((db) =>
            db
              .select()
              .from(PartTable)
              .where(eq(PartTable.session_id, SessionID.make(first.sessionID)))
              .all(),
          ),
        ).toHaveLength(2)
        expect(() => assertCanGenerate(first.sessionID)).toThrow("SESSION_BUSY")
        const duplicate = {
          requestID: crypto.randomUUID(),
          sessionID: first.sessionID,
          expectedStateToken: first.stateToken,
        }
        await expect(initializeRecommendation(duplicate)).rejects.toThrow("RECOMMENDATION_ALREADY_ACTIVE")
        await expect(
          initializeRecommendation({ ...request, sessionID: first.sessionID, expectedStateToken: first.stateToken }),
        ).rejects.toThrow("IDEMPOTENCY_CONFLICT")
      }),
    )
  }),
)

it.instance("rejects invalid input without consuming the armed guide", () =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    yield* Effect.promise(() =>
      Instance.restore(instance, async () => {
        const first = await initializeRecommendation({ requestID: crypto.randomUUID() })
        await expect(
          submitExpansion({
            requestID: crypto.randomUUID(),
            sessionID: first.sessionID,
            guidePartID: first.guidePartID,
            prompt: " ",
            availableModels: [],
          }),
        ).rejects.toThrow("INVALID_INPUT")
        const state = await getRecommendationState(first.sessionID, first.guidePartID)
        expect(state.recommendation?.status).toBe("armed")
        expect(state.stateToken).toBe(first.stateToken)
      }),
    )
  }),
)
