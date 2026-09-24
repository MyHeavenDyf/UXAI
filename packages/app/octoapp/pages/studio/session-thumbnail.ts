import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { parseToolAttachments, parseToolImages, parseToolMedia, parseToolVideos } from "./turns"
import {
  isStudioThumbnailUrl,
  originalMediaSrc,
  resolveStudioThumbnailUrl,
  studioThumbnailStorageValue,
  thumbnailMediaSrc,
} from "./studio-media"

export type ThumbnailEntry = {
  url: string
  updatedAt: number
  generationAt?: number
  fallback?: boolean
  kind?: "image" | "video"
}
export type ThumbnailMap = Record<string, ThumbnailEntry>

export function shouldReplaceSessionThumbnail(current: ThumbnailEntry | undefined, generationAt?: number) {
  if (generationAt === undefined || current?.generationAt === undefined) return true
  return generationAt >= current.generationAt
}

export function sessionThumbnailUsesVideoElement(entry?: ThumbnailEntry) {
  return entry?.kind === "video" && !isStudioThumbnailUrl(entry.url)
}

function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

export function extractStudioThumbnailMedia(
  part: Extract<Part, { type: "tool" }>,
): { url: string; kind: "image" | "video" } | undefined {
  if (part.state.status !== "completed") return
  const media = parseToolMedia(part.state.output)
  const selected = media.find((item) => item.kind !== "video") ?? media[0]
  if (selected) {
    const url = thumbnailMediaSrc(selected) ?? originalMediaSrc(selected)
    return { url, kind: selected.kind === "video" ? "video" : "image" }
  }
  const attachments = parseToolAttachments(part)
  const attachment = attachments.find((item) => item.kind !== "video") ?? attachments[0]
  if (attachment) return { url: attachment.url, kind: attachment.kind === "video" ? "video" : "image" }
  const legacy = parseToolImages(part.state.output)[0]
  if (legacy) return { url: legacy, kind: "image" }
  const video = parseToolVideos(part.state.output)[0]
  if (video) return { url: video, kind: "video" }
}

/**
 * Extract a local thumbnail when ready, otherwise keep showing the original image until the thumbnail replaces it.
 */
function extractFirstMediaFromMessages(
  items: Array<{ info: Message; parts: Part[] }>,
): { url: string; kind: "image" | "video"; generationAt: number } | undefined {
  // Sort messages by creation time descending (newest first)
  const sorted = [...items].sort((a, b) => b.info.time.created - a.info.time.created)

  // Search all assistant messages (not just the latest) for robustness
  const assistantMessages = sorted.filter((m) => m.info.role === "assistant")

  for (const msg of assistantMessages) {
    const tools = msg.parts.filter(isToolPart)

    for (const part of [...tools].reverse()) {
      const media = extractStudioThumbnailMedia(part)
      if (media) {
        const generationAt = part.state.status === "completed" ? part.state.time.start : msg.info.time.created
        return { ...media, generationAt }
      }
    }
  }

  return undefined
}

export function extractFirstImageFromMessages(items: Array<{ info: Message; parts: Part[] }>) {
  return extractFirstMediaFromMessages(items)?.url
}

/**
 * Creates a reactive, localStorage-persisted store for session thumbnails.
 *
 * Usage:
 *   const store = createSessionThumbnailStore({ dir, globalSDK })
 *   store.loadThumbnails(sessions)  // batch-fetch for a list of sessions
 *   store.setThumbnail(id, url)     // update a single thumbnail (e.g. after generation)
 *   store.removeThumbnail(id)       // clean up on session deletion
 */
