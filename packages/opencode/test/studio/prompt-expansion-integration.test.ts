import { expect } from "bun:test"
import { Server } from "@/server/server"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { attach } from "@/effect/run-service"
import { selectExpansionModel } from "@/studio/prompt-expansion"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { MessageV2 } from "@/session/message-v2"
import {
  initializeRecommendation,
  submitExpansion,
  getRecommendationState,
  cancelExpansion,
} from "@/studio/prompt-recommendation"
import { Database, eq } from "@/storage/db"
import { PartTable, SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { provideTmpdirServer } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, CrossSpawnSpawner.defaultLayer))
const config = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "test-key", baseURL: url },
      models: {
        "test-model": {
          name: "Test",
          modalities: { input: ["text" as const, "image" as const], output: ["text" as const] },
          limit: { context: 100000, output: 10000 },
        },
      },
    },
  },
})
async function uploadImage(sessionID: string, filename: string, content: string) {
  const response = await Server.Legacy().app.request("http://localhost/artifact/upload", {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-directory": encodeURIComponent(Instance.directory) },
    body: JSON.stringify({ sessionId: sessionID, filename, content }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { path: string }
}

const output = JSON.stringify({
  expandedPrompt: "雨后城市的霓虹街景。",
  tags: ["场景：城市", "天气：雨后", "光线：霓虹"],
})

it.live(
  "selects with the HTTP services when an older standalone runtime has stale model capabilities",
  () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const input = {
                sessionID: "session",
                guidePartID: "guide",
                requestID: crypto.randomUUID(),
                prompt: "城市",
                images: [{ path: "/uploaded/image.png" }],
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              }
              await expect(selectExpansionModel(input)).rejects.toThrow("NO_ELIGIBLE_MODEL")
              await Bun.write(`${dir}/opencode.json`, JSON.stringify(config(llm.url)))
              const active = ManagedRuntime.make(Layer.mergeAll(Provider.defaultLayer, Config.defaultLayer))
              try {
                const services = await active.runPromise(
                  attach(
                    Effect.gen(function* () {
                      return { provider: yield* Provider.Service, config: yield* Config.Service }
                    }),
                  ),
                )
                const selected = await selectExpansionModel(input, undefined, undefined, services)
                expect(String(selected.id)).toBe("test-model")
                expect(selected.capabilities.input.image).toBe(true)
                await expect(selectExpansionModel(input)).rejects.toThrow("NO_ELIGIBLE_MODEL")
              } finally {
                await active.dispose()
              }
            }),
          )
        }),
      {
        config: (url) => {
          const initial = config(url)
          initial.provider.test.models["test-model"].modalities.input = ["text"]
          return initial
        },
      },
    ),
  30_000,
)

it.live(
  "repairs malformed output once with the same model",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          yield* llm.reason("先分析用户画面", { text: JSON.stringify({ expandedPrompt: "首轮未通过校验", tags: [] }) })
          yield* llm.reason("重新整理画面", { text: output })
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
              await submitExpansion({
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "雨景",
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              })
              const deadline = Date.now() + 10_000
              while (Date.now() < deadline) {
                const state = await getRecommendationState(initialized.sessionID)
                if (state.recommendation?.status !== "running") break
                await Bun.sleep(10)
              }
              expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("completed")
              const previews = Database.use((db) => db.select().from(PartTable)
                .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
                .filter((row) => row.data.type === "text" && (row.data as MessageV2.TextPart).metadata?.studioPromptExpansionPreview)
              expect(previews).toHaveLength(2)
              expect(previews.map((row) => row.data)).toEqual(expect.arrayContaining([
                expect.objectContaining({ text: "首轮未通过校验", time: expect.objectContaining({ end: expect.any(Number) }) }),
                expect.objectContaining({ text: "雨后城市的霓虹街景。", time: expect.objectContaining({ end: expect.any(Number) }) }),
              ]))
              expect(Database.use((db) => db.select().from(PartTable)
                .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
                .some((row) => row.data.type === "reasoning")).toBe(false)
            }),
          )
          expect(yield* llm.calls).toBe(2)
        }),
      { config },
    ),
  30_000,
)

it.live("previews text without reasoning and persists it on cancellation", () =>
  provideTmpdirServer(({ llm }) => Effect.gen(function* () {
    yield* llm.push({
      type: "sse",
      head: [{ id: "test", object: "chat.completion.chunk", choices: [{ delta: { content: '{"expandedPrompt":"正在生成城市' } }] }],
      tail: [],
      hang: true,
    })
    const instance = yield* InstanceState.context
    yield* Effect.promise(() => Instance.restore(instance, async () => {
      const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
      const streamed = Promise.withResolvers<void>()
      const unsubscribe = Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
        if (event.properties.sessionID === initialized.sessionID && event.properties.delta === "正在生成城市")
          streamed.resolve()
      })
      try {
        const accepted = await submitExpansion({
          requestID: crypto.randomUUID(), sessionID: initialized.sessionID, guidePartID: initialized.guidePartID,
          prompt: "城市雨景", availableModels: [{ providerID: "test", modelID: "test-model" }],
        })
        await Promise.race([streamed.promise, Bun.sleep(5000).then(() => { throw new Error("No preview delta received") })])
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("running")
        await cancelExpansion(initialized.sessionID, accepted.assistantMessageID!)
        const deadline = Date.now() + 5000
        while (Date.now() < deadline && (await getRecommendationState(initialized.sessionID)).recommendation?.status !== "cancelled")
          await Bun.sleep(10)
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("cancelled")
        const parts = Database.use((db) => db.select().from(PartTable)
          .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
        expect(parts.filter((row) => row.data.type === "text" && (row.data as MessageV2.TextPart).metadata?.studioPromptExpansionPreview).map((row) => row.data)).toEqual([
          expect.objectContaining({ text: "正在生成城市", time: expect.objectContaining({ end: expect.any(Number) }) }),
        ])
      } finally {
        unsubscribe()
      }
    }))
  }), { config }), 30_000)

