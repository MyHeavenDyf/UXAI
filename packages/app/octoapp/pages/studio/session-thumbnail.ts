import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { batch, createSignal } from "solid-js"
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

  // Serialize loads: a session-list update that arrives while a load is in
  // flight is queued and processed once, instead of running concurrent fetches
  // that fight over the `loading` signal and flicker the sidebar placeholder.
  let loadingInFlight = false
  let pendingSessions: Session[] | undefined

  // Track sessions whose thumbnail was recently set directly (via setThumbnail),
  // to prevent loadThumbnails from overwriting them with stale message data
  // before the server-side message persistence catches up.
  const recentlySet = new Set<string>()
  const recentlySetTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Track sessions already probed with no thumbnail for a given `time.updated`,
  // so unchanged sessions are not re-fetched (and `loading` not toggled) on
  // every unrelated list update.
  const probedMisses = new Map<string, number>()

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
    clearTimeout(recentlySetTimers.get(sessionID))
    recentlySetTimers.set(
      sessionID,
      setTimeout(() => { recentlySet.delete(sessionID); recentlySetTimers.delete(sessionID) }, 30_000),
    )
    const commit = () => {
      if (!shouldReplaceSessionThumbnail(persistedThumbnails[sessionID], generationAt)) return
      probedMisses.delete(sessionID)
      if (persistedThumbnails[sessionID]?.url === url) return
      setPersistedThumbnails(sessionID, {
        url,
        updatedAt: Date.now(),
        generationAt,
        kind,
        fallback,
      })
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
    clearTimeout(recentlySetTimers.get(sessionID))
    recentlySetTimers.delete(sessionID)
    probedMisses.delete(sessionID)
    setPersistedThumbnails(
      produce((draft: ThumbnailMap) => {
        delete draft[sessionID]
      }),
    )
  }

  async function loadThumbnails(sessions: Session[]) {
    if (loadingInFlight) {
      pendingSessions = sessions
      return
    }
    loadingInFlight = true
    try {
      await loadThumbnailsOnce(sessions)
    } finally {
      loadingInFlight = false
      const next = pendingSessions
      pendingSessions = undefined
      if (next) void loadThumbnails(next)
    }
  }

  async function loadThumbnailsOnce(sessions: Session[]) {
    const dir = input.dir()
    if (!dir || sessions.length === 0) return

    // Filter out sessions whose thumbnails are already up-to-date,
    // and skip sessions that were recently updated directly via setThumbnail
    const stale = sessions.filter((s) => {
      if (recentlySet.has(s.id)) return false
      const entry = persistedThumbnails[s.id]
      if (!entry || !normalizeThumbnail(entry.url, entry.fallback === true)) {
        // Already probed this revision and found nothing — don't refetch on
        // every unrelated list update (which would toggle `loading`).
        return probedMisses.get(s.id) !== (s.time.updated ?? 0)
      }
      if (entry.generationAt === undefined) return true
      return (s.time.updated ?? 0) > entry.updatedAt
    })

    if (stale.length === 0) return

    setLoading(true)

    // Use the default client (same as the rest of the app) to avoid any
    // potential issues with per-call client creation
    const client = input.globalSDK.client

    // Track sessions that had no image for delayed retry (message persistence may lag)
    const retrySessionIDs: string[] = []

    // Process in batches of 5 to avoid overwhelming the API
    const BATCH_SIZE = 5
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batchSessions = stale.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batchSessions.map(async (session) => {
          try {
            const result = await client.session.messages({
              sessionID: session.id,
            })
            const items = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
            const media = extractFirstMediaFromMessages(items)
            const fallback = Boolean(media && !isStudioThumbnailUrl(media.url))
            const url = normalizeThumbnail(media?.url, fallback)
            if (media && url && shouldReplaceSessionThumbnail(persistedThumbnails[session.id], media.generationAt)) {
              return { sessionID: session.id, url, updatedAt: session.time.updated ?? Date.now(), generationAt: media.generationAt, kind: media?.kind, fallback } as const
            } else {
              retrySessionIDs.push(session.id)
              probedMisses.set(session.id, session.time.updated ?? 0)
            }
          } catch (err) {
            console.error(`[Thumbnail] Failed to load thumbnail for session ${session.id}`, err)
          }
        }),
      )
      batch(() => {
        for (const result of results) {
          if (result.status !== "fulfilled" || !result.value) continue
          const { sessionID, url, updatedAt, generationAt, kind, fallback } = result.value
          if (persistedThumbnails[sessionID]?.url === url) continue
          setPersistedThumbnails(sessionID, { url, updatedAt, generationAt, kind, fallback })
        }
      })
    }

    setLoading(false)

    // Delayed retry for sessions whose messages may not have been persisted yet.
    // This handles the race where session.updated fires before message storage commits.
    if (retrySessionIDs.length > 0) {
      setTimeout(async () => {
        const retryResults = await Promise.allSettled(
          retrySessionIDs.map(async (sessionID) => {
            try {
              const result = await client.session.messages({ sessionID })
              const items = (result.data ?? []) as Array<{ info: Message; parts: Part[] }>
              const media = extractFirstMediaFromMessages(items)
              const fallback = Boolean(media && !isStudioThumbnailUrl(media.url))
              const url = normalizeThumbnail(media?.url, fallback)
              if (media && url && shouldReplaceSessionThumbnail(persistedThumbnails[sessionID], media.generationAt)) {
                return { sessionID, url, kind: media?.kind, fallback, generationAt: media.generationAt } as const
              }
            } catch (err) {
              console.error(`[Thumbnail] Retry failed for session ${sessionID}`, err)
            }
          }),
        )
        batch(() => {
          for (const result of retryResults) {
            if (result.status !== "fulfilled" || !result.value) continue
            const { sessionID, url } = result.value
            probedMisses.delete(sessionID)
            if (persistedThumbnails[sessionID]?.url === url) continue
            setPersistedThumbnails(sessionID, {
              url,
              updatedAt: Date.now(),
              generationAt: result.value.generationAt,
              kind: result.value.kind,
              fallback: result.value.fallback,
            })
          }
        })
      }, 3000)
    }
  }

  return {
    thumbnails: persistedThumbnails,
    loading,
    ready,
    setThumbnail,
    removeThumbnail,
    loadThumbnails,
  }
}
