import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { StudioGenerationResult } from "./types"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

export type StudioTurnData = {
  id: string
  userText: string
  assistantText: string
  toolTitle?: string
  toolError?: string
  toolName?: string
  result?: StudioGenerationResult
  createdAt: number
  isLatest: boolean
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => {
    if (left.time.created !== right.time.created) return left.time.created - right.time.created
    return left.id.localeCompare(right.id)
  })
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}

function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

function isRenderableImageUrl(url: string) {
  if (!url) return false
  if (url.includes("visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31")) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

function collectImageUrls(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/")
    const parsed = (() => {
      try {
        return JSON.parse(normalized) as unknown
      } catch {
        return undefined
      }
    })()
    const direct = /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,\S+)$/i.test(normalized) ? [normalized] : []
    const embedded = [
      ...(normalized.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []),
      ...(normalized.match(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>\\)]+/gi) ?? []),
    ]
    return Array.from(new Set([...direct, ...embedded, ...collectImageUrls(parsed)])).map((url) =>
      url.replace(/[,.，。]+$/, ""),
    )
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectImageUrls(item))))
  if (typeof value !== "object") return []
  return Array.from(new Set(Object.values(value as Record<string, unknown>).flatMap((item) => collectImageUrls(item))))
}

function parseToolImages(output: string) {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    const direct = [
      ...(Array.isArray(parsed.images) ? parsed.images : []),
      parsed.primaryImage,
      parsed.primary_image,
    ]
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .filter(isRenderableImageUrl)
    if (direct.length > 0) return Array.from(new Set(direct))
    const response = parsed.response
    if (response && typeof response === "object" && !Array.isArray(response)) {
      const record = response as Record<string, unknown>
      const nested = [
        ...(Array.isArray(record.images) ? record.images : []),
        record.primaryImage,
        record.primary_image,
      ]
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .filter(isRenderableImageUrl)
      if (nested.length > 0) return Array.from(new Set(nested))
    }
    return collectImageUrls(parsed).filter(isRenderableImageUrl)
  } catch {
    return collectImageUrls(output).filter(isRenderableImageUrl)
  }
}

function parseToolAttachments(part: Extract<Part, { type: "tool" }>) {
  const state = part.state as Record<string, unknown>
  const attachments = Array.isArray(state.attachments) ? state.attachments : []
  return attachments
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      const url = typeof record.url === "string" ? record.url : undefined
      return url ? [url] : []
    })
    .filter(isRenderableImageUrl)
}

function extractUserDemand(text: string) {
  const marker = "用户需求："
  const index = text.lastIndexOf(marker)
  if (index === -1) return text
  return text.slice(index + marker.length).split("\n输出时先简短说明")[0]?.trim() ?? text
}

function buildResult(input: {
  messageID: string
  userText: string
  assistantText: string
  tools: Extract<Part, { type: "tool" }>[]
  createdAt: number
}): StudioTurnData {
  const completed = [...input.tools]
    .reverse()
    .find((part): part is Extract<Part, { type: "tool" }> & { state: Extract<Extract<Part, { type: "tool" }>["state"], { status: "completed" }> } =>
      part.state.status === "completed" && (parseToolAttachments(part).length > 0 || parseToolImages(part.state.output).length > 0),
    )
  const running = [...input.tools]
    .reverse()
    .find((part): part is Extract<Part, { type: "tool" }> & { state: Extract<Extract<Part, { type: "tool" }>["state"], { status: "running" }> } =>
      part.state.status === "running",
    )
  const errored = [...input.tools]
    .reverse()
    .find((part): part is Extract<Part, { type: "tool" }> & { state: Extract<Extract<Part, { type: "tool" }>["state"], { status: "error" }> } =>
      part.state.status === "error",
    )
  const images = completed ? Array.from(new Set([...parseToolAttachments(completed), ...parseToolImages(completed.state.output)])) : []
  return {
    id: `studio_${completed?.id ?? input.messageID}`,
    userText: extractUserDemand(input.userText),
    assistantText: input.assistantText,
    toolTitle: completed?.state.title ?? running?.state.title,
    toolError: errored?.state.error,
    toolName: completed?.tool ?? input.tools[0]?.tool,
    result: images.length
      ? {
          id: `studio_${completed?.id ?? input.messageID}`,
          status: "succeeded",
          capability: "image.generate",
          prompt: extractUserDemand(input.userText),
          provider: resolveProvider(completed?.tool),
          model: completed?.tool ?? "image-generation-tool",
          aspectRatio: "3:4",
          images: images.map((url, index) => ({
            id: `studio_img_${completed?.id ?? input.messageID}_${index}`,
            url,
            thumbnailUrl: url,
            remoteUrl: url,
          })),
          createdAt: input.createdAt,
          completedAt: completed?.state.time.end,
        }
      : undefined,
    createdAt: input.createdAt,
    isLatest: false,
  }
}

export function buildStudioTurns(input: { messages: Message[]; parts: Record<string, Part[]>; fallback?: StudioGenerationResult }) {
  const messages = sortMessages(input.messages)
  const turns = messages
    .filter((message) => message.role === "user")
    .map((user) => {
    const index = messages.findIndex((message) => message.id === user.id)
    const assistant = messages.slice(index + 1).find((message) => message.role === "assistant")
    const userText =
      input.parts[user.id]
        ?.filter(isTextPart)
        .map((part) => part.text)
        .join("\n")
        .trim() || ""
    const assistantParts = assistant ? input.parts[assistant.id] ?? [] : []
    const assistantText = assistantParts
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n")
      .trim()
    const tools = assistantParts.filter(isToolPart)

    return buildResult({
      messageID: user.id,
      userText,
      assistantText,
      tools,
      createdAt: user.time.created,
    })
  })

  if (turns.length > 0) {
    turns[turns.length - 1] = { ...turns[turns.length - 1], isLatest: true }
    return turns
  }

  if (!input.fallback) return []

  return [
    {
      id: `studio_${input.fallback.id}`,
      userText: extractUserDemand(input.fallback.prompt),
      assistantText: "",
      toolTitle: "图片生成",
      toolName: input.fallback.provider,
      result: input.fallback,
      createdAt: input.fallback.createdAt,
      isLatest: true,
    },
  ]
}

function resolveProvider(toolName?: string) {
  const name = toolName?.toLowerCase() ?? ""
  if (name.includes("jimeng")) return "jimeng"
  if (name.includes("internel")) return "internel"
  return "mock"
}

export function latestStudioTurn(input: { messages: Message[]; parts: Record<string, Part[]>; fallback?: StudioGenerationResult }) {
  const turns = buildStudioTurns(input)
  return turns[turns.length - 1]
}

export function buildStudioTurnSummary(turn: StudioTurnData) {
  return [
    `上一轮用户需求：${turn.userText}`,
    turn.assistantText ? `上一轮助手说明：${turn.assistantText}` : undefined,
    turn.result ? `上一轮生成结果：模型 ${turn.result.model}，比例 ${turn.result.aspectRatio}，${turn.result.images.length} 张图` : undefined,
    turn.toolName ? `上一轮工具：${turn.toolName}` : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

export function buildStudioConversationContext(input: {
  messages: Message[]
  parts: Record<string, Part[]>
  fallback?: StudioGenerationResult
}) {
  const turns = buildStudioTurns(input)
  const last = turns.at(-1)
  if (!last?.result || last.result.images.length === 0) return ""
  return buildStudioTurnSummary(last)
}

export function buildStudioDisplayPrompt(text: string) {
  return extractUserDemand(text).split("\n")[0]?.trim() || "新建对话"
}
