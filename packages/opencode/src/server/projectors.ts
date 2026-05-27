import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { getWithCategory } from "@/session/session-category-query"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as SyncEvent.Event<typeof import("@/session/session").Session.Event.Updated>["data"]).sessionID
        const info = getWithCategory(id)

        if (!info) return data

        return {
          sessionID: id,
          info,
        }
      }
      return data
    },
  })
}

initProjectors()
