interface A2UIElement {
  id: string
  component: string
  props?: Record<string, unknown>
  children?: string[] | { path: string; componentId?: string }
}

interface A2UIModule {
  rootId: string
  elements: A2UIElement[]
  state?: Record<string, unknown>
}

function copyChildren(children: unknown): unknown {
  if (Array.isArray(children)) return [...(children as string[])]
  if (children && typeof children === "object") return { ...(children as Record<string, unknown>) }
  return children
}

export function mergeModules(shell: A2UIModule, modules: A2UIModule[]): A2UIModule {
  const elements = shell.elements.map((e) => ({
    ...e,
    props: e.props ? { ...e.props } : {},
    children: copyChildren(e.children) as string[] | undefined,
  }))
  const state = { ...(shell.state ?? {}) }

  for (const mod of modules) {
    const slotIndex = elements.findIndex((e) => e.id === mod.rootId)
    if (slotIndex === -1) continue

    const modRoot = mod.elements.find((e) => e.id === mod.rootId)
    if (modRoot?.children) {
      elements[slotIndex].children = copyChildren(modRoot.children) as string[]
    }

    for (const el of mod.elements) {
      if (el.id === mod.rootId) continue
      if (!elements.some((e) => e.id === el.id)) {
        elements.push({
          ...el,
          props: el.props ? { ...el.props } : {},
          children: copyChildren(el.children) as string[] | undefined,
        })
      }
    }

    if (mod.state) {
      Object.assign(state, mod.state)
    }
  }

  return { rootId: shell.rootId, elements, state }
}
