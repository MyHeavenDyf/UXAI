import type { ComponentRegistry } from "../ComponentRegistry"
import { registerDesk } from "./desk"
import { registerCabinet } from "./cabinet"
import { registerPartition } from "./partition"
import { registerSignage } from "./signage"

export function registerCommonComponents(registry: ComponentRegistry): void {
  registerDesk(registry)
  registerCabinet(registry)
  registerPartition(registry)
  registerSignage(registry)
}
