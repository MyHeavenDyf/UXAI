import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioHistoryExcludedTable, StudioHistoryTable } from "@/studio/studio-history.sql"
import {
  deleteStudioHistoryMedia,
  flushStudioHistoryMaintenance,
  gcStudioHistoryThumbnails,
  listStudioHistoryExcludedIds,
  listStudioHistoryMedia,
  markStudioHistoryThumbnailFailed,
  materializeStudioGeneration,
  materializeStudioSessionParts,
  pruneStudioHistoryExcluded,
  rematerializeStudioSessionMedia,
  snapshotSessionMedia,
  studioHistoryRevision,
  updateStudioHistoryThumbnail,
} from "../../src/studio/studio-history-service"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

type GenerationImage = Record<string, unknown>

async function withStudioHistory(
  run: (input: {
    directory: string
    sessionID: SessionID
    insertGeneration: (input: {
      id: string
      createdAt: number
      status?: "succeeded" | "failed"
      images?: GenerationImage[]
      request?: Record<string, unknown>
      result?: Record<string, unknown>
    }) => void
  }) => Promise<void> | void,
) {
  await using directory = await tmpdir()
  await provideTestInstance({
    directory: directory.path,
    fn: async () => {
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
            title: "Studio history test",
            version: "test",
            agent: "octo_studio",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      try {
        await run({
          directory: Instance.directory,
          sessionID,
          insertGeneration: ({ id, createdAt, status = "succeeded", images, request, result }) =>
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
                  capability: images?.some((item) => item.kind === "video") ? "video.generate" : "image.generate",
                  status,
                  progress: 100,
                  request: request ?? {},
                  result: {
                    id,
                    ...result,
                    images: images ?? [
                      {
                        id: `${id}-0`,
                        kind: "image",
                        url: `https://example.com/${id}.png`,
                        remoteUrl: `https://example.com/${id}.png`,
                        thumbnailStatus: "pending",
                        width: 1920,
                        height: 1080,
                      },
                    ],
                  },
                  next_poll_at: Number.MAX_SAFE_INTEGER,
                  completed_at: createdAt,
                  time_created: createdAt,
                  time_updated: createdAt,
                })
                .run(),
            ),
        })
      } finally {
        Database.use((db) => {
          db.delete(StudioHistoryTable).where(eq(StudioHistoryTable.directory, Instance.directory)).run()
          db.delete(StudioHistoryExcludedTable).where(eq(StudioHistoryExcludedTable.directory, Instance.directory)).run()
          db.delete(PartTable).where(eq(PartTable.session_id, sessionID)).run()
          db.delete(MessageTable).where(eq(MessageTable.session_id, sessionID)).run()
          db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
        })
      }
    },
  })
}

function image(input: { id: string; kind?: "image" | "video"; width?: number; height?: number; url?: string; thumbnailStatus?: string; thumbnailUrl?: string }): GenerationImage {
  const url = input.url ?? `https://example.com/${input.id}.png`
  return {
    id: input.id,
    kind: input.kind ?? "image",
    url,
    remoteUrl: url,
    width: input.width ?? 1920,
    height: input.height ?? 1080,
    thumbnailStatus: input.thumbnailStatus ?? "pending",
    ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
  }
}

