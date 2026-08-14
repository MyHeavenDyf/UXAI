import type { JSX } from "solid-js"

type ComponentRenderer = (props: any) => JSX.Element

class SubtypeUIRegistry {
  private components = new Map<string, Map<string, ComponentRenderer>>()
  
  register(subtype: string, componentId: string, renderer: ComponentRenderer) {
    if (!this.components.has(subtype)) {
      this.components.set(subtype, new Map())
    }
    this.components.get(subtype)!.set(componentId, renderer)
  }
  
  get(subtype: string, componentId: string): ComponentRenderer | undefined {
    return this.components.get(subtype)?.get(componentId)
  }
  
  has(subtype: string, componentId: string): boolean {
    return this.components.get(subtype)?.has(componentId) ?? false
  }
  
  registerAll(subtype: string, components: Record<string, ComponentRenderer>) {
    Object.entries(components).forEach(([id, renderer]) => {
      this.register(subtype, id, renderer)
    })
  }
}

export const subtypeUIRegistry = new SubtypeUIRegistry()

export function registerSubtypeUI(subtype: string, components: Record<string, ComponentRenderer>) {
  subtypeUIRegistry.registerAll(subtype, components)
}