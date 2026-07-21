import { type Component } from 'vue'


interface Registration {
  component: Component
}

export class ComponentRegistry {
  private registry = new Map<string, Registration>()
  private lazyCache = new Map<string, Component>()
  private static _instance: ComponentRegistry | null = null

  register(
    type: string,
    registration: Registration
  ): void {
    this.registry.set(type, registration)
  }

  get(type: string): Component | null {
    const registration = this.registry.get(type)
    if (!registration) return null
    return registration.component
  }

  has(type: string): boolean {
    return this.registry.has(type)
  }

  unregister(type: string): void {
    this.registry.delete(type)
    this.lazyCache.delete(type)
  }

  static getInstance(): ComponentRegistry {
    if (!ComponentRegistry._instance) {
      ComponentRegistry._instance = new ComponentRegistry();
    }
    return ComponentRegistry._instance;
  }


  static resetInstance(): void {
    ComponentRegistry._instance = null;
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.registry.keys());
  }

  clear(): void {
    this.registry.clear();
  }
}










