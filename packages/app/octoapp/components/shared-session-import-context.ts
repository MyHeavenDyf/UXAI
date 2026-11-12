import { createEffect, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import type { SharedSessionModule } from "./shared-session-open"

const [context, setContext] = createStore<{
  owner?: symbol
  module?: SharedSessionModule
  directory: string
  ready: boolean
}>({ directory: "", ready: false })

export const sharedSessionImportContext = context

/** Published from inside each page's actual SDK/Sync providers, not inferred from the URL alone. */
export function useSharedSessionImportContext(module: SharedSessionModule) {
  const sdk = useSDK()
  const sync = useSync()
  const owner = Symbol("share-import-context")
  createEffect(() => setContext({ owner, module, directory: sdk.directory, ready: sync.ready }))
  onCleanup(() => {
    if (context.owner === owner) setContext({ owner: undefined, module: undefined, directory: "", ready: false })
  })
}

/** Published by pages such as Studio that use the global SDK/sync stores directly. */
export function useSharedSessionImportDirectory(
  module: SharedSessionModule,
  directory: Accessor<string>,
  ready: Accessor<boolean>,
) {
  const owner = Symbol("share-import-directory")
  createEffect(() => setContext({ owner, module, directory: directory(), ready: ready() }))
  onCleanup(() => {
    if (context.owner === owner) setContext({ owner: undefined, module: undefined, directory: "", ready: false })
  })
}
