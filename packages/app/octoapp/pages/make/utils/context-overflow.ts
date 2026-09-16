export function parseContextOverflowEvent(type: string, properties?: Record<string, unknown>) {
  if (type !== "session.error") return
  if (typeof properties?.sessionID !== "string") return
  if (!properties.error || typeof properties.error !== "object") return
  if (Reflect.get(properties.error, "name") !== "ContextOverflowError") return

  const data = Reflect.get(properties.error, "data")
  return {
    sessionID: properties.sessionID,
    message:
      data && typeof data === "object" && typeof Reflect.get(data, "message") === "string"
        ? Reflect.get(data, "message") as string
        : "当前对话上下文已超出模型限制。",
  }
}
