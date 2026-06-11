import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@opencode-ai/core/util/binary"
import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { SKIP_PART_TYPES } from "./studio-shared"

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

  function loadSessionMessages(sessionID: string) {
    return input.globalSDK.client.session
      .get({ sessionID })
      .then((result) => {
        const session = result.data
        if (!session || session.agent !== "octo_studio") {
          batch(() => {
            setDataStore("message", {})
            setDataStore("part", {})
          })
          return
        }
        return input.globalSDK.client.session.messages({ sessionID }).then((msgResult) => {
          const items = msgResult.data ?? []
          const messages: Message[] = []
          const partMap: { [messageID: string]: Part[] } = {}
          for (const item of items as { info: Message; parts: Part[] }[]) {
            messages.push(item.info)
            partMap[item.info.id] = item.parts.filter((part) => !SKIP_PART_TYPES.has(part.type))
          }
          batch(() => {
            setDataStore("message", sessionID, reconcile(messages, { key: "id" }))
            for (const [messageID, parts] of Object.entries(partMap)) {
              setDataStore("part", messageID, reconcile(parts, { key: "id" }))
            }
          })
        })
      })
  }

  createEffect(
    on(input.sessionID, (id) => {
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

    if (payload.type === "message.updated") {
      const info = payload.properties.info
      if (info.sessionID !== sessionID) return
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
      const parts = dataStore.part[part.messageID]
      if (!parts) {
        setDataStore("part", part.messageID, [part])
        return
      }
      const result = Binary.search(parts, part.id, (item: Part) => item.id)
      if (result.found) {
        setDataStore("part", part.messageID, result.index, reconcile(part))
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
    const props = raw.properties as { messageID: string; partID: string; field: string; delta: string }
    const parts = dataStore.part[props.messageID]
    if (!parts) return
    const result = Binary.search(parts, props.partID, (part: Part) => part.id)
    if (!result.found) return
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

  return { dataStore, loadSessionMessages, sessionStatus }
}
