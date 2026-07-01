import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { StudioAspectRatio, StudioCapability, StudioGenerationResult } from "./types"

const SKIP_PART_TYPES = new Set(["patch", "step-start", "step-finish"])

export type StudioTurnData = {
  id: string
  userText: string
  assistantText: string
  editCapability?: StudioCapability
  editorEntryID?: string
  toolTitle?: string
  toolError?: string
  toolName?: string
  toolRunning?: boolean
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
  if (isRenderableVideoUrl(url)) return false
  return /^https?:\/\/\S+|^data:image\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

function isRenderableVideoUrl(url: string) {
  if (!url) return false
  if (/^data:video\/[a-z0-9.+-]+;base64,\S+$/i.test(url)) return true
  if (!/^https?:\/\/\S+/i.test(url)) return false
  return /\.(mp4|mov|webm)$/i.test(url.split(/[?#]/)[0] ?? "")
}

function isRenderableVideoAttachmentUrl(url: string) {
  return /^https?:\/\/\S+/i.test(url) || /^data:video\/[a-z0-9.+-]+;base64,\S+$/i.test(url)
}

function mediaKindForAttachment(url: string, mime?: string): "image" | "video" {
  if (mime?.startsWith("video/")) return "video"
  if (mime?.startsWith("image/")) return "image"
  return isRenderableVideoUrl(url) ? "video" : "image"
}

function isRenderableAttachment(item: { url: string; kind: "image" | "video"; mime?: string }) {
  if (item.kind === "image") return isRenderableImageUrl(item.url)
  if (item.mime?.startsWith("video/")) return isRenderableVideoAttachmentUrl(item.url)
  return isRenderableVideoUrl(item.url)
}

function collectDirectVideoUrls(value: unknown): string[] {
  if (!value) return []
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/").trim().replace(/[,.，。]+$/, "")
    return /^https?:\/\/\S+$/i.test(normalized) || /^data:video\/[a-z0-9.+-]+;base64,\S+$/i.test(normalized)
      ? [normalized]
      : []
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectDirectVideoUrls(item))))
  return []
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

function collectVideoUrls(value: unknown): string[] {
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
    const direct = isRenderableVideoUrl(normalized) ? [normalized] : []
    const embedded = [
      ...(normalized.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []),
      ...(normalized.match(/data:video\/[a-z0-9.+-]+;base64,[^\s"'<>\\)]+/gi) ?? []),
    ].filter(isRenderableVideoUrl)
    return Array.from(new Set([...direct, ...embedded, ...collectVideoUrls(parsed)])).map((url) =>
      url.replace(/[,.，。]+$/, ""),
    )
  }
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => collectVideoUrls(item))))
  if (typeof value !== "object") return []
  return Array.from(new Set(Object.values(value as Record<string, unknown>).flatMap((item) => collectVideoUrls(item))))
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

function parseToolVideos(output: string) {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    const direct = [
      ...collectDirectVideoUrls(parsed.videos),
      ...collectDirectVideoUrls(parsed.primaryVideo),
      ...collectDirectVideoUrls(parsed.primary_video),
    ]
    if (direct.length > 0) return Array.from(new Set(direct))
    const response = parsed.response
    if (response && typeof response === "object" && !Array.isArray(response)) {
      const record = response as Record<string, unknown>
      const nested = [
        ...collectDirectVideoUrls(record.videos),
        ...collectDirectVideoUrls(record.primaryVideo),
        ...collectDirectVideoUrls(record.primary_video),
      ]
      if (nested.length > 0) return Array.from(new Set(nested))
    }
    return collectVideoUrls(parsed).filter(isRenderableVideoUrl)
  } catch {
    return collectVideoUrls(output).filter(isRenderableVideoUrl)
  }
}

function parseToolOutput(output?: string) {
  if (!output) return {}
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function studioProgress(part?: Extract<Part, { type: "tool" }>) {
  const state = part?.state as Record<string, unknown> | undefined
  const studio = recordField(recordField(state, "metadata"), "studio")
  const status = stringField(studio, "status")
  return {
    generationID: stringField(studio, "generationID"),
    status:
      status === "queued" ||
      status === "running" ||
      status === "succeeded" ||
      status === "create_failed" ||
      status === "failed"
        ? status
        : "running",
    rawStatus: studio?.rawStatus as number | string | undefined,
    progress: numberField(studio, "progress") ?? 0,
    order: numberField(studio, "order"),
  } as const
}

function normalizeCapability(value?: string): StudioCapability {
  if (
    value === "image.generate" ||
    value === "video.generate" ||
    value === "image.upscale" ||
    value === "image.cutout" ||
    value === "image.inpaint" ||
    value === "image.outpaint" ||
    value === "image.fusion"
  ) return value
  return "image.generate"
}

function normalizeAspectRatio(value?: string): StudioAspectRatio {
  if (
    value === "1:1" ||
    value === "2:3" ||
    value === "3:4" ||
    value === "9:16" ||
    value === "3:2" ||
    value === "4:3" ||
    value === "16:9"
  ) return value
  return "3:4"
}

function toolInput(part?: Extract<Part, { type: "tool" }>) {
  const state = part?.state as Record<string, unknown> | undefined
  const input = state?.input
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

function toolRequest(part?: Extract<Part, { type: "tool" }>) {
  const state = part?.state as Record<string, unknown> | undefined
  const metadata = recordField(state, "metadata")
  const request = recordField(metadata, "request")
  return request
}

function isStudioEditorCapability(value: unknown): value is StudioCapability {
  return (
    value === "image.upscale" ||
    value === "image.cutout" ||
    value === "image.inpaint" ||
    value === "image.outpaint"
  )
}

function editorEntry(tools: Extract<Part, { type: "tool" }>[]) {
  return tools
    .filter((part) => part.tool === "studio_editor_entry")
    .map((part) => {
      const state = part.state as Record<string, unknown>
      const metadata = recordField(recordField(state, "metadata"), "studio")
      const input = recordField(state, "input")
      const capability = metadata?.capability ?? input?.capability
      const entryID = stringField(metadata, "entryID") ?? stringField(input, "entryID")
      if (!isStudioEditorCapability(capability) || !entryID) return
      return { capability, entryID }
    })
    .find((item): item is { capability: StudioCapability; entryID: string } => Boolean(item))
}

function parseToolAttachments(part: Extract<Part, { type: "tool" }>) {
  const state = part.state as Record<string, unknown>
  const attachments = Array.isArray(state.attachments) ? state.attachments : []
  const content = Array.isArray(state.content) ? state.content : []
  return [...attachments, ...content]
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      const url =
        typeof record.url === "string"
          ? record.url
          : typeof record.uri === "string"
            ? record.uri
            : undefined
      const mime = typeof record.mime === "string" ? record.mime : undefined
      return url ? [{ url, kind: mediaKindForAttachment(url, mime), mime }] : []
    })
    .filter(isRenderableAttachment)
}

function extractUserDemand(text: string) {
  const marker = "用户需求："
  const index = text.lastIndexOf(marker)
  const content = index === -1 ? text : text.slice(index + marker.length)
  const stopIndex = [
    "\n能力：",
    "\n风格模型：",
    "\n画幅比例：",
    "\n生成数量：",
    "\n当前选中的生图工具：",
    "\n工具参数JSON：",
    "\n调用生图工具",
    "\n输出时先简短说明",
  ]
    .map((item) => content.indexOf(item))
    .filter((item) => item >= 0)
    .sort((left, right) => left - right)[0]
  return content
    .slice(0, stopIndex ?? content.length)
    .split("\n")
    .filter((line) => !line.startsWith("工具参数JSON：") && !line.startsWith("调用生图工具"))
    .join("\n")
    .trim()
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
      part.state.status === "completed" && (parseToolAttachments(part).length > 0 || parseToolImages(part.state.output).length > 0 || parseToolVideos(part.state.output).length > 0),
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
  const media = completed
    ? [
        ...parseToolAttachments(completed),
        ...parseToolVideos(completed.state.output).map((url) => ({ kind: "video" as const, url })),
        ...parseToolImages(completed.state.output).map((url) => ({ kind: "image" as const, url })),
      ].filter((item, index, list) => list.findIndex((entry) => entry.url === item.url) === index)
    : []
  const output = parseToolOutput(completed?.state.output)
  const activeTool = completed ?? running ?? errored
  const inputRecord = toolInput(activeTool)
  const requestRecord = toolRequest(activeTool)
  const capability = normalizeCapability(stringField(output, "capability") ?? stringField(inputRecord, "capability"))
  const aspectRatio = normalizeAspectRatio(stringField(output, "aspectRatio") ?? stringField(inputRecord, "aspectRatio"))
  const model = stringField(output, "model") ?? stringField(inputRecord, "styleModel") ?? activeTool?.tool ?? "image-generation-tool"
  const prompt = stringField(inputRecord, "effectivePrompt") ??
    stringField(inputRecord, "refinedPrompt") ??
    stringField(inputRecord, "prompt") ??
    extractUserDemand(input.userText)
  const displayPrompt = stringField(inputRecord, "displayPrompt")
  const progress = studioProgress(running)
  const failure = studioProgress(errored)
  const failureStatus = failure.status === "create_failed" ? "create_failed" : "failed"
  return {
    id: `studio_${completed?.id ?? input.messageID}`,
    userText: displayPrompt || extractUserDemand(input.userText),
    assistantText: input.assistantText,
    toolTitle: media.length > 0
      ? capability === "video.generate" ? "视频生成完成" : "图片生成完成"
      : running
        ? capability === "video.generate" ? "视频生成中" : "图片生成中"
        : completed
          ? capability === "video.generate" ? "视频生成完成" : "图片生成完成"
          : errored
            ? failureStatus === "create_failed"
              ? capability === "video.generate" ? "视频创建失败" : "图片创建失败"
              : capability === "video.generate" ? "视频生成失败" : "图片生成失败"
            : undefined,
    toolError: errored?.state.error,
    toolName: activeTool?.tool ?? input.tools[0]?.tool,
    toolRunning: Boolean(running),
    result: media.length
      ? {
          id: `studio_${completed?.id ?? input.messageID}`,
          status: "succeeded",
          capability,
          prompt,
          displayPrompt,
          provider: resolveProvider(completed?.tool),
          toolAction: stringField(output, "toolAction") as StudioGenerationResult["toolAction"],
          taskType: stringField(output, "taskType") ?? stringField(output, "task_type") ?? stringField(inputRecord, "task_type") ?? stringField(inputRecord, "taskType"),
          taskId: stringField(output, "taskId"),
          model,
          styleModel: stringField(inputRecord, "styleModel"),
          aspectRatio,
          videoMode: stringField(output, "videoMode") as StudioGenerationResult["videoMode"],
          duration: stringField(output, "duration") as StudioGenerationResult["duration"],
          videoQualityMode: stringField(output, "videoQualityMode") as StudioGenerationResult["videoQualityMode"],
          images: media.map((item, index) => ({
            id: `studio_img_${completed?.id ?? input.messageID}_${index}`,
            kind: item.kind,
            url: item.url,
            thumbnailUrl: item.url,
            remoteUrl: item.url,
            width: numberField(output, "width"),
            height: numberField(output, "height"),
          })),
          progress: numberField(output, "progress") ?? 100,
          order: numberField(output, "order"),
          rawStatus: output.rawStatus as number | string | undefined,
          request: inputRecord || requestRecord
            ? {
                ...(inputRecord ? { input: inputRecord } : {}),
                ...(requestRecord ? { task: { request: requestRecord } } : {}),
              }
            : undefined,
          response: recordField(output, "response"),
          createdAt: input.createdAt,
          updatedAt: completed?.state.time.end,
          completedAt: completed?.state.time.end,
        }
      : running && progress.generationID
        ? {
            id: progress.generationID,
            status: progress.status,
            capability,
            prompt,
            displayPrompt,
            provider: resolveProvider(running.tool),
            model: running.tool,
            aspectRatio,
            images: [],
            progress: progress.progress,
            order: progress.order,
            rawStatus: progress.rawStatus,
            request: inputRecord ? { input: inputRecord } : undefined,
            createdAt: input.createdAt,
          }
        : errored
          ? {
              id: failure.generationID ?? `studio_${errored.id}`,
              status: failureStatus,
              capability,
              prompt,
              displayPrompt,
              provider: resolveProvider(errored.tool),
              model,
              aspectRatio,
              images: [],
              progress: failure.progress,
              order: failure.order,
              rawStatus: failure.rawStatus,
              error: errored.state.error,
              request: inputRecord ? { input: inputRecord } : undefined,
              createdAt: input.createdAt,
              updatedAt: errored.state.time.end,
              completedAt: errored.state.time.end,
            }
        : undefined,
    createdAt: input.createdAt,
    isLatest: false,
  }
}

export function buildStudioTurns(input: { messages: Message[]; parts: Record<string, Part[]>; fallback?: StudioGenerationResult; currentSessionID?: string }) {
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
    const entry = editorEntry(tools)
    if (entry) {
      return {
        id: `studio_editor_${entry.entryID}`,
        userText,
        assistantText,
        editCapability: entry.capability,
        editorEntryID: entry.entryID,
        createdAt: user.time.created,
        isLatest: false,
      } satisfies StudioTurnData
    }

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

  // Reject fallback that belongs to a different session to avoid task ghosting.
  if (input.currentSessionID && input.fallback.sessionID && input.fallback.sessionID !== input.currentSessionID) return []

  const fallbackGenerating = input.fallback.status === "queued" || input.fallback.status === "running"
  return [
    {
      id: `studio_${input.fallback.id}`,
      userText: input.fallback.displayPrompt || extractUserDemand(input.fallback.prompt),
      assistantText: "",
      toolTitle: `${input.fallback.capability === "video.generate" ? "视频生成" : "图片生成"}${
        fallbackGenerating
          ? "中"
          : input.fallback.status === "create_failed"
            ? "创建失败"
            : input.fallback.status === "failed"
              ? "失败"
              : "完成"
      }`,
      toolName: input.fallback.provider,
      toolRunning: fallbackGenerating,
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
  return turn.userText
}

export function buildStudioConversationContext(input: {
  messages: Message[]
  parts: Record<string, Part[]>
  fallback?: StudioGenerationResult
}) {
  const turns = buildStudioTurns(input)
  const lastSuccessful = [...turns].reverse().find((turn) => (turn.result?.images.length ?? 0) > 0)
  if (!lastSuccessful) return ""
  return buildStudioTurnSummary(lastSuccessful)
}

export function buildStudioDisplayPrompt(text: string) {
  return extractUserDemand(text).split("\n")[0]?.trim() || "新建对话"
}
