import type { SubtypeHandler } from "../subtype-handlers/types"
import defaultHandler from "../subtype-handlers/default"
import shadcnHandler from "../subtype-handlers/shadcn"
import prototypeHandler from "../subtype-handlers/prototype"

const handlers = new Map<string, SubtypeHandler>()

export function registerSubtypeHandler(handler: SubtypeHandler) {
  handlers.set(handler.name, handler)
}

export function getSubtypeHandler(subtype?: string): SubtypeHandler | undefined {
  if (!subtype) return undefined
  return handlers.get(subtype)
}

// 手动注册处理器
registerSubtypeHandler(defaultHandler)
registerSubtypeHandler(shadcnHandler)
registerSubtypeHandler(prototypeHandler)