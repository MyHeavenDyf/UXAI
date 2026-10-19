import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
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
  pruneStudioHistoryExcluded,
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
          insertGeneration: ({ id, createdAt, status = "succeeded", images }) =>
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
                  status,
                  progress: 100,
                  request: {},
                  result: {
                    id,
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
        .toEqual(["gen-square-0"])
      expect(listStudioHistoryMedia(directory, { ratios: ["16:9"] }).items.map((item) => item.id))
        .toEqual(["gen-video-0", "gen-1080-0"])
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
})
