import { Log } from "@opencode-ai/core/util/log"
import { expect } from "bun:test"
import { Server } from "@/server/server"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { attach } from "@/effect/run-service"
import { selectExpansionModel } from "@/studio/prompt-expansion"
import { configureModelsApi } from "@/plugin/model-headers"
import { ModelID, ProviderID } from "@/provider/schema"
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
  dismissRecommendation,
} from "@/studio/prompt-recommendation"
import { assertCanGenerate } from "@/studio/prompt-recommendation-state"
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

it.live("expansion handles missing remote text declarations without changing the shared model catalog", () =>
  provideTmpdirServer(({ llm }) =>
    Effect.gen(function* () {
      yield* llm.reason("整理画面", { text: output })
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, async () => {
          const server = Bun.serve({
            port: 0,
            fetch: () =>
              Response.json({
                gateway: {
                  id: "gateway",
                  name: "Gateway",
                  api: llm.url,
                  npm: "@ai-sdk/openai-compatible",
                  models: {
                    text: { name: "Text" },
                    vision: { capabilities: { input: { text: true, image: true }, output: { text: true } } },
                    excludedInput: { modalities: { input: ["image"], output: ["text"] } },
                    excludedOutput: { modalities: { input: ["text"], output: ["image"] } },
                    explicitFalse: { capabilities: { input: { text: false }, output: { text: true } } },
                    explicitFalseOutput: { capabilities: { output: { text: false } } },
                  },
                },
              }),
          })
          configureModelsApi({ url: server.url.toString() })
          const active = ManagedRuntime.make(Layer.mergeAll(Provider.defaultLayer, Config.defaultLayer))
          try {
            const services = await active.runPromise(
              attach(
                Effect.gen(function* () {
                  return { provider: yield* Provider.Service, config: yield* Config.Service }
                }),
              ),
            )
            const select = (ids: string[], images: { path: string }[] = []) =>
              selectExpansionModel(
                {
                  availableModels: ids.map((modelID) => ({ providerID: "gateway", modelID })),
                  images,
                },
                undefined,
                undefined,
                services,
              )
            const selected = await select(["vision", "text"])
            expect(String(selected.id)).toBe("text")
            expect(selected.capabilities.input.text).toBe(true)
            expect(selected.capabilities.output.text).toBe(true)
            expect(selected.capabilities.input.image).toBe(false)
            expect(String((await select(["text", "vision"], [{ path: "reference.png" }])).id)).toBe("vision")
            await expect(select(["text"], [{ path: "reference.png" }])).rejects.toThrow("NO_ELIGIBLE_MODEL")
            await expect(
              select(["excludedInput", "excludedOutput", "explicitFalse", "explicitFalseOutput"]),
            ).rejects.toThrow("NO_ELIGIBLE_MODEL")
            const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
            await submitExpansion(
              {
                requestID: crypto.randomUUID(),
                sessionID: initialized.sessionID,
                guidePartID: initialized.guidePartID,
                prompt: "雨后的城市",
                availableModels: [{ providerID: "gateway", modelID: "text" }],
              },
              services,
            )
            const deadline = Date.now() + 10_000
            while (Date.now() < deadline) {
              if ((await getRecommendationState(initialized.sessionID)).recommendation?.status !== "running") break
              await Bun.sleep(10)
            }
            expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("completed")
            const shared = await active.runPromise(
              attach(services.provider.getModel(ProviderID.make("gateway"), ModelID.make("text"))),
            )
            expect(shared.capabilities.input.text).toBe(false)
            expect(shared.capabilities.output.text).toBe(false)
          } finally {
            await active.dispose()
            configureModelsApi({ source: "local" })
            await server.stop(true)
          }
        }),
      )
    }),
  ),
)