describe("Studio history service", () => {
  test("materializes a succeeded generation and lists its media", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      insertGeneration({ id: "gen-failed", createdAt: 2_000, status: "failed" })

      expect(materializeStudioGeneration(directory, "gen-failed")).toBe(0)
      expect(materializeStudioGeneration(directory, "gen-a")).toBe(1)

      const page = listStudioHistoryMedia(directory)
      expect(page.items).toHaveLength(1)
      expect(page.nextCursor).toBeUndefined()
      expect(page.items[0]).toMatchObject({
        id: "gen-a-0",
        sessionID: expect.any(String),
        generationID: "gen-a",
        mediaIndex: 0,
        kind: "image",
        url: "https://example.com/gen-a.png",
        createdAt: 1_000,
      })
    })
  })

  test("backfills old generations on first list, then only new materializations appear", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "gen-old", createdAt: 1_000 })

      const backfilled = listStudioHistoryMedia(directory)
      expect(backfilled.items.map((item) => item.id)).toEqual(["gen-old-0"])

      insertGeneration({ id: "gen-new", createdAt: 2_000 })
      const stale = listStudioHistoryMedia(directory)
      expect(stale.items.map((item) => item.id)).toEqual(["gen-old-0"])

      materializeStudioGeneration(directory, "gen-new")
      const refreshed = listStudioHistoryMedia(directory)
      expect(refreshed.items.map((item) => item.id)).toEqual(["gen-new-0", "gen-old-0"])
    })
  })

  test("paginates desc and asc with keyset cursors and id tie-breaks", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      for (const [id, createdAt] of [
        ["gen-a", 1_000],
        ["gen-b", 2_000],
        ["gen-t1", 3_000],
        ["gen-t2", 3_000],
        ["gen-c", 4_000],
      ] as const) {
        insertGeneration({ id, createdAt })
        materializeStudioGeneration(directory, id)
      }

      const first = listStudioHistoryMedia(directory, { limit: 2 })
      expect(first.items.map((item) => item.id)).toEqual(["gen-c-0", "gen-t2-0"])
      expect(first.nextCursor).toBe("3000|gen-t2-0")

      const second = listStudioHistoryMedia(directory, { limit: 2, cursor: first.nextCursor })
      expect(second.items.map((item) => item.id)).toEqual(["gen-t1-0", "gen-b-0"])
      expect(second.nextCursor).toBe("2000|gen-b-0")

      const third = listStudioHistoryMedia(directory, { limit: 2, cursor: second.nextCursor })
      expect(third.items.map((item) => item.id)).toEqual(["gen-a-0"])
      expect(third.nextCursor).toBeUndefined()

      const ascending = listStudioHistoryMedia(directory, { sort: "asc", limit: 2 })
      expect(ascending.items.map((item) => item.id)).toEqual(["gen-a-0", "gen-b-0"])
      expect(ascending.nextCursor).toBe("2000|gen-b-0")

      const ascendingNext = listStudioHistoryMedia(directory, { sort: "asc", limit: 2, cursor: ascending.nextCursor })
      expect(ascendingNext.items.map((item) => item.id)).toEqual(["gen-t1-0", "gen-t2-0"])
    })
  })

  test("filters by kind, resolution and ratio", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "gen-1080", createdAt: 1_000 })
      insertGeneration({
        id: "gen-square",
        createdAt: 2_000,
        images: [image({ id: "gen-square-0", width: 640, height: 480 })],
      })
      insertGeneration({
        id: "gen-video",
        createdAt: 3_000,
        images: [image({ id: "gen-video-0", kind: "video", url: "https://example.com/gen-video.mp4" })],
      })
      for (const id of ["gen-1080", "gen-square", "gen-video"]) materializeStudioGeneration(directory, id)

      expect(listStudioHistoryMedia(directory, { kind: "image" }).items.map((item) => item.id))
        .toEqual(["gen-square-0", "gen-1080-0"])
      expect(listStudioHistoryMedia(directory, { kind: "video" }).items.map((item) => item.id))
        .toEqual(["gen-video-0"])
      expect(listStudioHistoryMedia(directory, { resolutions: ["480P"] }).items.map((item) => item.id))
        .toEqual([])
      expect(listStudioHistoryMedia(directory, { ratios: ["16:9"] }).items.map((item) => item.id))
        .toEqual(["gen-video-0", "gen-1080-0"])
    })
  })

  test("repairs legacy ratio buckets so every ratio filter matches the detail panel", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      // 旧实现只按长边/短边分桶：竖版（2:3/3:4/9:16）被写成横版孪生标签；
      // 横版/方图行本身写对，但缺尺寸的行会写 NULL。corrupt 模拟各标签的旧数据形态。
      const legacy = [
        { label: "21:9", id: "gen-219", width: 2560, height: 1080, corrupt: null },
        { label: "16:9", id: "gen-169", width: 1920, height: 1080, corrupt: null },
        { label: "4:3", id: "gen-43", width: 1440, height: 1080, corrupt: null },
        { label: "3:2", id: "gen-32", width: 1500, height: 1000, corrupt: null },
        { label: "1:1", id: "gen-11", width: 1024, height: 1024, corrupt: null },
        { label: "2:3", id: "gen-23", width: 1000, height: 1500, corrupt: "3:2" },
        { label: "3:4", id: "gen-34", width: 1080, height: 1440, corrupt: "4:3" },
        { label: "9:16", id: "gen-916", width: 1080, height: 1920, corrupt: "16:9" },
      ]
      legacy.forEach((row, index) => insertGeneration({
        id: row.id,
        createdAt: index + 1,
        images: [image({ id: `${row.id}-0`, width: row.width, height: row.height })],
        result: { aspectRatio: row.label },
      }))
      // 只有尺寸、没有生成级比例标签的竖版行：同样被分桶写错。
      insertGeneration({ id: "portrait", createdAt: 9, images: [image({ id: "portrait-0", width: 1080, height: 1440 })] })
      // 自定义尺寸：比例在容差外，归为「自定义」。
      insertGeneration({ id: "custom", createdAt: 10, images: [image({ id: "custom-0", width: 1000, height: 700 })] })
      // 完全没有比例信息的行：保持 NULL，只在无比例条件时可见。
      insertGeneration({
        id: "unknown",
        createdAt: 11,
        images: [{ id: "unknown-0", kind: "image", url: "https://example.com/unknown.png", remoteUrl: "https://example.com/unknown.png", thumbnailStatus: "pending" }],
      })
      for (const id of [...legacy.map((row) => row.id), "portrait", "custom", "unknown"]) materializeStudioGeneration(directory, id)
      Database.use((db) => {
        for (const row of legacy) {
          db.update(StudioHistoryTable).set({ ratio: row.corrupt }).where(eq(StudioHistoryTable.id, `${row.id}-0`)).run()
        }
        db.update(StudioHistoryTable).set({ ratio: "4:3" }).where(eq(StudioHistoryTable.id, "portrait-0")).run()
      })

      // 首次列表查询触发幂等修复：每个比例筛选都精确命中自己的行，竖版不再被横版孪生标签污染。
      for (const row of legacy) {
        const expected = row.label === "3:4" ? [`${row.id}-0`, "portrait-0"] : [`${row.id}-0`]
        expect(listStudioHistoryMedia(directory, { ratios: [row.label] }).items.map((item) => item.id).sort())
          .toEqual(expected.sort())
      }
      expect(listStudioHistoryMedia(directory, { ratios: ["自定义"] }).items.map((item) => item.id))
        .toEqual(["custom-0"])
      expect(listStudioHistoryMedia(directory).items).toHaveLength(11)

      const ratios = Database.use((db) =>
        db.select({ id: StudioHistoryTable.id, ratio: StudioHistoryTable.ratio }).from(StudioHistoryTable).all(),
      )
      expect(new Map(ratios.map((row) => [row.id, row.ratio]))).toEqual(new Map([
        ...legacy.map((row) => [`${row.id}-0`, row.label] as const),
        ["portrait-0", "3:4"],
        ["custom-0", "自定义"],
        ["unknown-0", null],
      ]))
    })
  })

  test("filters videos by requested quality without dimensions and excludes images", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "image-1080", createdAt: 1 })
      const qualities = [
        { request: "480p", result: "480", resolution: "480P" },
        { request: "720p", result: "720", resolution: "720P" },
        { request: "1080p", result: "1080", resolution: "1080P" },
        { request: "4k", result: "4k", resolution: "4K" },
      ]
      qualities.forEach((quality, index) => insertGeneration({
        id: quality.result,
        createdAt: index + 2,
        images: [{ id: quality.result, kind: "video", url: `https://example.com/${quality.result}.mp4` }],
        request: { input: { extra: { resolution: quality.request } } },
        // 请求优先于结果，同时兼容旧 std/pro；媒体完全没有宽高。
        result: { videoQualityMode: quality.result === "720" ? "1080" : "pro" },
      }))
      qualities.forEach((quality) => {
        expect(listStudioHistoryMedia(directory, { resolutions: [quality.resolution] }).items.map((item) => item.id))
          .toEqual([quality.result])
      })
      expect(listStudioHistoryMedia(directory, { resolutions: ["720P", "1080P"] }).items.map((item) => item.id))
        .toEqual(["1080", "720"])
      expect(listStudioHistoryMedia(directory, { kind: "image", resolutions: ["1080P"] }).items).toEqual([])
      expect(listStudioHistoryMedia(directory, { kind: "video", resolutions: ["720P"] }).items.map((item) => item.id))
        .toEqual(["720"])
      // 即使旧图片行有按宽高生成的标签，也不能混入视频分辨率筛选。
      Database.use((db) => db.update(StudioHistoryTable).set({ resolution: "1080P" })
        .where(eq(StudioHistoryTable.id, "image-1080-0")).run())
      expect(listStudioHistoryMedia(directory, { resolutions: ["1080P"] }).items.map((item) => item.id))
        .toEqual(["1080"])
    })
  })

  test("repairs text fields of materialized rows on first access and invalidates the history revision", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({
        id: "gen-text",
        createdAt: 1_000,
        images: [image({ id: "gen-text-0" })],
        request: { input: { prompt: "一只猫在奔跑", detailTitle: "奔跑的猫", styleModel: "wan2.2" } },
        result: { model: "wan2.2", provider: "internel", toolAction: "generate_image" },
      })
      materializeStudioGeneration(directory, "gen-text")
      // 模拟旧版本物化的行：文案列全部为空。
      Database.use((db) =>
        db.update(StudioHistoryTable)
          .set({
            prompt: null,
            display_prompt: null,
            detail_prompt: null,
            detail_title: null,
            model: null,
            style_model: null,
            provider: null,
            video_mode: null,
            video_quality_mode: null,
            tool_action: null,
            is_custom: null,
            time_updated: 1,
          })
          .where(eq(StudioHistoryTable.id, "gen-text-0"))
          .run(),
      )

      const items = listStudioHistoryMedia(directory).items
      expect(items.find((item) => item.id === "gen-text-0")).toMatchObject({
        prompt: "一只猫在奔跑",
        detailTitle: "奔跑的猫",
        model: "wan2.2",
        styleModel: "wan2.2",
        provider: "internel",
        toolAction: "generate_image",
      })
      const row = Database.use((db) =>
        db.select().from(StudioHistoryTable).where(eq(StudioHistoryTable.id, "gen-text-0")).get(),
      )
      expect(row?.prompt).toBe("一只猫在奔跑")
      expect(row?.model).toBe("wan2.2")
      expect(row?.time_updated).toBeGreaterThan(1)
    })
  })

  test("materialization and session snapshots classify legacy std/pro result quality", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      for (const quality of ["480", "720", "1080", "4k", "pro", "std", "unknown"]) {
        insertGeneration({
          id: quality,
          createdAt: 1,
          images: [{ id: quality, kind: "video", url: `https://example.com/${quality}.mp4`, width: 1920, height: 1080 }],
          result: quality === "unknown" ? {} : { videoQualityMode: quality },
        })
        materializeStudioGeneration(directory, quality)
      }
      // 旧 std/pro 档位归一化后也能被 480P/720P 命中；只有真正无档位的 unknown 落空。
      expect(listStudioHistoryMedia(directory, { resolutions: ["480P", "720P", "1080P", "4K"] }).items.map((item) => item.id).sort())
        .toEqual(["1080", "480", "4k", "720", "pro", "std"])
      snapshotSessionMedia(directory, sessionID)
      expect(listStudioHistoryMedia(directory, { resolutions: ["1080P"] }).items.map((item) => item.id)).toEqual(["1080"])
      expect(listStudioHistoryMedia(directory).items).toHaveLength(7)
    })
  })

  test("backfills resolution for legacy std/pro videos whose generation was deleted", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({
        id: "legacy-std",
        createdAt: 1,
        images: [image({ id: "legacy-std", kind: "video", url: "https://example.com/std.mp4" })],
        result: { videoQualityMode: "std" },
      })
      snapshotSessionMedia(directory, sessionID)
      Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "legacy-std")).run())
      // 模拟旧数据：历史行没有分辨率（generation 已随会话删除，无法从请求重算）。
      Database.use((db) => db.update(StudioHistoryTable).set({ resolution: null })
        .where(eq(StudioHistoryTable.id, "legacy-std")).run())

      expect(listStudioHistoryMedia(directory, { resolutions: ["480P"] }).items.map((item) => item.id))
        .toEqual(["legacy-std"])
      expect(listStudioHistoryMedia(directory, { resolutions: ["720P"] }).items).toEqual([])
      // 每次查询都会幂等修复：老 std 视频补齐 480P，且不依赖进程重启。
      const repaired = Database.use((db) => db.select().from(StudioHistoryTable)
        .where(eq(StudioHistoryTable.id, "legacy-std")).get())
      expect(repaired?.resolution).toBe("480P")
    })
  })

  test("repairs existing video resolutions on first access and invalidates the history revision", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      for (const id of ["missing", "incorrect", "unknown"]) {
        insertGeneration({
          id,
          createdAt: 1,
          images: [{ id, kind: "video", url: `https://example.com/${id}.mp4`, thumbnailUrl: "cover.webp", thumbnailStatus: "ready" }],
          request: id === "unknown" ? {} : { input: { extra: { resolution: "720p" } } },
          result: id === "unknown" ? {} : { videoQualityMode: "pro" },
        })
        materializeStudioGeneration(directory, id)
      }
      Database.use((db) => {
        db.update(StudioHistoryTable).set({ resolution: null, time_updated: 1 })
          .where(eq(StudioHistoryTable.id, "missing")).run()
        db.update(StudioHistoryTable).set({ resolution: "4K", time_updated: 1 })
          .where(eq(StudioHistoryTable.id, "incorrect")).run()
        db.update(StudioHistoryTable).set({ resolution: "480P", time_updated: 1 })
          .where(eq(StudioHistoryTable.id, "unknown")).run()
      })
      const previous = Database.use((db) => db.select().from(StudioHistoryTable)
        .where(eq(StudioHistoryTable.directory, directory)).all())
      const revision = studioHistoryRevision(directory)
      expect(revision.revision).not.toBe("3:1:1:unknown")
      expect(listStudioHistoryMedia(directory, { resolutions: ["720P"] }).items.map((item) => item.id))
        .toEqual(["missing", "incorrect"])
      const repaired = Database.use((db) => db.select().from(StudioHistoryTable)
        .where(eq(StudioHistoryTable.directory, directory)).all())
      expect(repaired.every((item) => item.time_updated > 1)).toBe(true)
      expect(repaired.find((item) => item.id === "unknown")?.resolution).toBeNull()
      expect(repaired.map((item) => ({ ...item, resolution: null, time_updated: 0 })))
        .toEqual(previous.map((item) => ({ ...item, resolution: null, time_updated: 0 })))
      expect(studioHistoryRevision(directory)).toEqual(revision)
    })
  })

  test("preserves snapshot resolution when its generation has been deleted", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({
        id: "snapshot-video",
        createdAt: 1,
        images: [{ id: "snapshot-video", kind: "video", url: "https://example.com/video.mp4" }],
        request: { input: { extra: { resolution: "720p" } } },
      })
      snapshotSessionMedia(directory, sessionID)
      Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "snapshot-video")).run())
      expect(listStudioHistoryMedia(directory, { resolutions: ["720P"] }).items.map((item) => item.id))
        .toEqual(["snapshot-video"])
    })
  })

  test("exposes a stable revision that changes on insert and delete", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      materializeStudioGeneration(directory, "gen-a")

      const first = studioHistoryRevision(directory)
      expect(first.count).toBe(1)
      // 未变化时指纹稳定，客户端才能复用缓存跳过列表查询。
      expect(studioHistoryRevision(directory).revision).toBe(first.revision)

      insertGeneration({ id: "gen-b", createdAt: 2_000 })
      materializeStudioGeneration(directory, "gen-b")
      const second = studioHistoryRevision(directory)
      expect(second.count).toBe(2)
      expect(second.revision).not.toBe(first.revision)
      expect(second.headId).toBe("gen-b-0")

      await deleteStudioHistoryMedia(directory, ["gen-a-0"])
      const third = studioHistoryRevision(directory)
      expect(third.count).toBe(1)
      expect(third.revision).not.toBe(second.revision)
    })
  })

  test("prunes excluded tombstones once their generation is gone", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      materializeStudioGeneration(directory, "gen-a")

      expect(await deleteStudioHistoryMedia(directory, ["gen-a-0"])).toBe(1)
      expect(listStudioHistoryExcludedIds(directory)).toEqual(["gen-a-0"])

      // generation 仍存在时墓碑必须保留，否则会被 backfill 复活。
      expect(pruneStudioHistoryExcluded(directory)).toBe(0)
      expect(listStudioHistoryExcludedIds(directory)).toEqual(["gen-a-0"])

      // 模拟会话删除后 generation 被级联清理，此时墓碑失去意义。
      Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-a")).run())
      expect(pruneStudioHistoryExcluded(directory)).toBe(1)
      expect(listStudioHistoryExcludedIds(directory)).toEqual([])
    })
  })

  test("snapshots session media idempotently and refreshes mutable fields", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({
        id: "gen-a",
        createdAt: 1_000,
        images: [
          image({ id: "gen-a-0", thumbnailStatus: "pending" }),
          image({ id: "gen-a-1", thumbnailStatus: "pending" }),
        ],
      })

      expect(snapshotSessionMedia(directory, sessionID)).toBe(2)
      expect(snapshotSessionMedia(directory, sessionID)).toBe(2)
      expect(listStudioHistoryMedia(directory).items).toHaveLength(2)

      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({
            result: {
              id: "gen-a",
              images: [
                image({ id: "gen-a-0", thumbnailStatus: "ready", thumbnailUrl: ".octo/t.webp" }),
                image({ id: "gen-a-1", thumbnailStatus: "pending" }),
              ],
            },
          })
          .where(eq(StudioGenerationTable.id, "gen-a"))
          .run(),
      )
      expect(snapshotSessionMedia(directory, sessionID)).toBe(2)

      const items = listStudioHistoryMedia(directory).items
      expect(items).toHaveLength(2)
      expect(items.find((item) => item.id === "gen-a-0")).toMatchObject({
        thumbnailStatus: "ready",
        thumbnailUrl: ".octo/t.webp",
      })
    })
  })

  test("deletes media permanently, blocks re-materialization, and keeps generation data", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      insertGeneration({ id: "gen-b", createdAt: 2_000 })
      materializeStudioGeneration(directory, "gen-a")
      materializeStudioGeneration(directory, "gen-b")

      expect(await deleteStudioHistoryMedia(directory, ["missing-0"])).toBe(0)
      // 未知 id 不应留下无法回收的 null 墓碑。
      expect(listStudioHistoryExcludedIds(directory)).toEqual([])
      expect(await deleteStudioHistoryMedia(directory, ["gen-a-0"])).toBe(1)
      expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["gen-b-0"])

      // 墓碑阻止 backfill / materialize / snapshot 再次物化已删除的媒体。
      expect(materializeStudioGeneration(directory, "gen-a")).toBe(0)
      expect(snapshotSessionMedia(directory, sessionID)).toBe(1)
      expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["gen-b-0"])

      // 真删除只清历史记录，不动会话生成数据。
      const generations = Database.use((db) =>
        db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, "gen-a")).all(),
      )
      expect(generations).toHaveLength(1)
    })
  })

  test("updates and fails thumbnails per media row", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      insertGeneration({
        id: "gen-a",
        createdAt: 1_000,
        images: [
          image({ id: "gen-a-0", thumbnailStatus: "pending" }),
          image({ id: "gen-a-1", thumbnailStatus: "pending" }),
        ],
      })
      materializeStudioGeneration(directory, "gen-a")

      updateStudioHistoryThumbnail(directory, "gen-a", 1, {
        thumbnailUrl: ".octo/gen-a-1.webp",
        thumbnailStatus: "ready",
      })
      markStudioHistoryThumbnailFailed(directory, "gen-a", 0)

      const items = listStudioHistoryMedia(directory).items
      expect(items.find((item) => item.id === "gen-a-0")).toMatchObject({ thumbnailStatus: "failed" })
      expect(items.find((item) => item.id === "gen-a-1")).toMatchObject({
        thumbnailStatus: "ready",
        thumbnailUrl: ".octo/gen-a-1.webp",
      })
    })
  })

  // 回归：不分块时单条 upsert 携带 rows*17 个绑定参数，超过 SQLite 上限
  // （默认 32766，约 1900 行）抛 "too many SQL variables"，backfill 会在每次
  // list 时重试并让 /studio/history 永久 500。
  test("backfills more media than the SQLite variable limit without failing", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      const total = 2_200
      for (let index = 0; index < total; index++) {
        insertGeneration({ id: `gen-${index}`, createdAt: index + 1 })
      }

      let page = listStudioHistoryMedia(directory, { limit: 200 })
      let listed = page.items.length
      while (page.nextCursor) {
        page = listStudioHistoryMedia(directory, { limit: 200, cursor: page.nextCursor })
        listed += page.items.length
      }
      expect(listed).toBe(total)
      expect(Database.use((db) => db.select({ id: StudioHistoryTable.id }).from(StudioHistoryTable).all())).toHaveLength(total)
    })
  })

  test("deletes more media ids than the SQLite variable limit in one call", async () => {
    await withStudioHistory(async ({ directory, insertGeneration }) => {
      const total = 2_200
      for (let index = 0; index < total; index++) {
        insertGeneration({ id: `gen-${index}`, createdAt: index + 1 })
      }
      listStudioHistoryMedia(directory)

      const ids = Array.from({ length: total }, (_, index) => `gen-${index}-0`)
      expect(await deleteStudioHistoryMedia(directory, ids)).toBe(total)
      expect(listStudioHistoryMedia(directory).items).toHaveLength(0)
      expect(listStudioHistoryExcludedIds(directory)).toHaveLength(total)
    })
  })

  function writeThumbnail(directory: string, sessionID: string, name: string) {
    const dir = path.join(directory, ".octo", sessionID, "thumbnails")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), "webp")
  }

  // 非 studio 数据（评论附件等）：GC 必须不碰。
  function writeSessionCommentArtifact(directory: string, sessionID: string) {
    const commentsDir = path.join(directory, ".octo", sessionID, "comments")
    fs.mkdirSync(commentsDir, { recursive: true })
    fs.writeFileSync(path.join(commentsDir, "thread.json"), "{}")
  }

  function removeSessionAndGenerations(sessionID: SessionID) {
    Database.use((db) => {
      db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.session_id, sessionID)).run()
      db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
    })
  }

  test("reclaims thumbnail dirs once a deleted session has no history media left", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      materializeStudioGeneration(directory, "gen-a")
      writeThumbnail(directory, sessionID, "gen-a-0.webp")
      writeSessionCommentArtifact(directory, sessionID)

      removeSessionAndGenerations(sessionID)

      // 会话已删但历史仍保留其媒体：缩略图目录必须保留。
      expect(await gcStudioHistoryThumbnails(directory)).toBe(0)
      expect(fs.existsSync(path.join(directory, ".octo", sessionID, "thumbnails"))).toBe(true)

      // 历史媒体全部删除后：缩略图目录成为孤儿，立即回收，且只删 thumbnails。
      expect(await deleteStudioHistoryMedia(directory, ["gen-a-0"])).toBe(1)
      expect(fs.existsSync(path.join(directory, ".octo", sessionID, "thumbnails"))).toBe(false)
      expect(fs.existsSync(path.join(directory, ".octo", sessionID, "comments"))).toBe(true)
    })
  })

  test("keeps thumbnail dirs for sessions that still exist", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      materializeStudioGeneration(directory, "gen-a")
      writeThumbnail(directory, sessionID, "gen-a-0.webp")

      // 会话仍存在：即使历史中没有该会话的媒体，也不能清理。
      expect(await deleteStudioHistoryMedia(directory, ["gen-a-0"])).toBe(1)
      expect(fs.existsSync(path.join(directory, ".octo", sessionID, "thumbnails"))).toBe(true)
      expect(await gcStudioHistoryThumbnails(directory)).toBe(0)
    })
  })

  // 不同项目目录下 provider 可能返回相同 media id：主键为 (directory, id)，
  // 必须各自独立，删除一个目录的媒体不能影响另一个。
  test("scopes history rows and tombstones by directory", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      materializeStudioGeneration(directory, "gen-a")

      const other = `${directory}-other`
      Database.use((db) =>
        db
          .insert(StudioHistoryTable)
          .values({
            id: "gen-a-0",
            session_id: sessionID,
            directory: other,
            generation_id: "gen-a",
            media_index: 0,
            kind: "image",
            url: "https://example.com/other.png",
            created_at: 1_000,
            time_created: 1_000,
            time_updated: 1_000,
          })
          .run(),
      )
      try {
        expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["gen-a-0"])
        expect(listStudioHistoryMedia(other).items.map((item) => item.id)).toEqual(["gen-a-0"])

        expect(await deleteStudioHistoryMedia(directory, ["gen-a-0"])).toBe(1)
        expect(listStudioHistoryMedia(directory).items).toEqual([])
        expect(listStudioHistoryMedia(other).items.map((item) => item.id)).toEqual(["gen-a-0"])
      } finally {
        Database.use((db) => {
          db.delete(StudioHistoryTable).where(eq(StudioHistoryTable.directory, other)).run()
          db.delete(StudioHistoryExcludedTable).where(eq(StudioHistoryExcludedTable.directory, other)).run()
        })
      }
    })
  })

  // 快照失败的会话删除后媒体从未进入历史表，缩略图目录成为孤儿，
  // 由 backfill 触发的后台维护（全量 GC）兜底回收。
  test("reclaims orphaned thumbnail dirs during backfill full scan", async () => {
    await withStudioHistory(async ({ directory, sessionID, insertGeneration }) => {
      insertGeneration({ id: "gen-a", createdAt: 1_000 })
      writeThumbnail(directory, sessionID, "gen-a-0.webp")
      removeSessionAndGenerations(sessionID)

      // listStudioHistoryMedia 触发 backfill，维护任务在后台异步执行。
      expect(listStudioHistoryMedia(directory).items).toHaveLength(0)
      await flushStudioHistoryMaintenance(directory)
      expect(fs.existsSync(path.join(directory, ".octo", sessionID, "thumbnails"))).toBe(false)
    })
  })

  function importedStudioPart(input: {
    sessionID: SessionID
    generationID: string
    output: Record<string, unknown>
    toolInput?: Record<string, unknown>
    attachments?: { url: string; mime: string }[]
    end?: number
  }): MessageV2.Part {
    return {
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: MessageID.ascending(),
      type: "tool",
      callID: `studio_${input.generationID}`,
      tool: "image-generation-tool",
      state: {
        status: "completed",
        input: input.toolInput ?? {},
        output: JSON.stringify(input.output),
        title: "图片生成",
        metadata: { studio: { generationID: input.generationID, status: "succeeded", progress: 100 } },
        time: { start: 1_000, end: input.end ?? 2_000 },
        ...(input.attachments
          ? {
              attachments: input.attachments.map((attachment) => ({
                id: PartID.ascending(),
                sessionID: input.sessionID,
                messageID: MessageID.ascending(),
                type: "file" as const,
                mime: attachment.mime,
                filename: "attachment",
                url: attachment.url,
              })),
            }
          : {}),
      },
    }
  }

  // 分享/文件导入的 octo_studio 会话没有 studio_generation 行，
  // 历史媒体从导入的 tool parts 直接物化。
  test("materializes imported session media from completed tool parts", async () => {
    await withStudioHistory(async ({ directory, sessionID }) => {
      const imagePart = importedStudioPart({
        sessionID,
        generationID: "gen-import-image",
        end: 4_000,
        output: {
          ok: true,
          provider: "internel",
          capability: "image.generate",
          toolAction: "generate",
          model: "test-model",
          aspectRatio: "16:9",
          media: [
            {
              id: "img-import-0",
              kind: "image",
              url: "https://example.com/import-0.png",
              remoteUrl: "https://example.com/import-0.png",
              thumbnailUrl: "https://example.com/import-0.webp",
              thumbnailStatus: "ready",
              width: 1920,
              height: 1080,
            },
          ],
        },
        toolInput: { effectivePrompt: "导入图片", displayPrompt: "导入图片展示", detailTitle: "导入标题", styleModel: "风格A" },
      })
      const videoPart = importedStudioPart({
        sessionID,
        generationID: "gen-import-video",
        end: 5_000,
        output: {
          ok: true,
          provider: "internel",
          capability: "video.generate",
          model: "test-model",
          aspectRatio: "9:16",
          videoQualityMode: "1080",
          media: [
            { id: "vid-import-0", kind: "video", url: "https://example.com/import-1.mp4", remoteUrl: "https://example.com/import-1.mp4", width: 1080, height: 1920 },
          ],
        },
      })
      const skipped: MessageV2.Part[] = [
        { id: PartID.ascending(), sessionID, messageID: MessageID.ascending(), type: "text", text: "用户输入" },
        {
          id: PartID.ascending(),
          sessionID,
          messageID: MessageID.ascending(),
          type: "tool",
          callID: "studio-running",
          tool: "image-generation-tool",
          state: { status: "running", input: {}, title: "图片生成", time: { start: 1_000 } },
        },
        importedStudioPart({ sessionID, generationID: "gen-empty", output: {} }),
      ]
      const before = Date.now()
      expect(materializeStudioSessionParts(directory, sessionID, [imagePart, videoPart, ...skipped])).toBe(2)

      const items = listStudioHistoryMedia(directory).items
      expect(items).toHaveLength(2)
      // 素材时间是导入成功时刻（视作刚刚生成），不是 part 里的原始生成时间。
      expect(items.every((item) => item.createdAt >= before)).toBe(true)
      expect(new Set(items.map((item) => item.createdAt)).size).toBe(1)
      expect(items[0]).toMatchObject({
        id: "vid-import-0",
        sessionID,
        generationID: "gen-import-video",
        kind: "video",
        url: "https://example.com/import-1.mp4",
      })
      expect(items[1]).toMatchObject({
        id: "img-import-0",
        sessionID,
        generationID: "gen-import-image",
        kind: "image",
        url: "https://example.com/import-0.png",
        thumbnailUrl: "https://example.com/import-0.webp",
        prompt: "导入图片",
        displayPrompt: "导入图片展示",
        detailTitle: "导入标题",
        styleModel: "风格A",
        model: "test-model",
        provider: "internel",
        capability: "image.generate",
        aspectRatio: "16:9",
      })
      expect(listStudioHistoryMedia(directory, { resolutions: ["1080P"] }).items.map((item) => item.id)).toEqual(["vid-import-0"])

      // 重复导入同一分享：媒体 id 幂等，不产生重复历史行，时间刷新为本次导入时间。
      Database.use((db) =>
        db.update(StudioHistoryTable).set({ created_at: 1_000 }).where(eq(StudioHistoryTable.directory, directory)).run()
      )
      const reimportedAt = Date.now()
      expect(materializeStudioSessionParts(directory, sessionID, [imagePart, videoPart])).toBe(2)
      const refreshed = listStudioHistoryMedia(directory).items
      expect(refreshed).toHaveLength(2)
      expect(refreshed.every((item) => item.createdAt >= reimportedAt)).toBe(true)
    })
  })

  test("falls back to attachments and URL lists when tool output has no media array", async () => {
    await withStudioHistory(async ({ directory, sessionID }) => {
      const part = importedStudioPart({
        sessionID,
        generationID: "gen-legacy",
        output: {
          ok: true,
          capability: "image.generate",
          images: ["https://example.com/legacy-a.png", "https://example.com/legacy-a.png"],
          videos: ["https://example.com/legacy-b.mp4"],
        },
        attachments: [{ url: "https://example.com/legacy-c.png", mime: "image/png" }],
      })
      expect(materializeStudioSessionParts(directory, sessionID, [part])).toBe(3)

      const items = listStudioHistoryMedia(directory).items
      expect(items.map((item) => item.id)).toEqual(["gen-legacy-2", "gen-legacy-1", "gen-legacy-0"])
      expect(items.map((item) => item.kind)).toEqual(["video", "image", "image"])
      expect(items.map((item) => item.url)).toEqual([
        "https://example.com/legacy-b.mp4",
        "https://example.com/legacy-a.png",
        "https://example.com/legacy-c.png",
      ])
    })
  })

  test("re-importing a share restores media deleted from history by clearing their tombstones", async () => {
    await withStudioHistory(async ({ directory, sessionID }) => {
      const part = importedStudioPart({
        sessionID,
        generationID: "gen-import-image",
        output: {
          ok: true,
          capability: "image.generate",
          media: [{ id: "img-import-0", kind: "image", url: "https://example.com/import-0.png", remoteUrl: "https://example.com/import-0.png" }],
        },
      })
      expect(materializeStudioSessionParts(directory, sessionID, [part])).toBe(1)
      expect(await deleteStudioHistoryMedia(directory, ["img-import-0"])).toBe(1)
      expect(listStudioHistoryExcludedIds(directory)).toEqual(["img-import-0"])

      // 重新导入是显式恢复动作：清掉墓碑，素材回到「我的资产」。
      expect(materializeStudioSessionParts(directory, sessionID, [part])).toBe(1)
      expect(listStudioHistoryExcludedIds(directory)).toEqual([])
      const items = listStudioHistoryMedia(directory).items
      expect(items.map((item) => item.id)).toEqual(["img-import-0"])
    })
  })

  test("media without generation metadata dedup across re-imports via the stable callID fallback", async () => {
    await withStudioHistory(async ({ directory, sessionID }) => {
      // 无 metadata.studio.generationID 的旧格式 tool part：每次导入 part.id 都会被重映射，
      // 兜底 id 必须取包内稳定的 callID，否则重导同一分享会产生重复历史行。
      const legacyPart = (): MessageV2.Part => ({
        id: PartID.ascending(),
        sessionID,
        messageID: MessageID.ascending(),
        type: "tool",
        callID: "call_stable_import",
        tool: "image-generation-tool",
        state: {
          status: "completed",
          input: {},
          output: JSON.stringify({ ok: true, capability: "image.generate", images: ["https://example.com/call-stable.png"] }),
          title: "图片生成",
          metadata: {},
          time: { start: 1_000, end: 2_000 },
        },
      })
      expect(materializeStudioSessionParts(directory, sessionID, [legacyPart()])).toBe(1)
      expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["studio_call_stable_import-0"])

      // 第二次导入：part.id 不同、callID 相同 → 幂等刷新，不产生重复行。
      Database.use((db) =>
        db.update(StudioHistoryTable).set({ created_at: 1_000 }).where(eq(StudioHistoryTable.directory, directory)).run()
      )
      const reimportedAt = Date.now()
      expect(materializeStudioSessionParts(directory, sessionID, [legacyPart()])).toBe(1)
      const refreshed = listStudioHistoryMedia(directory).items
      expect(refreshed).toHaveLength(1)
      expect(refreshed.every((item) => item.createdAt >= reimportedAt)).toBe(true)
    })
  })

  test("rematerializes session parts from storage to restore media deleted from history", async () => {
    await withStudioHistory(async ({ directory, sessionID }) => {
      // 模拟已导入的分享会话：parts 落在 part 存储（app 缓存命中重开分享时不重跑导入，
      // 只能从存储重读 parts 走重物化）。
      const assistant: MessageV2.Assistant = {
        id: MessageID.ascending(),
        sessionID,
        role: "assistant",
        time: { created: Date.now() },
        parentID: MessageID.ascending(),
        modelID: ModelID.make("test-model"),
        providerID: ProviderID.make("test"),
        mode: "primary",
        agent: "octo_studio",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      const part: MessageV2.Part = {
        ...importedStudioPart({
          sessionID,
          generationID: "gen-remat",
          output: {
            ok: true,
            capability: "image.generate",
            media: [{ id: "img-remat-0", kind: "image", url: "https://example.com/remat-0.png", remoteUrl: "https://example.com/remat-0.png" }],
          },
        }),
        messageID: assistant.id,
      }
      const { id: messageRowID, sessionID: messageSessionID, ...messageData } = assistant
      const { id: partRowID, messageID: partMessageID, sessionID: partSessionID, ...partData } = part
      Database.use((db) => {
        db.insert(MessageTable)
          .values({ id: messageRowID, session_id: messageSessionID, time_created: assistant.time.created, data: messageData })
          .run()
        db.insert(PartTable)
          .values({ id: partRowID, message_id: partMessageID, session_id: partSessionID, time_created: 1_000, data: partData })
          .run()
      })

      expect(rematerializeStudioSessionMedia(directory, sessionID)).toBe(1)
      expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["img-remat-0"])

      expect(await deleteStudioHistoryMedia(directory, ["img-remat-0"])).toBe(1)
      expect(listStudioHistoryMedia(directory).items).toHaveLength(0)

      // 重开分享触发 snapshot 端点的重物化：清墓碑，素材回到「我的资产」。
      expect(rematerializeStudioSessionMedia(directory, sessionID)).toBe(1)
      expect(listStudioHistoryExcludedIds(directory)).toEqual([])
      expect(listStudioHistoryMedia(directory).items.map((item) => item.id)).toEqual(["img-remat-0"])

      // 幂等：无删除时重物化只刷新，不产生重复行。
      expect(rematerializeStudioSessionMedia(directory, sessionID)).toBe(1)
      expect(listStudioHistoryMedia(directory).items).toHaveLength(1)
    })
  })
})
