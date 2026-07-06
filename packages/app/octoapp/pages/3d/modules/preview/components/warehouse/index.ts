import type { ComponentRegistry } from "../ComponentRegistry"
import { registerRack } from "./rack"
import { registerBookshelf } from "./bookshelf"
import { registerShowcase } from "./showcase"
import { registerPallet } from "./pallet"
import { registerBin } from "./bin"

export function registerWarehouseComponents(registry: ComponentRegistry): void {
  registerRack(registry)
  registerBookshelf(registry)
  registerShowcase(registry)
  registerPallet(registry)
  registerBin(registry)
}
