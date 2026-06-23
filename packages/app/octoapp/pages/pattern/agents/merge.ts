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

interface SlotEntry {
  section_id: string
  element_id: string
}

export function mergeModules(shell: A2UIModule, modules: A2UIModule[], slots?: SlotEntry[]): A2UIModule {
  const elements = shell.elements.map((e) => ({
    ...e,
    props: e.props ? { ...e.props } : {},
    children: copyChildren(e.children) as string[] | undefined,
  }))
  const state = { ...(shell.state ?? {}) }

  // 构建 module rootId → shell element_id 的映射
  const rootIdRemap = new Map<string, string>()
  if (slots && modules.length === slots.length) {
    for (let i = 0; i < modules.length; i++) {
      if (modules[i].rootId !== slots[i].element_id) {
        rootIdRemap.set(modules[i].rootId, slots[i].element_id)
      }
    }
  }

  for (const mod of modules) {
    const originalRootId = mod.rootId
    const remappedId = rootIdRemap.get(originalRootId) ?? originalRootId
    let slotIndex = elements.findIndex((e) => e.id === originalRootId)
    if (slotIndex === -1) {
      slotIndex = elements.findIndex((e) => e.id === remappedId)
    }
    if (slotIndex === -1) continue

    const modRoot = mod.elements.find((e) => e.id === originalRootId)
    if (modRoot?.children) {
      elements[slotIndex].children = copyChildren(modRoot.children) as string[]
    }

    for (const el of mod.elements) {
      if (el.id === originalRootId) continue
      const existing = elements.findIndex((e) => e.id === el.id)
      if (existing !== -1) {
        elements[existing] = {
          ...el,
          props: el.props ? { ...el.props } : {},
          children: copyChildren(el.children) as string[] | undefined,
        }
      } else {
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
