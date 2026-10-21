import { describe, expect, test } from "bun:test"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioHistoryTable } from "@/studio/studio-history.sql"
import { materializeStudioGeneration } from "@/studio/studio-history-service"
import { getGeneration, promptExpansionMessageMetadata } from "../../src/studio/studio-service"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

// 历史视频记录曾把 provider 的 "std"/"pro" 模式写进 videoQualityMode，
// 它与响应 schema 的 480/720/1080/4k 不兼容，会让 GET /studio/generations/:id 整个 400，
// 历史资产详情面板因此永远 loading。这里锁住读取时的归一化行为。
describe("Studio generation service", () => {
  test("normalizes legacy videoQualityMode when reading a generation", async () => {
    await using directory = await tmpdir()
    await provideTestInstance({
      directory: directory.path,
      fn: async () => {
        const now = Date.now()
        const sessionID = SessionID.descending()
        const id = "gen-video-legacy"
        Database.use((db) =>
          db
            .insert(SessionTable)
            .values({
              id: sessionID,
              project_id: Instance.project.id,
              slug: sessionID,
              directory: Instance.directory,
              title: "Studio generation test",
              version: "test",
              agent: "octo_studio",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        try {
          Database.use((db) =>
            db
              .insert(StudioGenerationTable)
              .values({
                id,
                session_id: sessionID,
                directory: Instance.directory,
                assistant_message_id: MessageID.ascending(),
                tool_part_id: PartID.ascending(),
                provider: "internel",
                capability: "video.generate",
                status: "succeeded",
                progress: 100,
                request: {
                  input: {
                    capability: "video.generate",
                    prompt: "一只猫在奔跑",
                    detailPrompt: "一只猫在奔跑",
                    detailTitle: "奔跑的猫",
                    styleModel: "t2v_seedance",
                    aspectRatio: "16:9",
                    count: 1,
                    imageTool: "internel",
                    referenceImages: [],
                    extra: { resolution: "480p", mode: "std" },
                  },
                },
                result: {
                  id,
                  status: "succeeded",
                  capability: "video.generate",
                  prompt: "一只猫在奔跑",
                  provider: "internel",
                  model: "t2v_seedance",
                  aspectRatio: "16:9",
                  videoMode: "text",
                  duration: "4",
                  // 旧格式：provider 模式而非分辨率
                  videoQualityMode: "std",
                  images: [{ id: `${id}-0`, kind: "video", url: "https://example.com/video.mp4" }],
                },
                next_poll_at: Number.MAX_SAFE_INTEGER,
                completed_at: now,
                time_created: now,
                time_updated: now,
              })
              .run(),
          )

          const result = await getGeneration(id)
          expect(result.videoQualityMode).toBe("480")
          expect(result.videoMode).toBe("text")
          expect(result.duration).toBe("4")
          expect(result.detailTitle).toBe("奔跑的猫")

          Database.use((db) => db.update(StudioGenerationTable)
            .set({
              request: { input: { capability: "video.generate", prompt: "一只猫在奔跑" } },
              result: { ...result, videoQualityMode: "1080" },
            })
            .where(eq(StudioGenerationTable.id, id)).run())
          expect((await getGeneration(id)).videoQualityMode).toBe("1080")

          Database.use((db) => db.update(StudioGenerationTable)
            .set({ result: { ...result, videoQualityMode: "pro" } })
            .where(eq(StudioGenerationTable.id, id)).run())
          // 旧 provider 的 pro 档按产品口径归一化为 720P。
          expect((await getGeneration(id)).videoQualityMode).toBe("720")
        } finally {
          Database.use((db) => {
            db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, id)).run()
            db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
          })
        }
      },
    })
  })

  // 会话删除级联清理 studio_generation 后，getGeneration 回退到历史表快照。
  // 快照里存的旧 std/pro 档位按产品口径归一化：std→480P、pro→720P。
  test("history snapshot fallback normalizes legacy videoQualityMode and keeps text fields", async () => {
    await using directory = await tmpdir()
    await provideTestInstance({
      directory: directory.path,
      fn: async () => {
        const now = Date.now()
        const sessionID = SessionID.descending()
        const id = "gen-video-snapshot-legacy"
        Database.use((db) =>
          db
            .insert(SessionTable)
            .values({
              id: sessionID,
              project_id: Instance.project.id,
              slug: sessionID,
              directory: Instance.directory,
              title: "Studio generation snapshot test",
              version: "test",
              agent: "octo_studio",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        try {
          Database.use((db) =>
            db
              .insert(StudioGenerationTable)
              .values({
                id,
                session_id: sessionID,
                directory: Instance.directory,
                assistant_message_id: MessageID.ascending(),
                tool_part_id: PartID.ascending(),
                provider: "internel",
                capability: "video.generate",
                status: "succeeded",
                progress: 100,
                request: {
                  input: {
                    capability: "video.generate",
                    prompt: "一只猫在奔跑",
                    detailTitle: "奔跑的猫",
                    styleModel: "t2v_seedance",
                    aspectRatio: "16:9",
                    extra: { resolution: "720p" },
                  },
                },
                result: {
                  id,
                  status: "succeeded",
                  capability: "video.generate",
                  aspectRatio: "16:9",
                  videoMode: "text",
                  videoQualityMode: "std",
                  images: [{ id: `${id}-0`, kind: "video", url: "https://example.com/video.mp4" }],
                },
                next_poll_at: Number.MAX_SAFE_INTEGER,
                completed_at: now,
                time_created: now,
                time_updated: now,
              })
              .run(),
          )
          materializeStudioGeneration(Instance.directory, id)
          // 会话删除后 generation 行被级联清理，只剩历史快照。
          Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, id)).run())

          const snapshot = await getGeneration(id)
          expect(snapshot.status).toBe("succeeded")
          expect(snapshot.prompt).toBe("一只猫在奔跑")
          expect(snapshot.detailTitle).toBe("奔跑的猫")
          expect(snapshot.styleModel).toBe("t2v_seedance")
          expect(snapshot.videoMode).toBe("text")
          expect(snapshot.videoQualityMode).toBe("480")
          expect(snapshot.images[0]?.url).toBe("https://example.com/video.mp4")
        } finally {
          Database.use((db) => {
            db.delete(StudioHistoryTable).where(eq(StudioHistoryTable.generation_id, id)).run()
            db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
          })
        }
      },
    })
  })
})


test("button generation persists expansion origin in the user text metadata", () => {
  expect(promptExpansionMessageMetadata({
    skipPromptRefine: true,
    promptExpansionSource: { assistantMessageID: "expansion-assistant" },
  })).toEqual({ studioPromptExpansionSource: { assistantMessageID: "expansion-assistant" } })
  expect(promptExpansionMessageMetadata({ skipPromptRefine: true })).toBeUndefined()
  expect(promptExpansionMessageMetadata(undefined)).toBeUndefined()
  expect(promptExpansionMessageMetadata({ promptExpansionSource: { assistantMessageID: " " } })).toBeUndefined()
  expect(promptExpansionMessageMetadata({ promptExpansionSource: "invalid" })).toBeUndefined()
})
