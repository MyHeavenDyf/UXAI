export type CustomBridge = {
  script: string
  style?: string
  position?: 'head' | 'body'
}

const CUSTOM_BRIDGES = new Map<string, CustomBridge>()

export function registerCustomBridge(id: string, bridge: CustomBridge) {
  if (CUSTOM_BRIDGES.has(id)) {
    console.warn(`[CustomBridgeRegistry] Bridge "${id}" already registered, overwriting`)
  }
  CUSTOM_BRIDGES.set(id, bridge)
}

export function getCustomBridge(id: string): CustomBridge | undefined {
  return CUSTOM_BRIDGES.get(id)
}

export function getRegisteredBridges(): string[] {
  return Array.from(CUSTOM_BRIDGES.keys())
}