import { useServer } from "@/context/server"
import { useLayout } from "@/context/layout"
import { unwrap } from "solid-js/store"
import { createEffect, createSignal, type Accessor } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

export type ProjectSelection = {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
}

interface Options {
  keepFrozen?: Accessor<boolean>
}

export function useProjectSelection(options: Options = {}) {
  const server = useServer()
  const layout = useLayout()
  const [frozen, setFrozen] = createSignal<ProjectSelection | undefined>(undefined)

  createEffect(() => {
    if (layout.onboarding.show() || options.keepFrozen?.()) {
      if (!frozen()) setFrozen(unwrap(server.projects.lastSelection()) as ProjectSelection)
      return
    }
    setFrozen(undefined)
  })

  return () => frozen() ?? server.projects.lastSelection()
}
