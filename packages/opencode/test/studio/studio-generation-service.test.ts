import { describe, expect, test } from "bun:test"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioHistoryTable } from "@/studio/studio-history.sql"
import { materializeStudioGeneration } from "@/studio/studio-history-service"
import { getGeneration } from "../../src/studio/studio-service"
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

  // 会话仍存在时 getGeneration 走 generation 快照路径：result 里只有 provider 原始 model，
  // 资产详情面板需要 styleModel 才能展示与生成时所选风格模型一致的名称（如「小艺agent」）。
  describe("styleModel on live generation records", () => {
    async function insertLiveGeneration(id: string, capability: "image.generate" | "image.upscale", styleModel?: string) {
      const now = Date.now()
      const sessionID = SessionID.descending()
      Database.use((db) =>
        db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Instance.project.id,
            slug: sessionID,
            directory: Instance.directory,
            title: "Studio generation styleModel test",
            version: "test",
            agent: "octo_studio",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
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
            capability,
            status: "succeeded",
            progress: 100,
            request: {
              input: {
                capability,
                prompt: "一只猫在奔跑",
                styleModel,
                aspectRatio: "3:4",
                count: 1,
                imageTool: "internel",
                referenceImages: [],
              },
            },
            result: {
              id,
              status: "succeeded",
              capability,
              prompt: "一只猫在奔跑",
              provider: "internel",
              model: "internel_raw_model",
              aspectRatio: "3:4",
              images: [{ id: `${id}-0`, kind: "image", url: "https://example.com/image.png" }],
            },
            next_poll_at: Number.MAX_SAFE_INTEGER,
            completed_at: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      return sessionID
    }

    test("returns request styleModel so history detail shows the selected style model", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const sessionID = await insertLiveGeneration("gen-style-model-live", "image.generate", "xiaoyi")
          try {
            const result = await getGeneration("gen-style-model-live")
            expect(result.model).toBe("internel_raw_model")
            expect(result.styleModel).toBe("xiaoyi")
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-style-model-live")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            })
          }
        },
      })
    })

    // 编辑类能力（变清晰/抠图/重绘/扩图）与工具输入同口径不携带 styleModel。
    test("omits styleModel for editor capabilities", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const sessionID = await insertLiveGeneration("gen-style-model-editor", "image.upscale", "xiaoyi")
          try {
            const result = await getGeneration("gen-style-model-editor")
            expect(result.styleModel).toBeUndefined()
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-style-model-editor")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            })
          }
        },
      })
    })
  })
})
