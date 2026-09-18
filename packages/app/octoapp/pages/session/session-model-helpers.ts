import type { Message, UserMessage } from "@opencode-ai/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}

export const lastSessionUserMessage = (messages: Record<string, Message[] | undefined>, sessionID?: string) => {
  if (!sessionID) return
  return messages[sessionID]?.findLast((message): message is UserMessage => message.role === "user")
}
