import { type Component } from 'vue'
import type { AnyComponentNode, A2UIComponentProps } from '../processor/type'


interface Registration<T extends AnyComponentNode<any>> {
  component: Component
}

export class ComponentRegistry {
  private registry = new Map<string, Registration<AnyComponentNode<any>>>()
  private lazyCache = new Map<string, Component>()
  private static _instance: ComponentRegistry | null = null

  register<T extends AnyComponentNode<any>>(
    type: T['type'],
    registration: Registration<T>
  ): void {
    this.registry.set(type, registration as unknown as Registration<AnyComponentNode<any>>)
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