export function createSessionThumbnailStore(input: {
  dir: () => string
  globalSDK: {
    url: string
    client: { session: { messages: (params: { sessionID: string }) => Promise<{ data?: Array<{ info: Message; parts: Part[] }> }> } }
    createClient: (opts: { directory: string }) => { session: { messages: (params: { sessionID: string }) => Promise<{ data?: Array<{ info: Message; parts: Part[] }> }> } }
  }
}) {
  const [thumbnails, setThumbnails] = createStore<ThumbnailMap>({})
  const [persistedThumbnails, setPersistedThumbnails, , ready] = persisted(
    Persist.workspace(input.dir(), "studio.thumbnails"),
    [thumbnails, setThumbnails],
  )

  const [loading, setLoading] = createSignal(false)
  // Version counter — incremented on every setThumbnail so the sidebar can reactively re-render
  const [version, setVersion] = createSignal(0)

  // Track sessions whose thumbnail was recently set directly (via setThumbnail),
  // to prevent loadThumbnails from overwriting them with stale message data
  // before the server-side message persistence catches up.
  const recentlySet = new Set<string>()

  function normalizeThumbnail(url?: string, allowOriginal = false): string | undefined {
    if (!isStudioThumbnailUrl(url) && !allowOriginal) return undefined
    return studioThumbnailStorageValue(url)
  }

  function displayThumbnail(url?: string) {
    return resolveStudioThumbnailUrl({ value: url, sdkUrl: input.globalSDK.url, directory: input.dir() })
  }

  function setThumbnail(
    sessionID: string,
    value?: string,
    kind: "image" | "video" = "image",
    generationAt?: number,
  ) {
    const fallback = Boolean(value && !isStudioThumbnailUrl(value))
    const url = normalizeThumbnail(value, fallback)
    if (!url) return
    if (!shouldReplaceSessionThumbnail(persistedThumbnails[sessionID], generationAt)) return
    recentlySet.add(sessionID)
    // Auto-clear after 30s so future genuine updates aren't blocked
    setTimeout(() => recentlySet.delete(sessionID), 30_000)
    const commit = () => {
      if (!shouldReplaceSessionThumbnail(persistedThumbnails[sessionID], generationAt)) return
      setPersistedThumbnails(sessionID, {
        url,
        updatedAt: Date.now(),
        generationAt,
        kind,
        fallback,
      })
      setVersion((v) => v + 1)
    }
    const current = persistedThumbnails[sessionID]
    if (!fallback && current?.fallback && typeof Image !== "undefined") {
      const loader = new Image()
      loader.onload = commit
      loader.src = displayThumbnail(url) ?? url
      return
    }
    commit()
  }

  function removeThumbnail(sessionID: string) {
    recentlySet.delete(sessionID)
    setPersistedThumbnails(
      produce((draft: ThumbnailMap) => {
        delete draft[sessionID]
      }),
    )
  }

  async function loadThumbnails(sessions: Session[]) {
    const dir = input.dir()
    if (!dir || sessions.length === 0) return

    // Filter out sessions whose thumbnails are already up-to-date,
    // and skip sessions that were recently updated directly via setThumbnail
    const stale = sessions.filter((s) => {
      if (recentlySet.has(s.id)) return false
      const entry = persistedThumbnails[s.id]
      if (!entry || !normalizeThumbnail(entry.url, entry.fallback === true)) return true
      if (entry.generationAt === undefined) return true
      return (s.time.updated ?? 0) > entry.updatedAt
    })

    if (stale.length === 0) return

    console.log(`[Thumbnail] Loading thumbnails for ${stale.length} stale sessions (out of ${sessions.length} total)`)
    setLoading(true)

    // Use the default client (same as the rest of the app) to avoid any
    // potential issues with per-call client creation
    const client = input.globalSDK.client

    // Track sessions that had no image for delayed retry (message persistence may lag)
    const retrySessionIDs: string[] = []

    // Process in batches of 5 to avoid overwhelming the API
    const BATCH_SIZE = 5
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE)
      await Promise.allSettled(
        batch.map(async (session) => {
          try {
            const result = await client.session.messages({
              sessionID: session.id,
            })
            const items = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
            console.log(`[Thumbnail] Session ${session.id} has ${items.length} messages`)
            const media = extractFirstMediaFromMessages(items)
            const fallback = Boolean(media && !isStudioThumbnailUrl(media.url))
            const url = normalizeThumbnail(media?.url, fallback)
            if (media && url && shouldReplaceSessionThumbnail(persistedThumbnails[session.id], media.generationAt)) {
              console.log(`[Thumbnail] Found thumbnail for session ${session.id}: ${url.substring(0, 80)}...`)
              setPersistedThumbnails(session.id, {
                url,
                updatedAt: session.time.updated ?? Date.now(),
                generationAt: media.generationAt,
                kind: media?.kind,
                fallback,
              })
              setVersion((v) => v + 1)
            } else {
              console.log(`[Thumbnail] No image found in session ${session.id}, scheduling retry`)
              retrySessionIDs.push(session.id)
            }
          } catch (err) {
            console.error(`[Thumbnail] Failed to load thumbnail for session ${session.id}`, err)
          }
        }),
      )
    }

    setLoading(false)

    // Delayed retry for sessions whose messages may not have been persisted yet.
    // This handles the race where session.updated fires before message storage commits.
    if (retrySessionIDs.length > 0) {
      setTimeout(async () => {
        for (const sessionID of retrySessionIDs) {
          try {
            const result = await client.session.messages({ sessionID })
            const items = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
            const media = extractFirstMediaFromMessages(items)
            const fallback = Boolean(media && !isStudioThumbnailUrl(media.url))
            const url = normalizeThumbnail(media?.url, fallback)
            if (media && url && shouldReplaceSessionThumbnail(persistedThumbnails[sessionID], media.generationAt)) {
              console.log(`[Thumbnail] Retry found thumbnail for session ${sessionID}`)
              setPersistedThumbnails(sessionID, {
                url,
                updatedAt: Date.now(),
                generationAt: media.generationAt,
                kind: media?.kind,
                fallback,
              })
              setVersion((v) => v + 1)
            }
          } catch (err) {
            console.error(`[Thumbnail] Retry failed for session ${sessionID}`, err)
          }
        }
      }, 3000)
    }
  }

  return {
    thumbnails: persistedThumbnails,
    loading,
    version,
    ready,
    setThumbnail,
    removeThumbnail,
    loadThumbnails,
  }
}
