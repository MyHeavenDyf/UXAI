import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { persisted, Persist } from "@/utils/persist"
import { parseToolImages, parseToolAttachments } from "./turns"

export type ThumbnailEntry = { url: string; updatedAt: number }
export type ThumbnailMap = Record<string, ThumbnailEntry>

function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

/**
 * Extract the first image URL from the latest successful generation in a session's messages.
 * Searches all assistant messages (newest first) for completed tool parts with images.
 * Returns undefined if no image is found.
 */
export function extractFirstImageFromMessages(
  items: Array<{ info: Message; parts: Part[] }>,
): string | undefined {
  // Sort messages by creation time descending (newest first)
  const sorted = [...items].sort((a, b) => b.info.time.created - a.info.time.created)

  // Search all assistant messages (not just the latest) for robustness
  const assistantMessages = sorted.filter((m) => m.info.role === "assistant")

  for (const msg of assistantMessages) {
    const tools = msg.parts.filter(isToolPart)

    // Find completed tool parts with images, newest first
    const completed = [...tools]
      .reverse()
      .find((part) => {
        if (part.state.status !== "completed") return false
        const state = part.state
        return parseToolAttachments(part).length > 0 || parseToolImages(state.output).length > 0
      })

    if (!completed) continue

    const attachments = parseToolAttachments(completed)
    if (attachments.length > 0) {
      // Prefer non-video attachments for sidebar thumbnail
      const img = attachments.find((a) => a.kind !== "video") ?? attachments[0]
      return img.url
    }

    const images = parseToolImages((completed.state as { output: string }).output)
    if (images.length > 0) return images[0]
  }

  return undefined
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

  function setThumbnail(sessionID: string, url: string) {
    recentlySet.add(sessionID)
    // Auto-clear after 30s so future genuine updates aren't blocked
    setTimeout(() => recentlySet.delete(sessionID), 30_000)
    setPersistedThumbnails(sessionID, { url, updatedAt: Date.now() })
    setVersion((v) => v + 1)
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
      if (!entry) return true
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
            const url = extractFirstImageFromMessages(items)
            if (url) {
              console.log(`[Thumbnail] Found thumbnail for session ${session.id}: ${url.substring(0, 80)}...`)
              setPersistedThumbnails(session.id, {
                url,
                updatedAt: session.time.updated ?? Date.now(),
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
            const url = extractFirstImageFromMessages(items)
            if (url) {
              console.log(`[Thumbnail] Retry found thumbnail for session ${sessionID}`)
              setPersistedThumbnails(sessionID, { url, updatedAt: Date.now() })
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
