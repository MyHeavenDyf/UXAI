type CompactionStatus = {
  summary?: boolean
  finish?: string
  error?: unknown
}

export function isSuccessfulCompaction(message: CompactionStatus) {
  return message.summary === true && !!message.finish && !message.error
}

export function insightContextTokens(
  context:
    | {
        message: CompactionStatus
        output: number
        total: number
      }
    | undefined,
) {
  if (!context) return 0
  if (isSuccessfulCompaction(context.message)) return context.output
  return context.total
}

export function isMessageAbortedError(error: unknown) {
  if (!error || typeof error !== "object") return false
  return Reflect.get(error, "name") === "MessageAbortedError"
}

export function insightContextCommandName(text: string) {
  const command = text.trim()
  if (command === "/compact") return "compact" as const
  if (command === "/summarize") return "summarize" as const
}

export function isInsightSendDisabled(input: {
  stopping: boolean
  contextBlocked: boolean
  text: string
  uploading: boolean
}) {
  if (input.stopping) return false
  if (!input.text.trim() || input.uploading) return true
  return input.contextBlocked && !insightContextCommandName(input.text)
}
