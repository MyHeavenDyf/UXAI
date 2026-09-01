const REQUEST_SAFETY_THRESHOLD = 0.9
const TEXT_FILE_PATTERN = /\.(?:txt|md|markdown|csv|json|ya?ml|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sql|sh|log)$/i

const estimateTextTokens = (text: string) => {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

export function exceedsSafeRequestLimit(input: {
  contextTokens: number
  limit?: number
  text: string
  attachments: Array<{ filename: string; mime: string; size: number; status: string }>
}) {
  if (!input.limit) return false
  const attachmentTokens = input.attachments
    .filter((attachment) => attachment.status === "done")
    .filter((attachment) => attachment.mime.startsWith("text/") || TEXT_FILE_PATTERN.test(attachment.filename))
    .reduce((total, attachment) => total + Math.ceil(attachment.size / 2), 0)
  return input.contextTokens + estimateTextTokens(input.text) + attachmentTokens >= Math.floor(input.limit * REQUEST_SAFETY_THRESHOLD)
}
