import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { SKIP_PART_TYPES } from "./studio-shared"
import { isExpansionReasoning, mergePromptPart, promptMetadata } from "./studio-prompt-state"

export type DataStore = {
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
}

export function createStudioSessionData(input: {
  sessionID: () => string | undefined
  globalSDK: ReturnType<typeof import("@/context/global-sdk").useGlobalSDK>
}) {
  const [dataStore, setDataStore] = createStore<DataStore>({
    session: [],
    session_status: {},
    message: {},
    part: {},
  })
  const [snapshot, setSnapshot] = createStore<{ sessionID?: string }>({})
  let loadToken = 0
  const removedMessages = new Set<string>()
  const removedParts = new Set<string>()
  const removedSessions = new Set<string>()

  function loadSessionMessages(sessionID: string) {
    const token = ++loadToken
    return input.globalSDK.client.session
      .get({ sessionID })
      .then((result) => {
        if (token !== loadToken || sessionID !== input.sessionID() || removedSessions.has(sessionID)) return
        const session = result.data
        if (!session || session.agent !== "octo_studio") {
          batch(() => {
            setDataStore("message", {})
            setDataStore("part", {})
            setSnapshot("sessionID", undefined)
          })
          return
        }
        return input.globalSDK.client.session.messages({ sessionID }).then((msgResult) => {
          if (token !== loadToken || sessionID !== input.sessionID() || removedSessions.has(sessionID)) return
          const items = msgResult.data ?? []
          const messages: Message[] = []
          const partMap: { [messageID: string]: Part[] } = {}
          for (const item of items as { info: Message; parts: Part[] }[]) {
            if (removedMessages.has(item.info.id)) continue
            messages.push(item.info)
            partMap[item.info.id] = item.parts.filter((part) => !SKIP_PART_TYPES.has(part.type) && !removedParts.has(part.id))
              .map((part) => mergePromptPart(dataStore.part[item.info.id]?.find((old) => old.id === part.id), part))
          }
          // A recommendation event may already contain a newer turn than this snapshot.
          const current = dataStore.message[sessionID] ?? []
          const keep = new Set(current.flatMap((message) => {
            if (!(dataStore.part[message.id] ?? []).some((part) => promptMetadata(part))) return []
            return [message.id, ...(message.role === "assistant" ? [message.parentID] : [])]
          }))
          current.filter((message) => keep.has(message.id) && !removedMessages.has(message.id)).forEach((message) => {
            if (!messages.some((item) => item.id === message.id)) messages.push(message)
            const old = dataStore.part[message.id] ?? []
            const next = partMap[message.id] ?? []
            partMap[message.id] = [...next, ...old.filter((part) => !removedParts.has(part.id) && !next.some((item) => item.id === part.id))]
              .sort((a, b) => a.id.localeCompare(b.id))
          })
          messages.sort((a, b) => a.id.localeCompare(b.id))
          batch(() => {
            setDataStore("message", sessionID, reconcile(messages, { key: "id" }))
            for (const [messageID, parts] of Object.entries(partMap)) {
              setDataStore("part", messageID, reconcile(parts, { key: "id" }))
            }
            setSnapshot("sessionID", sessionID)
          })
        })
      })
  }

  createEffect(
    on(input.sessionID, (id) => {
      setSnapshot("sessionID", undefined)
      if (!id) {
        batch(() => {
          setDataStore("message", {})
          setDataStore("part", {})
        })
        return
      }
      loadSessionMessages(id)
        .catch((error) => console.error("[StudioPage] messages load failed", error))
    }),
  )

  const unsub = input.globalSDK.event.listen((event) => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    const payload = event.details

    if (payload.type === "message.removed" && payload.properties.sessionID === sessionID) {
      removedMessages.add(payload.properties.messageID)
      setDataStore("message", sessionID, (messages) => (messages ?? []).filter((message) => message.id !== payload.properties.messageID))
      setDataStore("part", payload.properties.messageID, [])
      return
    }
    if (payload.type === "message.part.removed" && payload.properties.sessionID === sessionID) {
      removedParts.add(payload.properties.partID)
      setDataStore("part", payload.properties.messageID, (parts) => (parts ?? []).filter((part) => part.id !== payload.properties.partID))
      return
    }
    if (payload.type === "session.deleted" && payload.properties.info.id === sessionID) {
      removedSessions.add(sessionID)
      setSnapshot("sessionID", undefined)
      loadToken++
      setDataStore("message", sessionID, [])
      return
    }

    if (payload.type === "message.updated") {
      const info = payload.properties.info
      if (info.sessionID !== sessionID) return
      if (removedSessions.has(sessionID) || removedMessages.has(info.id)) return
      const messages = dataStore.message[sessionID]
      if (!messages) {
        setDataStore("message", sessionID, [info])
        return
      }
      const result = Binary.search(messages, info.id, (message: Message) => message.id)
      if (result.found) {
        setDataStore("message", sessionID, result.index, reconcile(info))
        return
      }
      setDataStore("message", sessionID, produce((draft) => { draft.splice(result.index, 0, info) }))
      return
    }

    if (payload.type === "message.part.updated") {
      const part = payload.properties.part
      if (part.sessionID !== sessionID || SKIP_PART_TYPES.has(part.type)) return
      if (removedSessions.has(sessionID) || removedParts.has(part.id) || removedMessages.has(part.messageID)) return
      const parts = dataStore.part[part.messageID]
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }
      const result = Binary.search(parts, part.id, (item: Part) => item.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(mergePromptPart(parts[result.index], part)))
        return
      }
      setDataStore("part", part.messageID, produce((draft) => { draft.splice(result.index, 0, part) }))
      return
    }

    if (payload.type === "session.status") {
      const { sessionID: nextSessionID, status: nextStatus } = payload.properties
      if (nextSessionID !== sessionID) return
      setDataStore("session_status", nextSessionID, reconcile(nextStatus))
      return
    }

    const raw = payload as unknown as { type: string; properties: Record<string, unknown> }
    if (raw.type !== "message.part.delta") return
    const props = raw.properties as { sessionID: string; messageID: string; partID: string; field: string; delta: string }
    const parts = dataStore.part[props.messageID]
    if (!parts) return
    const result = Binary.search(parts, props.partID, (part: Part) => part.id)
    if (!result.found) return
    const current = parts[result.index]
    if (isExpansionReasoning(current) &&
      (props.sessionID !== sessionID || props.field !== "text" ||
        removedSessions.has(sessionID) || removedMessages.has(props.messageID) || removedParts.has(props.partID) ||
        current.time.end !== undefined)) return
    setDataStore("part", props.messageID, produce((draft) => {
      const part = draft[result.index] as Record<string, unknown>
      part[props.field] = `${part[props.field] ?? ""}${props.delta}`
    }))
  })
  onCleanup(unsub)

  const sessionStatus = createMemo(() => {
    const id = input.sessionID()
    if (!id) return { type: "idle" } as SessionStatus
    return dataStore.session_status[id] ?? ({ type: "idle" } as SessionStatus)
  })

  return {
    dataStore,
    loadSessionMessages,
    sessionStatus,
    snapshotReady: () => Boolean(input.sessionID() && snapshot.sessionID === input.sessionID()),
  }
}
