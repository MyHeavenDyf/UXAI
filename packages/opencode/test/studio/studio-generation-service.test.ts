import { describe, expect, test } from "bun:test"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioHistoryTable } from "@/studio/studio-history.sql"
import { materializeStudioGeneration } from "@/studio/studio-history-service"
import { createGeneration, getGeneration, promptExpansionMessageMetadata, rebootGeneration } from "../../src/studio/studio-service"
import { studioFallbackDetailPrompt } from "../../src/studio/studio-history-service"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { STUDIO_STYLE_MODEL_CONFIG } from "@opencode-ai/core/studio/model-availability"

// 历史视频记录曾把 provider 的 "std"/"pro" 模式写进 videoQualityMode，
// 它与响应 schema 的 480/720/1080/4k 不兼容，会让 GET /studio/generations/:id 整个 400，
// 历史资产详情面板因此永远 loading。这里锁住读取时的归一化行为。
describe("Studio generation service", () => {
  test.each(["seedream-5-lite", "Seedream 5.0 Lite", "removed-style"])("rejects creating or rebooting unconfigured %s tasks without modifying history", async (styleModel) => {
    await using directory = await tmpdir()
    await provideTestInstance({
      directory: directory.path,
      fn: async () => {
        const now = Date.now()
        const sessionID = SessionID.descending()
        const id = "gen-retired-lite"
        Database.use((db) => {
          db.insert(SessionTable).values({
            id: sessionID,
            project_id: Instance.project.id,
            slug: sessionID,
            directory: Instance.directory,
            title: "Retired Studio model",
            version: "test",
            agent: "octo_studio",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(StudioGenerationTable).values({
            id,
            session_id: sessionID,
            directory: Instance.directory,
            assistant_message_id: MessageID.ascending(),
            tool_part_id: PartID.ascending(),
            provider: "internel",
            provider_task_id: "retired-provider-task",
            capability: "image.generate",
            status: "failed",
            progress: 0,
            request: { input: { capability: "image.generate", prompt: "旧任务", styleModel } },
            next_poll_at: Number.MAX_SAFE_INTEGER,
            time_created: now,
            time_updated: now,
          }).run()
        })
        const before = Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, id)).get())
        await expect(createGeneration({ sessionID, capability: "image.generate", prompt: "旧任务", styleModel }))
          .rejects.toThrow("模型已下架或不可用")
        await expect(rebootGeneration(id)).rejects.toThrow("模型已下架或不可用")
        expect(Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, id)).get())).toEqual(before)
        expect(Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.session_id, sessionID)).all())).toHaveLength(1)
        expect((await getGeneration(id)).styleModel).toBe(styleModel)
        const legacyRequest = {
          input: { capability: "image.generate", prompt: "旧任务，无 styleModel 字段" },
          task: { model: "txt2img_jimeng", request: { task_type: "txt2img_jimeng", args: { tag_name: "Seedream 5.0 Lite" } } },
        }
        Database.use((db) => db.update(StudioGenerationTable).set({ request: legacyRequest }).where(eq(StudioGenerationTable.id, id)).run())
        await expect(rebootGeneration(id)).rejects.toThrow("模型已下架或不可用")
        expect(Database.use((db) => db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, id)).get())).toMatchObject({
          status: "failed", provider_task_id: "retired-provider-task", request: legacyRequest,
        })
        Database.use((db) => db.update(StudioGenerationTable).set({ request: { input: { capability: "image.generate", prompt: "风格模型：Seedream 5.0 Lite" } } }).where(eq(StudioGenerationTable.id, id)).run())
        await expect(rebootGeneration(id)).rejects.toThrow("无法确认该历史任务使用的模型")
        const index = 0
        const model = STUDIO_STYLE_MODEL_CONFIG[index]!
        STUDIO_STYLE_MODEL_CONFIG.splice(index, 1)
        try {
          await expect(createGeneration({ sessionID, capability: "image.generate", prompt: "旧任务", styleModel: model.id })).rejects.toThrow("模型已下架或不可用")
          Database.use((db) => db.update(StudioGenerationTable).set({ request: { input: { capability: "image.generate", prompt: "旧任务", styleModel: model.id } } }).where(eq(StudioGenerationTable.id, id)).run())
          await expect(rebootGeneration(id)).rejects.toThrow("模型已下架或不可用")
        } finally {
          STUDIO_STYLE_MODEL_CONFIG.splice(index, 0, model)
        }
        Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
      },
    })
  })

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

  // 自定义尺寸生成不携带 aspectRatio（result 落库时回退 3:4），会话视图从工具入参的
  // extra.width/height 推导 isCustom 与像素尺寸。生成详情接口必须同口径补齐，否则
  // 「我的资产」详情的比例显示成 3:4、分辨率显示成 3:4 默认档，与会话详情不一致。
  describe("custom size fields on generation results", () => {
    async function insertCustomGeneration(id: string, resultExtra: Record<string, unknown>) {
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
            title: "Studio generation custom size test",
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
            capability: "image.generate",
            status: "succeeded",
            progress: 100,
            request: {
              input: {
                capability: "image.generate",
                prompt: "一只猫在奔跑",
                styleModel: "seedream-5-lite",
                count: 1,
                imageTool: "internel",
                referenceImages: [],
                // 自定义尺寸：客户端把尺寸写进 extra，不传 aspectRatio。
                extra: { width: 2048, height: 1152 },
              },
            },
            result: {
              id,
              status: "succeeded",
              capability: "image.generate",
              prompt: "一只猫在奔跑",
              provider: "internel",
              model: "internel_raw_model",
              // 完成时落库的 aspectRatio 是默认档；provider 不返回媒体像素尺寸。
              aspectRatio: "3:4",
              images: [{ id: `${id}-0`, kind: "image", url: "https://example.com/image.png" }],
              ...resultExtra,
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

    test("derives isCustom and pixel size from request input for legacy results", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          // 旧数据：result 列没有 isCustom/width/height。
          const sessionID = await insertCustomGeneration("gen-custom-legacy", {})
          try {
            const result = await getGeneration("gen-custom-legacy")
            expect(result.isCustom).toBe(true)
            expect(result.width).toBe(2048)
            expect(result.height).toBe(1152)
            expect(result.aspectRatio).toBe("3:4")
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-custom-legacy")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            })
          }
        },
      })
    })

    test("keeps custom fields from persisted results and omits them for standard sizes", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          // 新数据：result 列带 isCustom/width/height（buildGenerationResult 持久化）。
          const customSessionID = await insertCustomGeneration("gen-custom-persisted", { isCustom: true, width: 2048, height: 1152 })
          try {
            const persisted = await getGeneration("gen-custom-persisted")
            expect(persisted.isCustom).toBe(true)
            expect(persisted.width).toBe(2048)
            expect(persisted.height).toBe(1152)

            // 标准比例生成：无自定义尺寸字段，比例照常展示 aspectRatio。
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
                  title: "Studio generation standard size test",
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
                    id: "gen-standard-ratio",
                    session_id: sessionID,
                    directory: Instance.directory,
                    assistant_message_id: MessageID.ascending(),
                    tool_part_id: PartID.ascending(),
                    provider: "internel",
                    capability: "image.generate",
                    status: "succeeded",
                    progress: 100,
                    request: {
                      input: {
                        capability: "image.generate",
                        prompt: "一只猫在奔跑",
                        styleModel: "seedream-5-lite",
                        aspectRatio: "16:9",
                        count: 1,
                        imageTool: "internel",
                        referenceImages: [],
                      },
                    },
                    result: {
                      id: "gen-standard-ratio",
                      status: "succeeded",
                      capability: "image.generate",
                      prompt: "一只猫在奔跑",
                      provider: "internel",
                      model: "internel_raw_model",
                      aspectRatio: "16:9",
                      images: [{ id: "gen-standard-ratio-0", kind: "image", url: "https://example.com/image.png" }],
                    },
                    next_poll_at: Number.MAX_SAFE_INTEGER,
                    completed_at: now,
                    time_created: now,
                    time_updated: now,
                  })
                  .run(),
              )
              const standard = await getGeneration("gen-standard-ratio")
              expect(standard.isCustom).toBeUndefined()
              expect(standard.width).toBeUndefined()
              expect(standard.height).toBeUndefined()
              expect(standard.aspectRatio).toBe("16:9")
            } finally {
              Database.use((db) => {
                db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-standard-ratio")).run()
                db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
              })
            }
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-custom-persisted")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, customSessionID)).run()
            })
          }
        },
      })
    })

    // 会话删除后走历史表快照回退：新物化的行带 is_custom/width/height，详情面板
    // 仍能展示「自定义」与像素分辨率。
    test("history snapshot fallback keeps custom size fields from materialized rows", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const sessionID = await insertCustomGeneration("gen-custom-snapshot", { isCustom: true, width: 2048, height: 1152 })
          try {
            materializeStudioGeneration(Instance.directory, "gen-custom-snapshot")
            Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-custom-snapshot")).run())
            const snapshot = await getGeneration("gen-custom-snapshot")
            expect(snapshot.isCustom).toBe(true)
            expect(snapshot.images[0]?.width).toBe(2048)
            expect(snapshot.images[0]?.height).toBe(1152)
          } finally {
            Database.use((db) => {
              db.delete(StudioHistoryTable).where(eq(StudioHistoryTable.generation_id, "gen-custom-snapshot")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            })
          }
        },
      })
    })
  })

  // 智能重绘/扩图不落 detailPrompt：会话视图（turns.ts）从工具入参回退推导提示词并显示，
  // 生成详情接口必须同口径，否则「我的资产」详情的提示文案显示 "-" 而会话显示具体提示。
  describe("detailPrompt fallback for editor generations", () => {
    async function insertEditorGeneration(id: string, capability: "image.inpaint" | "image.outpaint", input: Record<string, unknown>) {
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
            title: "Studio generation detailPrompt test",
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
            request: { input: { capability, ...input } },
            result: {
              id,
              status: "succeeded",
              capability,
              prompt: String(input.prompt ?? ""),
              provider: "internel",
              model: "internel_raw_model",
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

    test("falls back to the user prompt for inpaint and outpaint without detailPrompt", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const inpaintSessionID = await insertEditorGeneration("gen-inpaint-prompt", "image.inpaint", { prompt: "把天空改成夕阳" })
          const outpaintSessionID = await insertEditorGeneration("gen-outpaint-prompt", "image.outpaint", {
            prompt: "保留主体和画面风格，扩展更大尺寸和更多环境内容",
          })
          try {
            expect((await getGeneration("gen-inpaint-prompt")).detailPrompt).toBe("把天空改成夕阳")
            expect((await getGeneration("gen-outpaint-prompt")).detailPrompt).toBe("保留主体和画面风格，扩展更大尺寸和更多环境内容")
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-inpaint-prompt")).run()
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-outpaint-prompt")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, inpaintSessionID)).run()
              db.delete(SessionTable).where(eq(SessionTable.id, outpaintSessionID)).run()
            })
          }
        },
      })
    })

    test("keeps persisted detailPrompt and lets displayPrompt suppress the fallback", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const persistedSessionID = await insertEditorGeneration("gen-detail-persisted", "image.inpaint", {
            prompt: "把天空改成夕阳",
            detailPrompt: "重绘：把天空改成夕阳",
          })
          const displaySessionID = await insertEditorGeneration("gen-detail-display", "image.outpaint", {
            prompt: "扩展画面",
            displayPrompt: "扩展画面展示文案",
          })
          try {
            expect((await getGeneration("gen-detail-persisted")).detailPrompt).toBe("重绘：把天空改成夕阳")
            // displayPrompt 存在时不替代：会话视图同样显示 "-"。
            expect((await getGeneration("gen-detail-display")).detailPrompt).toBeUndefined()
          } finally {
            Database.use((db) => {
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-detail-persisted")).run()
              db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-detail-display")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, persistedSessionID)).run()
              db.delete(SessionTable).where(eq(SessionTable.id, displaySessionID)).run()
            })
          }
        },
      })
    })

    // 会话删除后走历史表快照回退，重绘/扩图提示词同样回退到历史行的 prompt。
    test("history snapshot fallback recovers the editor prompt", async () => {
      await using directory = await tmpdir()
      await provideTestInstance({
        directory: directory.path,
        fn: async () => {
          const sessionID = await insertEditorGeneration("gen-inpaint-snapshot", "image.inpaint", { prompt: "把天空改成夕阳" })
          try {
            materializeStudioGeneration(Instance.directory, "gen-inpaint-snapshot")
            Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-inpaint-snapshot")).run())
            const snapshot = await getGeneration("gen-inpaint-snapshot")
            expect(snapshot.detailPrompt).toBe("把天空改成夕阳")
          } finally {
            Database.use((db) => {
              db.delete(StudioHistoryTable).where(eq(StudioHistoryTable.generation_id, "gen-inpaint-snapshot")).run()
              db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
            })
          }
        },
      })
    })

    test("studioFallbackDetailPrompt mirrors the session fallback order", () => {
      expect(studioFallbackDetailPrompt({ detailPrompt: "已保存", displayPrompt: "展示", prompt: "原始" })).toBe("已保存")
      expect(studioFallbackDetailPrompt({ displayPrompt: "展示", prompt: "原始" })).toBeUndefined()
      expect(studioFallbackDetailPrompt({ prompt: "原始" })).toBe("原始")
      expect(studioFallbackDetailPrompt({})).toBeUndefined()
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