it.live("selects expansion models by input before session preference", () =>
  provideTmpdirServer(
    () =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        yield* Effect.promise(() =>
          Instance.restore(instance, async () => {
            const text = { providerID: "test", modelID: "text" }
            const other = { providerID: "test", modelID: "other" }
            const vision = { providerID: "test", modelID: "test-model" }
            const missing = { providerID: "test", modelID: "missing" }
            const unsupported = { providerID: "test", modelID: "unsupported" }
            const selected = (
              availableModels: (typeof text)[],
              images: { path: string }[] = [],
              current?: typeof text,
            ) =>
              selectExpansionModel(
                { availableModels, images },
                current && { providerID: current.providerID, id: current.modelID },
              )
            expect(String((await selected([vision, text], [], vision)).id)).toBe("text")
            expect(String((await selected([vision, text, other], [], other)).id)).toBe("other")
            expect(String((await selected([vision])).id)).toBe("test-model")
            expect(String((await selected([text])).id)).toBe("text")
            expect(String((await selected([text, vision], [{ path: "reference.png" }], text)).id)).toBe("test-model")
            await expect(selected([text], [{ path: "reference.png" }])).rejects.toThrow("NO_ELIGIBLE_MODEL")
            await expect(selected([missing, unsupported])).rejects.toThrow("NO_ELIGIBLE_MODEL")
            await expect(selected([])).rejects.toThrow("NO_ELIGIBLE_MODEL")
            await expect(selected([], [{ path: "reference.png" }])).rejects.toThrow("NO_ELIGIBLE_MODEL")
          }),
        )
      }),
    {
      config: (url) => ({
        provider: {
          test: {
            ...config(url).provider.test,
            models: {
              ...config(url).provider.test.models,
              text: { name: "Text", modalities: { input: ["text"], output: ["text"] } },
              other: { name: "Other", modalities: { input: ["text"], output: ["text"] } },
              unsupported: { name: "Unsupported", modalities: { input: ["text"], output: ["image"] } },
            },
          },
        },
      }),
    },
  ),
)

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
          yield* llm.reason("先分析用户画面", { text: JSON.stringify({ expandedPrompt: "", tags: [] }) })
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
              expect(previews.filter((row) => (row.data as MessageV2.TextPart).text)).toHaveLength(2)
              expect(previews.map((row) => row.data)).toEqual(expect.arrayContaining([
                expect.objectContaining({ text: JSON.stringify({ expandedPrompt: "", tags: [] }), time: expect.objectContaining({ end: expect.any(Number) }) }),
                expect.objectContaining({ text: output, time: expect.objectContaining({ end: expect.any(Number) }) }),
              ]))
              expect(Database.use((db) => db.select().from(PartTable)
                .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
                .filter((row) => row.data.type === "reasoning").map((row) => row.data)).toEqual(expect.arrayContaining([
                  expect.objectContaining({ text: "先分析用户画面", time: expect.objectContaining({ end: expect.any(Number) }) }),
                  expect.objectContaining({ text: "重新整理画面", time: expect.objectContaining({ end: expect.any(Number) }) }),
                ]))
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
        if (event.properties.sessionID === initialized.sessionID && event.properties.delta === '{"expandedPrompt":"正在生成城市')
          streamed.resolve()
      })
      try {
        const accepted = await submitExpansion({
          requestID: crypto.randomUUID(), sessionID: initialized.sessionID, guidePartID: initialized.guidePartID,
          prompt: "城市雨景", availableModels: [{ providerID: "test", modelID: "test-model" }],
        })
        await Promise.race([streamed.promise, Bun.sleep(5000).then(() => { throw new Error("No preview delta received") })])
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("running")
        expect(dismissRecommendation(initialized.sessionID, initialized.guidePartID).status).toBe("running")
        expect(() => assertCanGenerate(initialized.sessionID)).toThrow("SESSION_BUSY")
        await cancelExpansion(initialized.sessionID, accepted.assistantMessageID!)
        const deadline = Date.now() + 5000
        while (Date.now() < deadline && (await getRecommendationState(initialized.sessionID)).recommendation?.status !== "cancelled")
          await Bun.sleep(10)
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("cancelled")
        const parts = Database.use((db) => db.select().from(PartTable)
          .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
        expect(parts.filter((row) => row.data.type === "text" && (row.data as MessageV2.TextPart).metadata?.studioPromptExpansionPreview).map((row) => row.data)).toEqual([
          expect.objectContaining({ text: '{"expandedPrompt":"正在生成城市', time: expect.objectContaining({ end: expect.any(Number) }) }),
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


for (const scenario of [
  { name: "nested JSON", text: JSON.stringify({ expandedPrompt: JSON.parse(output) }), feedback: "正文不是字符串，仍使用了对象或数组包装" },
  { name: "unusable tagged candidates", text: "<expandedPrompt></expandedPrompt><expandedPrompt>。</expandedPrompt>", feedback: "没有可用正文" },
].flatMap((scenario) => [true, false].map((repaired) => ({ ...scenario, repaired })))) {
  const repaired = scenario.repaired
  it.live(`${scenario.name} receives concrete repair context and ${repaired ? "completes" : "fails after one repair"}`, () =>
    provideTmpdirServer(({ llm }) => Effect.gen(function* () {
      const requestID = crypto.randomUUID()
      const nested = scenario.text
      yield* llm.text(nested)
      yield* llm.text(repaired ? "<expandedPrompt>雨后城市的霓虹街景。</expandedPrompt><tags>场景：城市</tags><tags>天气：雨后</tags><tags>光线：霓虹</tags>" : nested)
      const instance = yield* InstanceState.context
      yield* Effect.promise(() => Instance.restore(instance, async () => {
        const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
        await submitExpansion({
          requestID, sessionID: initialized.sessionID, guidePartID: initialized.guidePartID,
          prompt: "雨景", availableModels: [{ providerID: "test", modelID: "test-model" }],
        })
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline && (await getRecommendationState(initialized.sessionID)).recommendation?.status === "running")
          await Bun.sleep(10)
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe(repaired ? "completed" : "failed")
      }))
      const deadline = Date.now() + 2000
      const outcome = `"outcome":"${repaired ? "accepted" : "rejected"}"`
      while (Date.now() < deadline && !(yield* Effect.promise(() => Bun.file(Log.file()).text())).split("\n").some((line) => line.includes(requestID) && line.includes(outcome)))
        yield* Effect.promise(() => Bun.sleep(5))
      const records = (yield* Effect.promise(() => Bun.file(Log.file()).text())).split("\n").filter((line) => line.includes(requestID) && line.includes("entry="))
      expect(records).toHaveLength(2)
      expect(records[0]).toContain('"attempt":1,"outcome":"repairing"')
      expect(records[0]).toContain(`"rawText":${JSON.stringify(nested)}`)
      expect(records[0]).toContain('"feedback":')
      expect(records[1]).toContain(outcome)
      expect(records[1]).toContain('"attempt":2')
      if (scenario.name === "unusable tagged candidates") {
        expect(records[0]).toContain('"candidateCount":2')
        expect(records[0]).toContain('"reason":"empty"')
        expect(records[0]).toContain('"reason":"punctuation_only"')
        expect(records[0]).toContain('"selectionReason":"no_valid_candidate"')
      }
      if (repaired) expect(records[1]).toContain('"result":{"expandedPrompt":"雨后城市的霓虹街景。"')
      const inputs = yield* llm.inputs
      expect(inputs).toHaveLength(2)
      expect(JSON.stringify(inputs[0])).toContain("将中文扩写正文放在 <expandedPrompt> 与 </expandedPrompt> 之间")
      expect(JSON.stringify(inputs[1])).toContain("每对同级 <tags>")
      expect(inputs[1]).toMatchObject({ messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: nested }),
        expect.objectContaining({ role: "user", content: expect.stringContaining(scenario.feedback) }),
      ]) })
    }), { config }), 30_000)
}


