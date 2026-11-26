import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { emptyBoard, newBoardCard } from "@opencode-ai/core/studio-board"
import { InstanceState } from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { SessionID } from "@/session/schema"
import { PartTable, SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { saveBoard, getBoard } from "@/studio/studio-board-service"
import { createGeneration, getGeneration } from "@/studio/studio-service"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, CrossSpawnSpawner.defaultLayer))

for (const kind of ["image", "video"] as const) {
  it.live(`summarizes a board ${kind} title without rewriting the submitted prompt`, () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          yield* llm.text(JSON.stringify({ title: "雨后湖畔白鹭" }))
          const instance = yield* InstanceState.context
          yield* Effect.promise(() =>
            Instance.restore(instance, async () => {
              const requests: { args: { prompt: string } }[] = []
              using upstream = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                async fetch(request) {
                  if (new URL(request.url).pathname === "/create") {
                    requests.push((await request.json()) as (typeof requests)[number])
                    return Response.json({ resp_code: 200, task_id: "board-title-task" })
                  }
                  return Response.json({ resp_code: 200, result: { status: 1, progress: 20 } })
                },
              })
              const values = {
                IMAGE_CREATE_TASK_URL: new URL("/create", upstream.url).href,
                IMAGE_QUERY_TASK_BASE_URL: new URL("/query/", upstream.url).href,
                IMAGE_GET_HISTORY_URL: new URL("/history", upstream.url).href,
              }
              const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
              using environment = {
                [Symbol.dispose]() {
                  Object.entries(previous).forEach(([key, value]) => {
                    if (value === undefined) {
                      delete process.env[key]
                      return
                    }
                    process.env[key] = value
                  })
                },
              }
              Object.entries(values).forEach(([key, value]) => {
                process.env[key] = value
              })
              const sessionID = SessionID.descending()
              Database.use((db) =>
                db
                  .insert(SessionTable)
                  .values({
                    id: sessionID,
                    project_id: Instance.project.id,
                    slug: sessionID,
                    directory: Instance.directory,
                    title: "画布标题测试",
                    version: "test",
                    agent: "octo_studio",
                    studio_mode: "board",
                    time_created: Date.now(),
                    time_updated: Date.now(),
                  })
                  .run(),
              )
              const card = newBoardCard("title-card", kind)
              card.draft.prompt = "雨后清晨的湖畔，一只白鹭掠过水面，远处有薄雾与群山"
              saveBoard(sessionID, 0, { ...emptyBoard(), cards: [card] })
              const accepted = await createGeneration({
                sessionID,
                capability: kind === "image" ? "image.generate" : "video.generate",
                prompt: card.draft.prompt,
                promptRefineModels: [{ providerID: "test", modelID: "test-model" }],
                extra: { userIdx: "board-title-test" },
                board: {
                  cardID: card.id,
                  submissionID: crypto.randomUUID(),
                  revision: 1,
                  snapshot: { prompt: card.draft.prompt, settings: card.draft.settings, references: [] },
                },
              })
              const deadline = Date.now() + 10_000
              while (Date.now() < deadline && (await getGeneration(accepted.id)).detailTitle !== "雨后湖畔白鹭") {
                await Bun.sleep(10)
              }
              expect((await getGeneration(accepted.id)).detailTitle).toBe("雨后湖畔白鹭")
              expect((await getGeneration(accepted.id)).prompt).toBe(card.draft.prompt)
              expect(requests).toHaveLength(1)
              expect(requests[0].args.prompt).toBe(card.draft.prompt)
              expect(getBoard(sessionID).document.cards[0].taskLinks[0].snapshot.prompt).toBe(card.draft.prompt)
              expect(
                Database.use((db) => db.select().from(PartTable).where(eq(PartTable.session_id, sessionID)).all()).find(
                  (part) => part.data.type === "tool",
                )?.data,
              ).toMatchObject({ state: { input: { detailTitle: "雨后湖畔白鹭" } } })
            }),
          )
          const hits = yield* llm.hits
          expect(hits).toHaveLength(1)
          expect(JSON.stringify(hits[0].body)).toContain("标题精炼助手")
          expect(JSON.stringify(hits[0].body)).toContain("雨后清晨的湖畔")
        }),
      {
        config: (url) => ({
          enabled_providers: ["test"],
          provider: {
            test: {
              name: "Test",
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "test-key", baseURL: url },
              models: { "test-model": { name: "Test", limit: { context: 100000, output: 10000 } } },
            },
          },
        }),
      },
    ),
  )
}