it.live(
  "accepts once, persists a full LLM result, and leaves the session model unchanged",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          yield* llm.text(output)
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
              const image = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=",
                "base64",
              )
              const request = {
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "城市雨景",
                images: [await uploadImage(initialized.sessionID, "reference.png", image.toString("base64"))],
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              }
              const accepted = await submitExpansion(request)
              expect((await submitExpansion(request)).assistantMessageID).toBe(accepted.assistantMessageID)
              const deadline = Date.now() + 10_000
              while (Date.now() < deadline) {
                const state = await getRecommendationState(initialized.sessionID)
                if (state.recommendation?.status === "completed" || state.recommendation?.status === "failed") break
                await Bun.sleep(10)
              }
              const state = await getRecommendationState(initialized.sessionID)
              expect(state.recommendation?.status).toBe("completed")
              expect(
                Database.use((db) =>
                  db
                    .select()
                    .from(SessionTable)
                    .where(eq(SessionTable.id, SessionID.make(initialized.sessionID)))
                    .get(),
                )?.model,
              ).toBeNull()
              const parts = Database.use((db) =>
                db
                  .select()
                  .from(PartTable)
                  .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID)))
                  .all(),
              )
              expect(
                parts.some(
                  (part) =>
                    part.data.type === "text" && "text" in part.data && part.data.text === "雨后城市的霓虹街景。",
                ),
              ).toBe(true)
            }),
          )
          expect(yield* llm.calls).toBe(1)
          expect(JSON.stringify((yield* llm.inputs)[0])).toContain("image_url")
        }),
      { config },
    ),
  30_000,
)

it.live(
  "normalizes mismatched image declarations for attachments and LLM input while preserving replay",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          yield* llm.text(output)
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
              const sources = [
                { mime: "image/png", base64: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA" },
                {
                  mime: "image/jpeg",
                  base64:
                    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=",
                },
              ]
              const images = await Promise.all(
                sources.map((image, index) =>
                  uploadImage(initialized.sessionID, `reference-${index}.png`, image.base64),
                ),
              )
              const request = {
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "城市雨景",
                images,
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              }
              const accepted = await submitExpansion(request)
              expect((await submitExpansion(request)).assistantMessageID).toBe(accepted.assistantMessageID)
              expect(sources.map((image) => image.mime)).toEqual(["image/png", "image/jpeg"])
              const deadline = Date.now() + 10_000
              while (Date.now() < deadline) {
                if ((await getRecommendationState(initialized.sessionID)).recommendation?.status !== "running") break
                await Bun.sleep(10)
              }
              expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("completed")
              const files = Database.use((db) =>
                db
                  .select()
                  .from(PartTable)
                  .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID)))
                  .all(),
              ).flatMap((part) =>
                part.data.type === "file" &&
                "url" in part.data &&
                typeof part.data.url === "string" &&
                "mime" in part.data &&
                typeof part.data.mime === "string"
                  ? [{ url: part.data.url, mime: part.data.mime }]
                  : [],
              )
              expect(files.map((file) => file.mime).sort()).toEqual(["image/png", "image/webp"])
              await Promise.all(
                files.map(async (file) => {
                  expect(file.url.startsWith(`${instance.directory}/.octo/${initialized.sessionID}/uploads/`)).toBe(
                    true,
                  )
                  expect(await Bun.file(file.url).exists()).toBe(true)
                }),
              )
            }),
          )
          expect(yield* llm.calls).toBe(1)
          const sent = JSON.stringify((yield* llm.inputs)[0])
          expect(sent).toContain("data:image/webp;base64,UklGR")
          expect(sent).toContain("data:image/png;base64,iVBOR")
          expect(sent).not.toContain("data:image/jpeg;base64,")
        }),
      { config },
    ),
  30_000,
)

it.live(
  "rejects unknown and unsupported image contents without consuming the recommendation",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
              for (const base64 of [
                Buffer.from("not an image").toString("base64"),
                "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              ]) {
                await expect(
                  submitExpansion({
                    requestID: crypto.randomUUID(),
                    sessionID: initialized.sessionID,
                    guidePartID: initialized.guidePartID,
                    prompt: "城市",
                    images: [await uploadImage(initialized.sessionID, `invalid-${crypto.randomUUID()}.png`, base64)],
                    availableModels: [{ providerID: "test", modelID: "test-model" }],
                  }),
                ).rejects.toThrow("INVALID_INPUT")
                expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("armed")
              }
            }),
          )
          expect(yield* llm.calls).toBe(0)
        }),
      { config },
    ),
  30_000,
)

it.live(
  "explicit cancellation aborts a hanging LLM stream and consumes the opportunity",
  () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          yield* llm.hang
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
              const accepted = await submitExpansion({
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "城市雨景",
                images: [],
                availableModels: [{ providerID: "test", modelID: "test-model" }],
              })
              await Effect.runPromise(llm.wait(1))
              await cancelExpansion(initialized.sessionID, accepted.assistantMessageID!)
              const deadline = Date.now() + 5000
              while (
                Date.now() < deadline &&
                (await getRecommendationState(initialized.sessionID)).recommendation?.status !== "cancelled"
              )
                await Bun.sleep(10)
              expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("cancelled")
              expect((await cancelExpansion(initialized.sessionID, accepted.assistantMessageID!)).status).toBe(
                "cancelled",
              )
            }),
          )
        }),
      { config },
    ),
  30_000,
)
