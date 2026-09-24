import { describe, expect, test } from "bun:test"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { Instance } from "@/project/instance"
import { SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Identifier } from "@/id/id"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { StudioMediaThumbnailTable } from "@/studio/studio-media-thumbnail.sql"
import {
  enqueueStudioMediaThumbnails,
  ensureStudioSessionThumbnails,
  loadStudioThumbnailSource,
  prepareStudioThumbnailMedia,
  saveStudioMediaThumbnail,
  studioThumbnailContentTypeAllowed,
  studioThumbnailResponseBytes,
  studioThumbnailWebpAllowed,
} from "../../src/studio/studio-media-thumbnail"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lbMcWQAAAABJRU5ErkJggg=="
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])

async function withGeneration(
  source: string | string[],
  run: (input: { generationID: string; sessionID: SessionID; toolPartID: string }) => Promise<void> | void,
  kind: "image" | "video" = "image",
) {
  await using directory = await tmpdir()
  await provideTestInstance({
    directory: directory.path,
    fn: async () => {
      const now = Date.now()
      const sessionID = SessionID.descending()
      const generationID = Identifier.create("studio_gen", "ascending")
      const toolPartID = PartID.ascending()
      Database.use((db) => {
        db.insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Instance.project.id,
            slug: sessionID,
            directory: Instance.directory,
            title: "Studio thumbnail test",
            version: "test",
            agent: "octo_studio",
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(StudioGenerationTable)
          .values({
            id: generationID,
            session_id: sessionID,
            directory: Instance.directory,
            assistant_message_id: MessageID.ascending(),
            tool_part_id: toolPartID,
            provider: "internel",
            capability: "image.generate",
            status: "succeeded",
            progress: 100,
            request: {},
            result: {
              images: (Array.isArray(source) ? source : [source]).map((url, index) => ({
                id: `${generationID}-${index}`,
                kind,
                url,
                remoteUrl: url,
                thumbnailStatus: "pending",
              })),
            },
            next_poll_at: Number.MAX_SAFE_INTEGER,
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      await Promise.resolve(run({ generationID, sessionID, toolPartID })).finally(() => {
        Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
      })
    },
  })
}

describe("Studio media thumbnails", () => {
  test("marks images and videos pending for browser thumbnail capture", () => {
    expect(
      prepareStudioThumbnailMedia([
        { id: "image", kind: "image", url: "https://example.com/image.png" },
        { id: "video", kind: "video", url: "https://example.com/video.mp4" },
      ]),
    ).toEqual([
      {
        id: "image",
        kind: "image",
        url: "https://example.com/image.png",
        thumbnailUrl: undefined,
        thumbnailStatus: "pending",
      },
      {
        id: "video",
        kind: "video",
        url: "https://example.com/video.mp4",
        thumbnailUrl: undefined,
        thumbnailStatus: "pending",
      },
    ])
  })

  test("makes an old failed image eligible for browser retry", () => {
    expect(
      prepareStudioThumbnailMedia([
        { id: "image", kind: "image", url: "https://example.com/image.png", thumbnailStatus: "failed" },
      ])[0]?.thumbnailStatus,
    ).toBe("pending")
  })

  test("does not trust a remote URL as an already materialized thumbnail", () => {
    expect(
      prepareStudioThumbnailMedia([{
        id: "image",
        kind: "image",
        url: "https://example.com/original.png",
        thumbnailUrl: "https://example.com/provider-thumbnail.png",
        thumbnailStatus: "ready",
      }])[0],
    ).toMatchObject({ thumbnailUrl: undefined, thumbnailStatus: "pending" })
  })

  test("rejects non-image response types", () => {
    expect(studioThumbnailContentTypeAllowed("image/png; charset=binary")).toBe(true)
    expect(studioThumbnailContentTypeAllowed("application/octet-stream")).toBe(true)
    expect(studioThumbnailContentTypeAllowed("text/html")).toBe(false)
    expect(studioThumbnailContentTypeAllowed(null)).toBe(false)
  })

  test("stops reading a response when its body exceeds the configured limit", async () => {
    const error = await studioThumbnailResponseBytes(new Response(new Uint8Array([1, 2, 3, 4, 5])), 4).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected response size validation to fail.")
    expect(error.message).toContain("maximum download size")
  })

  test("validates the lightweight WebP container header", () => {
    expect(studioThumbnailWebpAllowed(webp)).toBe(true)
    expect(studioThumbnailWebpAllowed(Buffer.from("not-webp"))).toBe(false)
  })

  test("loads a persisted data image as the browser source", async () => {
    await withGeneration(image, async ({ generationID }) => {
      const source = await loadStudioThumbnailSource({ generationID, mediaIndex: 0 })
      expect(source.contentType).toBe("image/png")
      expect(source.bytes.byteLength).toBeGreaterThan(0)
    })
  })

  test("resolves a legacy completed-part result id to its generation", async () => {
    await withGeneration(image, async ({ generationID, toolPartID }) => {
      enqueueStudioMediaThumbnails(generationID)
      const legacyID = `studio_${toolPartID}`
      const source = await loadStudioThumbnailSource({ generationID: legacyID, mediaIndex: 0 })
      expect(source.contentType).toBe("image/png")
      const saved = await saveStudioMediaThumbnail({
        generationID: legacyID,
        mediaIndex: 0,
        content: webp.toString("base64"),
      })
      expect(saved.thumbnailUrl).toContain(generationID)
      expect(Database.use((db) => db
        .select()
        .from(StudioMediaThumbnailTable)
        .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
        .get()?.status)).toBe("succeeded")
    })
  })

  test("keeps enqueue idempotent for the same generation and media index", async () => {
    await withGeneration(image, async ({ generationID }) => {
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(1)
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(0)
      expect(Database.use((db) => db
        .select()
        .from(StudioMediaThumbnailTable)
        .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
        .all().length)).toBe(1)
    })
  })

  test("requeues a legacy running task when the session is opened", async () => {
    await withGeneration(image, async ({ generationID, sessionID }) => {
      const now = Date.now()
      Database.use((db) => db.insert(StudioMediaThumbnailTable).values({
        id: Identifier.create("studio_thumb", "ascending"),
        generation_id: generationID,
        session_id: sessionID,
        directory: Instance.directory,
        media_index: 0,
        kind: "image",
        source_url: image,
        status: "running",
        attempts: 0,
        next_retry_at: 0,
        lease_owner: "dead-worker",
        lease_expires_at: now - 1,
        time_created: now,
        time_updated: now,
      }).run())
      await ensureStudioSessionThumbnails(sessionID)
      expect(Database.use((db) => db
        .select()
        .from(StudioMediaThumbnailTable)
        .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
        .get()?.status)).toBe("queued")
    })
  })

  test("requeues a ready thumbnail when its local file is missing", async () => {
    await withGeneration(image, async ({ generationID, sessionID }) => {
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(1)
      const thumbnailUrl = `.octo/${sessionID}/thumbnails/${generationID}-0.webp`
      Database.use((db) => {
        db.update(StudioGenerationTable)
          .set({
            result: {
              images: [{
                id: `${generationID}-0`,
                kind: "image",
                url: image,
                remoteUrl: image,
                thumbnailStatus: "ready",
                thumbnailUrl,
              }],
            },
          })
          .where(eq(StudioGenerationTable.id, generationID))
          .run()
        db.update(StudioMediaThumbnailTable)
          .set({ status: "succeeded", thumbnail_path: thumbnailUrl })
          .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
          .run()
      })

      await ensureStudioSessionThumbnails(sessionID)

      const generation = Database.use((db) =>
        db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get(),
      )
      const media = Array.isArray(generation?.result?.images) ? generation.result.images[0] : undefined
      expect(media).toMatchObject({ thumbnailStatus: "pending" })
      expect(media?.thumbnailUrl).toBeUndefined()
      expect(Database.use((db) =>
        db.select().from(StudioMediaThumbnailTable)
          .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
          .get(),
      )).toMatchObject({ status: "queued", thumbnail_path: null })
    })
  })

  test("invalid browser thumbnail never changes a succeeded generation", async () => {
    await withGeneration(image, async ({ generationID }) => {
      enqueueStudioMediaThumbnails(generationID)
      await expect(saveStudioMediaThumbnail({ generationID, mediaIndex: 0, content: "invalid" })).rejects.toThrow()
      expect(Database.use((db) => db
        .select()
        .from(StudioGenerationTable)
        .where(eq(StudioGenerationTable.id, generationID))
        .get()?.status)).toBe("succeeded")
    })
  })

  test("persists a browser WebP idempotently for video", async () => {
    await withGeneration("https://example.com/video.mp4", async ({ generationID }) => {
      const content = webp.toString("base64")
      const first = await saveStudioMediaThumbnail({ generationID, mediaIndex: 0, content })
      const second = await saveStudioMediaThumbnail({ generationID, mediaIndex: 0, content })
      expect(second.thumbnailUrl).toBe(first.thumbnailUrl)
      const generation = Database.use((db) => db
        .select()
        .from(StudioGenerationTable)
        .where(eq(StudioGenerationTable.id, generationID))
        .get())
      const media = generation?.result?.images
      expect(Array.isArray(media) ? media[0] : undefined).toMatchObject({
        thumbnailStatus: "ready",
        thumbnailUrl: first.thumbnailUrl,
      })
      expect(Database.use((db) => db
        .select()
        .from(StudioMediaThumbnailTable)
        .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
        .all().length)).toBe(1)
      expect(generation?.status).toBe("succeeded")
    }, "video")
  })

  test("keeps every media ready when thumbnails are saved concurrently", async () => {
    await withGeneration([image, image], async ({ generationID }) => {
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(2)
      const content = webp.toString("base64")
      const thumbnails = await Promise.all([
        saveStudioMediaThumbnail({ generationID, mediaIndex: 0, content }),
        saveStudioMediaThumbnail({ generationID, mediaIndex: 1, content }),
      ])
      const generation = Database.use((db) =>
        db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get(),
      )
      expect(generation?.result?.images).toMatchObject([
        { thumbnailStatus: "ready", thumbnailUrl: thumbnails[0].thumbnailUrl },
        { thumbnailStatus: "ready", thumbnailUrl: thumbnails[1].thumbnailUrl },
      ])
      expect(
        Database.use((db) =>
          db
            .select()
            .from(StudioMediaThumbnailTable)
            .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
            .all()
            .map((item) => item.status),
        ),
      ).toEqual(["succeeded", "succeeded"])
    })
  })
})
