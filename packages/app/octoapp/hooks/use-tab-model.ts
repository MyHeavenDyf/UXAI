import { createEffect, on } from "solid-js"
import { useParams } from "@solidjs/router"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import type { ModelKey } from "@/context/local"

type TabName = "insight" | "make" | "chat" | "pattern"

const tabKey = (tab: TabName, dir: string) => `octo:tab-model:${tab}:${dir}`

function readTabModel(tab: TabName, dir: string): ModelKey | undefined {
  try {
    const raw = localStorage.getItem(tabKey(tab, dir))
    if (!raw) return undefined
    return JSON.parse(raw) as ModelKey
  } catch {
    return undefined
  }
}

function writeTabModel(tab: TabName, dir: string, model: ModelKey | undefined) {
  if (model) {
    localStorage.setItem(tabKey(tab, dir), JSON.stringify(model))
  } else {
    localStorage.removeItem(tabKey(tab, dir))
  }
}

/**
 * Per-tab model selection persistence.
 *
 * - Mount in draft → restore from tab key
 * - Mount in session → skip (don't contaminate from other tabs)
 * - Session → session → write session model to tab key (so next draft inherits it)
 * - Session → draft → restore from tab key
 * - User selects model → write to tab key
 */
export function useTabModel(tab: TabName) {
  const local = useLocal()
  const sdk = useSDK()
  const params = useParams<{ id?: string }>()

  let userInitiated = false
  let prevParamsId: string | undefined = undefined

  createEffect(
    on(
      () => [sdk.directory, params.id] as const,
      ([dir, id]) => {
        if (!dir) return

        const wasSession = prevParamsId !== undefined
        const isSession = id !== undefined
        prevParamsId = id

        // Session → session: sync session model to tab key.
        if (wasSession && isSession) {
          const current = local.model.current()
          if (current) {
            writeTabModel(tab, dir, {
              providerID: current.provider.id,
              modelID: current.id,
            })
          }
          return
        }

        // Mount in session: skip.
        if (!wasSession && isSession) {
          return
        }

        // Draft mode: restore from tab key.
        const saved = readTabModel(tab, dir)
        if (saved) {
          local.model.set(saved)
        } else {
          local.model.set(undefined)
        }
      },
    ),
  )

  // Persist user-initiated model selections to tab key.
  createEffect(
    on(
      () => local.model.current(),
      (model) => {
        if (!userInitiated) return
        userInitiated = false
        const dir = sdk.directory
        if (!dir) return
        if (model) {
          writeTabModel(tab, dir, {
            providerID: model.provider.id,
            modelID: model.id,
          })
        } else {
          writeTabModel(tab, dir, undefined)
        }
      },
    ),
  )

  // Patch local.model.set to detect user-initiated selections.
  const origSet = local.model.set.bind(local.model)
  local.model.set = (item, options) => {
    if (options?.recent) userInitiated = true
    return origSet(item, options)
  }
}
