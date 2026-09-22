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
  prepareStudioThumbnailMedia,
  runStudioMediaThumbnailWorkerOnce,
  saveStudioVideoPoster,
  STUDIO_THUMBNAIL_TARGET_DPR,
  studioThumbnailAddressAllowed,
  studioThumbnailContentTypeAllowed,
  studioThumbnailResponseBytes,
  studioThumbnailDimensions,
} from "../../src/studio/studio-media-thumbnail"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lbMcWQAAAABJRU5ErkJggg=="

async function waitFor<T>(read: () => T, accept: (value: T) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = read()
    if (accept(value)) return value
    await Bun.sleep(10)
  }
  throw new Error("Timed out waiting for Studio thumbnail task state.")
}

async function withGeneration(
  source: string,
  run: (input: { generationID: string; sessionID: SessionID }) => Promise<void> | void,
  kind: "image" | "video" = "image",
) {
  await using directory = await tmpdir()
  await provideTestInstance({
    directory: directory.path,
    fn: async () => {
      const now = Date.now()
      const sessionID = SessionID.descending()
      const generationID = Identifier.create("studio_gen", "ascending")
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
            tool_part_id: PartID.ascending(),
            provider: "internel",
            capability: "image.generate",
            status: "succeeded",
            progress: 100,
            request: {},
            result: {
              images: [
                {
                  id: `${generationID}-0`,
                  kind,
                  url: source,
                  remoteUrl: source,
                  thumbnailStatus: "pending",
                },
              ],
            },
            next_poll_at: Number.MAX_SAFE_INTEGER,
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      await Promise.resolve(run({ generationID, sessionID })).finally(() => {
        Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
      })
    },
  })
}

describe("Studio media thumbnails", () => {
  test("uses the documented target pixel density", () => {
    expect(STUDIO_THUMBNAIL_TARGET_DPR).toBe(1.5)
  })

  test("does not enlarge a 250px source", () => {
    expect(studioThumbnailDimensions(250, 250)).toEqual({ width: 250, height: 250 })
  })

  test("sizes common and extreme ratios from the display bounds", () => {
    expect(studioThumbnailDimensions(1920, 1080)).toEqual({ width: 560, height: 315 })
    expect(studioThumbnailDimensions(2048, 2048)).toEqual({ width: 315, height: 315 })
    expect(studioThumbnailDimensions(4000, 500)).toEqual({ width: 630, height: 79 })
  })

  test("queues images and leaves videos pending for browser poster capture", () => {
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

  test("keeps an exhausted image job failed when an old session is reopened", () => {
    expect(
      prepareStudioThumbnailMedia([
        { id: "image", kind: "image", url: "https://example.com/image.png", thumbnailStatus: "failed" },
      ])[0]?.thumbnailStatus,
    ).toBe("failed")
  })

  test("does not trust a remote URL as an already materialized thumbnail", () => {
    expect(
      prepareStudioThumbnailMedia([
        {
          id: "image",
          kind: "image",
          url: "https://example.com/original.png",
          thumbnailUrl: "https://example.com/provider-thumbnail.png",
          thumbnailStatus: "ready",
        },
      ])[0],
    ).toMatchObject({ thumbnailUrl: undefined, thumbnailStatus: "pending" })
  })

  test("rejects private addresses and non-image response types", () => {
    expect(studioThumbnailAddressAllowed("127.0.0.1")).toBe(false)
    expect(studioThumbnailAddressAllowed("192.168.1.20")).toBe(false)
    expect(studioThumbnailAddressAllowed("::1")).toBe(false)
    expect(studioThumbnailAddressAllowed("2001:db8::1")).toBe(false)
    expect(studioThumbnailAddressAllowed("8.8.8.8")).toBe(true)
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

  test("keeps enqueue idempotent for the same generation and media index", async () => {
    await withGeneration(image, async ({ generationID }) => {
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(1)
      expect(enqueueStudioMediaThumbnails(generationID)).toBe(0)
      expect(
        Database.use(
          (db) =>
            db
              .select()
              .from(StudioMediaThumbnailTable)
              .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
              .all().length,
        ),
      ).toBe(1)
    })
  })

  test("reclaims an expired running lease and reuses the single task row", async () => {
    await withGeneration(image, async ({ generationID, sessionID }) => {
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(StudioMediaThumbnailTable)
          .values({
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
          })
          .run(),
      )
      await runStudioMediaThumbnailWorkerOnce()
      expect(
        Database.use(
          (db) =>
            db
              .select()
              .from(StudioMediaThumbnailTable)
              .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
              .get()?.status,
        ),
      ).toBe("succeeded")
    })
  })

  test("thumbnail failure never changes a succeeded generation", async () => {
    await withGeneration("https://example.com/not-allowed.png", async ({ generationID }) => {
      enqueueStudioMediaThumbnails(generationID)
      for (const attempt of [1, 2, 3]) {
        await waitFor(
          () =>
            Database.use((db) =>
              db
                .select()
                .from(StudioMediaThumbnailTable)
                .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
                .get(),
            ),
          (task) => task?.status === (attempt === 3 ? "failed" : "queued") && task.attempts === attempt,
        )
        if (attempt === 3) break
        Database.use((db) =>
          db
            .update(StudioMediaThumbnailTable)
            .set({ next_retry_at: 0 })
            .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
            .run(),
        )
        await runStudioMediaThumbnailWorkerOnce()
      }
      expect(
        Database.use(
          (db) =>
            db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get()?.status,
        ),
      ).toBe("succeeded")
    })
  })

  test("persists a video poster idempotently without creating an image thumbnail task", async () => {
    await withGeneration("https://example.com/video.mp4", async ({ generationID }) => {
      const content = image.split(",")[1]!
      const first = await saveStudioVideoPoster({ generationID, mediaIndex: 0, content })
      const second = await saveStudioVideoPoster({ generationID, mediaIndex: 0, content })
      expect(second.thumbnailUrl).toBe(first.thumbnailUrl)
      const generation = Database.use((db) =>
        db.select().from(StudioGenerationTable).where(eq(StudioGenerationTable.id, generationID)).get(),
      )
      const media = generation?.result?.images
      expect(Array.isArray(media) ? media[0] : undefined).toMatchObject({
        thumbnailStatus: "ready",
        thumbnailUrl: first.thumbnailUrl,
      })
      expect(
        Database.use(
          (db) =>
            db
              .select()
              .from(StudioMediaThumbnailTable)
              .where(eq(StudioMediaThumbnailTable.generation_id, generationID))
              .all().length,
        ),
      ).toBe(0)
      expect(generation?.status).toBe("succeeded")
    }, "video")
  })
})
