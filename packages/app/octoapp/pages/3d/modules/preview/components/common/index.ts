import type { ComponentRegistry } from "../ComponentRegistry"
import { registerDesk } from "./desk"
import { registerCabinet } from "./cabinet"
import { registerPartition } from "./partition"
import { registerSignage } from "./signage"
import { registerCommonModelComponents } from "./model"

export function registerCommonComponents(registry: ComponentRegistry): void {
  registerDesk(registry)
  registerCabinet(registry)
  registerPartition(registry)
  registerSignage(registry)
  registerCommonModelComponents(registry)
}