for (const sample of [
  { text: "雨后的城市街道。", tags: [] },
  { text: 'Analysis: use `<expandedPrompt>` followed by `<tags>`. Draft: <expandedPrompt>错误草稿</expandedPrompt>\n</think>\n<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags>', tags: ["天气：雨后"] },
  { text: '说明：`<tags>`\n```xml\n<tags>未闭合示例\n```\n<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags>', tags: ["天气：雨后"] },
  { text: '说明：<tags>未闭合示例\n<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags>', tags: ["天气：雨后"] },
  { text: "<expandedPrompt>旧版</expandedPrompt><tags>风格：旧版</tags><expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags>", tags: ["天气：雨后"] },
  { text: "<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags><expandedPrompt></expandedPrompt><expandedPrompt>。</expandedPrompt>", tags: ["天气：雨后"] },
  { text: "<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags><expandedPrompt>坏<unknown>结构</expandedPrompt>", tags: ["天气：雨后"] },
  { text: "<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>天气：雨后</tags><expandedPrompt>后面的未闭合正文", tags: ["天气：雨后"] },
  { text: "<expandedPrompt>expandedPrompt>雨后的城市街道。 expandedPrompt></expandedPrompt><tags>场景：城市</tags><tags>场景：街道</tags><tags>主体：少女主体：少女</tags><tags>天气：雨后</tags>", tags: ["场景：城市", "天气：雨后"] },
  { text: "<expandedPrompt><expandedPrompt>雨后的城市街道。</expandedPrompt></expandedPrompt><tags><tags>场景：城市</tags></tags><tags>天气：雨后</tags><tags>坏：未完成", tags: ["天气：雨后"] },
  { text: "<expandedPrompt>expandedPrompt>雨后的城市街道。<expandedPrompt></expandedPrompt>", tags: [] },
  { text: "<expandedPrompt>雨后的城市街道。", tags: [] },
  { text: "<expandedPrompt>雨后的城市街道。</expandedPrompt><tags", tags: [] },
  { text: "<expandedPrompt>雨后的城市街道。</expandedPrompt><tags>无效标签\n风格：科幻:未来", tags: [] },
  { text: "<expandedPrompt>雨后的城市街道。<tags>- 场景 : 城市\n场景：街道\n天气：雨后</tags>", tags: ["场景：城市", "天气：雨后"] },
]) {
  it.live(`persists usable body without repair when normalized tag count is ${sample.tags.length}: ${sample.text}`, () =>
    provideTmpdirServer(({ llm }) => Effect.gen(function* () {
      yield* llm.text(sample.text)
      const instance = yield* InstanceState.context
      yield* Effect.promise(() => Instance.restore(instance, async () => {
        const initialized = await initializeRecommendation({ requestID: crypto.randomUUID() })
        await submitExpansion({
          requestID: crypto.randomUUID(), sessionID: initialized.sessionID, guidePartID: initialized.guidePartID,
          prompt: "雨景", availableModels: [{ providerID: "test", modelID: "test-model" }],
        })
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline && (await getRecommendationState(initialized.sessionID)).recommendation?.status === "running")
          await Bun.sleep(10)
        expect((await getRecommendationState(initialized.sessionID)).recommendation?.status).toBe("completed")
        const result = Database.use((db) => db.select().from(PartTable)
          .where(eq(PartTable.session_id, SessionID.make(initialized.sessionID))).all())
          .map((row) => row.data).find((part) => part.type === "text" && (part as MessageV2.TextPart).metadata?.studioPromptExpansion)
        expect(result).toMatchObject({ type: "text", text: "雨后的城市街道。", metadata: {
          studioPromptExpansion: { status: "completed", tags: sample.tags },
        } })
      }))
      expect(yield* llm.calls).toBe(1)
    }), { config }), 30_000)
}
