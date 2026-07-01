import { executeJimengImageGenerate, summarizeJimengOutput } from "@/tool/jimeng_image_generate"
import {
  cancelInternalGeneration,
  createInternalGeneration,
  queryInternalGeneration,
  summarizeInternalOutput,
} from "@/tool/internel_image_generate"
import { streamText, type ModelMessage } from "ai"
import z from "zod"
import { mergeDeep } from "remeda"
import * as Database from "@/storage/db"
import { and, eq, inArray, lte } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { Plugin } from "@/plugin"
import { ProviderTransform } from "@/provider/transform"
import { SyncEvent } from "@/sync"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { registerDisposer } from "@/effect/instance-registry"
import { makeRuntime } from "@/effect/run-service"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { ImageGenerationQuery, ImageGenerationTask, ImageGenerateOutput, StudioCapability } from "./image-provider"
import { StudioGenerationTable, type StudioGenerationStatus } from "./studio-generation.sql"

type StudioProvider = "jimeng" | "internel"
type StudioPersistedTurn = {
  assistantInfo: MessageV2.Assistant
  toolPart: MessageV2.ToolPart & { state: MessageV2.ToolStateRunning }
}

type StudioGenerationRecord = typeof StudioGenerationTable.$inferSelect
type StudioPromptRefineResult = {
  assistantText: string
  refinedPrompt: string
  effectivePrompt: string
  fallback?: boolean
  raw?: unknown
}

type StudioGenerationPromptInput = StudioGenerationRequest & {
  refinedPrompt?: string
  effectivePrompt?: string
  displayPrompt?: string
  promptRefineFallback?: boolean
}

export type StudioGenerationRequest = {
  sessionID?: string
  capability: StudioCapability
  prompt: string
  displayPrompt?: string
  refinedPrompt?: string
  effectivePrompt?: string
  styleModel?: string
  aspectRatio?: string
  count?: number
  imageTool?: StudioProvider
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type StudioEditorCapability =
  | "image.upscale"
  | "image.cutout"
  | "image.inpaint"
  | "image.outpaint"

export type StudioEditorEntryRequest = {
  sessionID: string
  capability: StudioEditorCapability
  entryID: string
}

export type StudioEditorEntryResult = {
  entryID: string
  userMessageID: string
  assistantMessageID: string
}

export type StudioGenerationResult = {
  id: string
  status: StudioGenerationStatus
  capability: StudioCapability
  prompt: string
  displayPrompt?: string
  provider: StudioProvider
  toolAction?: "generate_image" | "generate_video" | "super_resolution" | "cutout" | "inpainting" | "outpainting"
  taskType?: string
  task_type?: string
  taskId?: string
  model: string
  aspectRatio: string
  videoMode?: "text" | "first_last_frame"
  duration?: "5" | "10"
  videoQualityMode?: "std" | "pro"
  images: { id: string; kind?: "image" | "video"; url: string; thumbnailUrl?: string; remoteUrl?: string; width?: number; height?: number; duration?: number }[]
  request?: unknown
  response?: unknown
  rawBody?: string
  error?: string
  createdAt: number
  progress: number
  order?: number
  rawStatus?: number | string
  updatedAt: number
  completedAt?: number
}

export type StudioGenerationAccepted = Pick<
  StudioGenerationResult,
  "id" | "status" | "capability" | "prompt" | "displayPrompt" | "provider" | "model" | "aspectRatio" | "taskId" | "images" | "progress" | "order" | "rawStatus" | "error" | "createdAt" | "updatedAt" | "completedAt"
> & {
  sessionID: string
}

function resolveProvider(input: StudioGenerationRequest): StudioProvider {
  if (input.capability !== "image.generate") return "internel"
  if (input.imageTool) return input.imageTool
  if (input.extra?.imageTool === "internel") return "internel"
  return "jimeng"
}

function toolActionForCapability(capability: StudioCapability) {
  if (capability === "video.generate") return "generate_video"
  if (capability === "image.upscale") return "super_resolution"
  if (capability === "image.cutout") return "cutout"
  if (capability === "image.inpaint") return "inpainting"
  if (capability === "image.outpaint") return "outpainting"
  return "generate_image"
}

function isVideoKind(kind?: string) {
  return kind === "video"
}

function videoMode(input: StudioGenerationRequest) {
  const value = input.extra?.videoMode
  if (value === "text" || value === "first_last_frame") return value
  return (input.referenceImages?.length ?? 0) > 0 ? "first_last_frame" : "text"
}

function videoDuration(input: StudioGenerationRequest) {
  const value = input.extra?.duration
  return value === "10" ? "10" : "5"
}

function videoQualityMode(input: StudioGenerationRequest) {
  const value = input.extra?.mode
  return value === "pro" ? "pro" : "std"
}

function isEditorGenerationCapability(capability: StudioCapability) {
  return capability === "image.upscale" ||
    capability === "image.cutout" ||
    capability === "image.inpaint" ||
    capability === "image.outpaint"
}

function buildAssistantText(input: StudioGenerationRequest) {
  if (input.capability === "video.generate") {
    return [
      `我将为您创作${input.prompt}。`,
      input.aspectRatio ? `画幅比例设为 ${input.aspectRatio}` : undefined,
      "。",
    ]
      .filter((item): item is string => Boolean(item))
      .join("")
  }
  if (input.capability === "image.upscale") return "好的，我将提升当前图片的清晰度和细节。"
  if (input.capability === "image.cutout") return "好的，我将对当前图片进行抠图，移除背景并保留主体。"
  if (input.capability === "image.inpaint") return `好的，我将根据涂抹区域${input.prompt}。`
  if (input.capability === "image.outpaint") return `好的，我将${input.prompt}。`
  return [
    `我将为您创作${input.prompt}。`,
    input.styleModel ? `采用“${input.styleModel}”风格` : undefined,
    input.aspectRatio ? `画幅比例设为 ${input.aspectRatio}` : undefined,
    input.sourceImage ? "并在上一轮图片基础上继续编辑。" : "。",
  ]
    .filter((item): item is string => Boolean(item))
    .join("")
}

function resultSummary(input: { provider: StudioProvider; raw: unknown; rawBody?: string }) {
  return input.provider === "internel"
    ? summarizeInternalOutput(input.raw, input.rawBody)
    : summarizeJimengOutput(input.raw, input.rawBody)
}

function toolName(provider: StudioProvider) {
  return provider === "internel" ? "internel_image_generate" : "jimeng_image_generate"
}

function editorCapabilityLabel(capability: StudioEditorCapability) {
  if (capability === "image.upscale") return "变清晰"
  if (capability === "image.cutout") return "抠图"
  if (capability === "image.inpaint") return "智能重绘"
  return "扩图"
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  )
}

function studioContext(input: StudioGenerationRequest) {
  const value = input.extra?.studioContext
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function buildEffectivePrompt(input: StudioGenerationRequest) {
  const context = studioContext(input)
  if (!context) return input.prompt
  return `延续上一轮画面：${context}。${input.prompt}`
}

function generationPrompt(input: StudioGenerationRequest) {
  const effectivePrompt = (input as StudioGenerationPromptInput).effectivePrompt
  return typeof effectivePrompt === "string" && effectivePrompt.trim().length > 0
    ? effectivePrompt.trim()
    : buildEffectivePrompt(input)
}

function displayInput(input: StudioGenerationRequest, task?: ImageGenerationTask) {
  if (!task?.input) return input
  return {
    ...input,
    ...task.input,
    prompt: input.prompt,
  }
}

function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate" && input.capability !== "video.generate") return false
  return input.extra?.skipPromptRefine !== true
}

function previousEffectivePrompt(previous?: StudioGenerationRecord) {
  const previousRequest = previous ? generationRequest(previous).input as StudioGenerationPromptInput : undefined
  return previousRequest?.effectivePrompt?.trim() ||
    previousRequest?.refinedPrompt?.trim() ||
    previousRequest?.prompt?.trim()
}

function buildEffectivePromptFromPrevious(input: StudioGenerationRequest, previous?: StudioGenerationRecord) {
  const previousPrompt = previousEffectivePrompt(previous)
  if (!previousPrompt) return buildEffectivePrompt(input)
  return `延续上一轮画面：${previousPrompt}。${input.prompt}`
}

function promptRefineFallback(input: StudioGenerationRequest, previous?: StudioGenerationRecord): StudioPromptRefineResult {
  const restoredPrompt = input.effectivePrompt?.trim() || input.refinedPrompt?.trim()
  const effectivePrompt = restoredPrompt || buildEffectivePromptFromPrevious(input, previous)
  const regenerateText = input.displayPrompt?.trim() === "再次生成"
  return {
    assistantText: regenerateText
      ? "好的，我会按当前结果的配置重新生成。"
      : shouldRefineWithLLM(input)
      ? input.capability === "video.generate"
        ? "好的，我会根据你的描述创作视频。"
        : input.sourceImage
          ? "好的，我会基于当前画面继续创作。"
          : "好的，我会根据你的描述创作画面。"
      : buildAssistantText(input),
    refinedPrompt: effectivePrompt,
    effectivePrompt,
    fallback: true,
  }
}

function imageUrls(result: unknown) {
  if (!result || typeof result !== "object") return []
  const images = (result as { images?: unknown }).images
  if (!Array.isArray(images)) return []
  return images
    .map((image) => {
      if (!image || typeof image !== "object") return
      const record = image as { remoteUrl?: unknown; url?: unknown }
      return typeof record.remoteUrl === "string"
        ? record.remoteUrl
        : typeof record.url === "string"
          ? record.url
          : undefined
    })
    .filter((item): item is string => Boolean(item))
}

function lastSuccessfulGeneration(sessionID: SessionID) {
  return Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(
        eq(StudioGenerationTable.session_id, sessionID),
        eq(StudioGenerationTable.status, "succeeded"),
      ))
      .all(),
  )
    .sort((left, right) => (right.completed_at ?? right.time_updated) - (left.completed_at ?? left.time_updated))[0]
}

function promptRefineInput(input: StudioGenerationRequest, previous?: StudioGenerationRecord) {
  const previousRequest = previous ? generationRequest(previous).input as StudioGenerationPromptInput : undefined
  const previousPrompt = previousEffectivePrompt(previous)
  return {
    capability: input.capability,
    userPrompt: input.prompt,
    hasReferenceImages: (input.referenceImages?.length ?? 0) > 0,
    ...(input.capability === "video.generate"
      ? {
          video: {
            mode: videoMode(input),
            duration: videoDuration(input),
            qualityMode: videoQualityMode(input),
            hasFirstFrame: Boolean(input.extra?.firstFrame) || (input.referenceImages?.length ?? 0) > 0,
            hasLastFrame: Boolean(input.extra?.lastFrame),
          },
        }
      : {}),
    previousTurn: previous && previousRequest
      ? {
          capability: previous.capability,
          userText: previousRequest.prompt,
          refinedPrompt: previousPrompt,
          imageUrls: imageUrls(previous.result),
        }
      : undefined,
  }
}

const promptRefineSchema = z.object({
  assistantText: z.string().min(1),
  refinedPrompt: z.string().min(1),
})

function parsePromptRefineText(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]
  const objectStart = trimmed.indexOf("{")
  const objectEnd = trimmed.lastIndexOf("}")
  const candidates = [
    trimmed,
    fenced,
    objectStart >= 0 && objectEnd > objectStart ? trimmed.slice(objectStart, objectEnd + 1) : undefined,
  ].filter((item): item is string => Boolean(item))
  for (const item of candidates) {
    try {
      const parsed = promptRefineSchema.safeParse(JSON.parse(item))
      if (parsed.success) return parsed.data
    } catch {
      continue
    }
  }
}

function promptRefineTextPreview(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 500)
}

const PROMPT_REFINE_TIMEOUT_MS = 45_000

const studioPromptProviderRuntime = makeRuntime(Provider.Service, Provider.defaultLayer)
const studioPromptAuthRuntime = makeRuntime(Auth.Service, Auth.defaultLayer)
const studioPromptPluginRuntime = makeRuntime(Plugin.Service, Plugin.defaultLayer)

const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

const IMAGE_PROMPT_REFINE_SYSTEM = [
  "你是 Octo Studio 的图片提示词润色助手。",
  "你的任务是根据用户当前输入、最近一次成功生成结果和上下文，生成 assistantText 和 refinedPrompt。",
  "严格规则：",
  "- 只负责画面内容描述，不决定能力、模型、风格配置、工具、比例、数量。",
  "- 不要在 refinedPrompt 中写模型名称、画幅比例、生成数量、工具名称。",
  "- 用户气泡会显示用户原文，因此不要把用户输入改写成对话消息。",
  "- 如果用户当前输入是延续上一轮，请保留上一轮主体、构图、氛围、风格中仍相关的部分。",
  "- 如果用户当前输入明确是全新主题，请以当前输入为主。",
  "- assistantText 使用中文，简短、自然、友好，不要暴露内部参数。",
  "- assistantText 不超过 40 个中文字。",
  "- refinedPrompt 只描述要生成的画面内容。",
  "- refinedPrompt 不超过 300 个中文字。",
  "- 输出必须是单个 JSON object，不要 markdown，不要代码块，不要解释文字。",
  "- 只输出 JSON。",
].join("\n")

const VIDEO_PROMPT_REFINE_SYSTEM = [
  "你是 Octo Studio 的视频提示词润色助手。",
  "你的任务是根据用户当前输入、最近一次成功生成结果和上下文，生成 assistantText 和 refinedPrompt。",
  "严格规则：",
  "- 只负责视频内容、动作、镜头、节奏、氛围描述。",
  "- 不决定能力、模型、比例、数量、时长、质量模式、工具。",
  "- 不要在 refinedPrompt 中写模型名称、画幅比例、生成数量、视频时长、质量模式或工具名称。",
  "- 如果是文生视频，refinedPrompt 应描述主体、动作、镜头运动、场景、节奏和氛围。",
  "- 如果是图生视频或有参考图/首帧/尾帧，请保留图中主体与画面关系，只补充合理运动和镜头变化。",
  "- 如果用户当前输入是延续上一轮，请保留上一轮主体、动作、场景、风格中仍相关的部分。",
  "- 如果用户当前输入明确是全新主题，请以当前输入为主。",
  "- assistantText 使用中文，简短、自然、友好，不要暴露内部参数。",
  "- assistantText 不超过 40 个中文字。",
  "- refinedPrompt 只描述要生成的视频内容。",
  "- refinedPrompt 不超过 300 个中文字。",
  "- 输出必须是单个 JSON object，不要 markdown，不要代码块，不要解释文字。",
  "- 只输出 JSON。",
].join("\n")

function promptRefineSystem(input: StudioGenerationRequest) {
  if (input.capability === "video.generate") return VIDEO_PROMPT_REFINE_SYSTEM
  return IMAGE_PROMPT_REFINE_SYSTEM
}

async function refineStudioPrompt(input: StudioGenerationRequest, session: typeof SessionTable.$inferSelect): Promise<StudioPromptRefineResult> {
  const sessionID = SessionID.zod.parse(session.id)
  const previous = lastSuccessfulGeneration(sessionID)
  if (!shouldRefineWithLLM(input)) return promptRefineFallback(input, previous)
  try {
    const model = session.model
      ? { providerID: ProviderID.make(session.model.providerID), modelID: ModelID.make(session.model.id) }
      : undefined
    const result = await studioPromptProviderRuntime.runPromise((provider) =>
      Effect.gen(function* () {
        const selected = model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(selected.providerID, selected.modelID)
        const providerInfo = yield* provider.getProvider(selected.providerID)
        const language = yield* provider.getLanguage(resolved)
        console.log("[studio.service] prompt refine model", {
          sessionID: session.id,
          selectedProviderID: selected.providerID,
          selectedModelID: selected.modelID,
          resolvedProviderID: resolved.providerID,
          resolvedModelID: resolved.id,
          apiID: resolved.api.id,
          apiNpm: resolved.api.npm,
        })
        const authInfo = yield* Effect.promise(() =>
          studioPromptAuthRuntime.runPromise((auth) => auth.get(selected.providerID).pipe(Effect.orDie)),
        )
        const isOpenaiOauth = selected.providerID === ProviderID.openai && authInfo?.type === "oauth"
        const system = [promptRefineSystem(input)]
        const userContent = JSON.stringify(promptRefineInput(input, previous), null, 2)
        const base = ProviderTransform.options({
          model: resolved,
          sessionID: session.id,
          providerOptions: providerInfo.options,
        })
        const options = mergeOptions(base, resolved.options)
        if (isOpenaiOauth) options.instructions = system.join("\n")
        const pluginMessage: MessageV2.User = {
          id: MessageID.ascending(),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "octo_studio",
          model: {
            providerID: selected.providerID,
            modelID: selected.modelID,
          },
        }
        const chatHookInput = {
          sessionID: session.id,
          agent: "octo_studio",
          model: resolved,
          provider: providerInfo,
          message: pluginMessage,
        }
        const chatParams = yield* Effect.promise(() =>
          studioPromptPluginRuntime.runPromise((plugin) =>
            plugin.trigger("chat.params", chatHookInput, {
              temperature: resolved.capabilities.temperature ? 0.4 : undefined,
              topP: ProviderTransform.topP(resolved),
              topK: ProviderTransform.topK(resolved),
              maxOutputTokens: ProviderTransform.maxOutputTokens(resolved),
              options,
            }),
          ),
        )
        const maxOutputTokens = chatParams.maxOutputTokens ?? ProviderTransform.maxOutputTokens(resolved)
        const chatHeaders = yield* Effect.promise(() =>
          studioPromptPluginRuntime.runPromise((plugin) =>
            plugin.trigger("chat.headers", chatHookInput, {
              headers: {},
            }),
          ),
        )
        const headers = {
          ...(selected.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": Instance.current.project.id,
                "x-opencode-session": session.id,
                "x-opencode-request": pluginMessage.id,
                "x-opencode-client": Flag.OPENCODE_CLIENT,
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
                "x-session-affinity": session.id,
                "User-Agent": `opencode/${InstallationVersion}`,
              }),
          ...resolved.headers,
          ...chatHeaders.headers,
        }
        const providerOptions = ProviderTransform.providerOptions(resolved, chatParams.options)
        const messages = [
          ...(isOpenaiOauth
            ? []
            : system.map((item): ModelMessage => ({
                role: "system",
                content: item,
              }))),
          {
            role: "user" as const,
            content: userContent,
          },
        ]
        console.log("[studio.service] prompt refine params", {
          sessionID: session.id,
          providerID: resolved.providerID,
          modelID: resolved.id,
          apiID: resolved.api.id,
          apiNpm: resolved.api.npm,
          temperature: chatParams.temperature,
          topP: chatParams.topP,
          topK: chatParams.topK,
          maxOutputTokens: maxOutputTokens,
          messageRoles: messages.map((item) => item.role),
          messageContentLengths: messages.map((item) =>
            typeof item.content === "string" ? item.content.length : JSON.stringify(item.content).length,
          ),
          providerOptionsKeys: Object.keys(providerOptions),
          providerOptionsNestedKeys: Object.fromEntries(
            Object.entries(providerOptions).map(([key, value]) => [
              key,
              value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : typeof value,
            ]),
          ),
          headerKeys: Object.keys(headers),
        })
        return yield* Effect.promise(async () => {
          const controller = new AbortController()
          const startedAt = Date.now()
          let timedOut = false
          const timeout = setTimeout(() => {
            timedOut = true
            controller.abort(new Error("Studio prompt refine timed out."))
          }, PROMPT_REFINE_TIMEOUT_MS)
          try {
            const stream = streamText({
              model: language,
              temperature: chatParams.temperature,
              topP: chatParams.topP,
              topK: chatParams.topK,
              maxOutputTokens: maxOutputTokens,
              messages,
              providerOptions,
              abortSignal: controller.signal,
              headers,
              maxRetries: 0,
              onError: (error) => {
                console.warn("[studio.service] prompt refine stream error", error)
              },
            })
            let text = ""
            let abortReason: string | undefined
            let finishReason: string | undefined
            for await (const part of stream.fullStream) {
              if (part.type === "error") throw part.error
              if (part.type === "abort") {
                abortReason = typeof part.reason === "string" ? part.reason : undefined
                continue
              }
              if (part.type === "finish") {
                finishReason = part.finishReason
                continue
              }
              if (part.type !== "text-delta") continue
              text += part.text
              const parsed = parsePromptRefineText(text)
              if (!parsed) continue
              controller.abort()
              return parsed
            }
            const parsed = parsePromptRefineText(text)
            if (parsed) return parsed
            throw new Error(`Studio prompt refine did not return valid JSON. timedOut=${timedOut} elapsed=${Date.now() - startedAt} finishReason=${finishReason ?? "unknown"} abortReason=${abortReason ?? "unknown"} raw=${promptRefineTextPreview(text)}`)
          } finally {
            clearTimeout(timeout)
          }
        })
      }),
    )
    return {
      assistantText: result.assistantText.trim(),
      refinedPrompt: result.refinedPrompt.trim(),
      effectivePrompt: result.refinedPrompt.trim(),
      raw: result,
    }
  } catch (error) {
    console.warn("[studio.service] prompt refine failed", {
      sessionID: session.id,
      capability: input.capability,
      error,
    })
    return promptRefineFallback(input, previous)
  }
}

function persistStudioSession(input: {
  generationID: string
  sessionID: SessionID
  request: StudioGenerationPromptInput
  provider: StudioProvider
  promptRefine: StudioPromptRefineResult
  createdAt: number
}): StudioPersistedTurn | undefined {
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
  )
  if (!session) return

  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()
  const userTextPartID = PartID.ascending()
  const assistantTextPartID = PartID.ascending()
  const toolPartID = PartID.ascending()
  const assistantText = input.promptRefine.assistantText
  const displayPrompt = input.request.displayPrompt?.trim() || input.request.prompt
  const providerID = session.model ? ProviderID.make(session.model.providerID) : ProviderID.make("octo_studio")
  const modelID = session.model ? ModelID.make(session.model.id) : ModelID.make("octo_studio")
  const modelVariant = session.model?.variant
  const userInfo: MessageV2.User = {
    id: userID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.createdAt },
    agent: session.agent ?? "octo_studio",
    model: {
      providerID,
      modelID,
      variant: modelVariant,
    },
  }
  const assistantInfo: MessageV2.Assistant = {
    id: assistantID,
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: input.createdAt },
    parentID: userID,
    modelID,
    providerID,
    mode: "octo_studio",
    agent: "octo_studio",
    path: {
      cwd: session.directory,
      root: session.directory,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "tool-calls",
    variant: modelVariant,
  }
  const userTextPart: MessageV2.TextPart = {
    id: userTextPartID,
    sessionID: input.sessionID,
    messageID: userID,
    type: "text",
    text: displayPrompt,
  }
  const assistantTextPart: MessageV2.TextPart = {
    id: assistantTextPartID,
    sessionID: input.sessionID,
    messageID: assistantID,
    type: "text",
    text: assistantText,
  }
  const toolPart: StudioPersistedTurn["toolPart"] = {
    id: toolPartID,
    sessionID: input.sessionID,
    messageID: assistantID,
    type: "tool",
    callID: `studio_${toolPartID}`,
    tool: toolName(input.provider),
    state: {
      status: "running",
      input: {
        capability: input.request.capability,
        prompt: input.request.prompt,
        displayPrompt: input.request.displayPrompt,
        styleModel: isEditorGenerationCapability(input.request.capability) ? undefined : input.request.styleModel,
        aspectRatio: isEditorGenerationCapability(input.request.capability) ? undefined : input.request.aspectRatio,
        count: isEditorGenerationCapability(input.request.capability) ? undefined : input.request.count,
        referenceImages: input.request.referenceImages,
        sourceImage: input.request.sourceImage,
        refinedPrompt: input.promptRefine.refinedPrompt,
        effectivePrompt: input.promptRefine.effectivePrompt,
        promptRefineFallback: input.promptRefine.fallback,
        extra: input.request.extra,
      },
      title: "图片生成",
      metadata: {
        studio: {
          generationID: input.generationID,
          status: "queued",
          progress: 0,
        },
      },
      time: { start: input.createdAt },
    },
  }

  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: userInfo })
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: userTextPart, time: input.createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: assistantTextPart, time: input.createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: input.createdAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: input.createdAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
  return {
    assistantInfo,
    toolPart,
  }
}

export async function createEditorEntry(input: StudioEditorEntryRequest): Promise<StudioEditorEntryResult> {
  const sessionID = SessionID.zod.parse(input.sessionID)
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!session) throw new Error(`Studio session not found: ${sessionID}`)
  if (session.directory !== Instance.directory) throw new Error(`Studio session does not belong to the current directory: ${sessionID}`)
  if (session.agent !== "octo_studio") throw new Error(`Session is not a Studio session: ${sessionID}`)

  const callID = `studio_editor_entry_${input.entryID}`
  const existing = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.session_id, sessionID)).all(),
  ).find((row) => {
    const part = { ...row.data, id: row.id, messageID: row.message_id, sessionID: row.session_id } as MessageV2.Part
    return part.type === "tool" && part.callID === callID
  })
  if (existing) {
    const assistant = Database.use((db) =>
      db.select().from(MessageTable).where(eq(MessageTable.id, existing.message_id)).get(),
    )
    const assistantInfo = assistant
      ? { ...assistant.data, id: assistant.id, sessionID: assistant.session_id } as MessageV2.Info
      : undefined
    const parentID = assistantInfo?.role === "assistant" ? assistantInfo.parentID : undefined
    if (parentID) {
      return {
        entryID: input.entryID,
        userMessageID: parentID,
        assistantMessageID: existing.message_id,
      }
    }
  }

  const createdAt = Date.now()
  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()
  const providerID = session.model ? ProviderID.make(session.model.providerID) : ProviderID.make("octo_studio")
  const modelID = session.model ? ModelID.make(session.model.id) : ModelID.make("octo_studio")
  const userInfo: MessageV2.User = {
    id: userID,
    sessionID,
    role: "user",
    time: { created: createdAt },
    agent: "octo_studio",
    model: {
      providerID,
      modelID,
      variant: session.model?.variant,
    },
  }
  const assistantInfo: MessageV2.Assistant = {
    id: assistantID,
    sessionID,
    role: "assistant",
    time: { created: createdAt, completed: createdAt },
    parentID: userID,
    modelID,
    providerID,
    mode: "octo_studio",
    agent: "octo_studio",
    path: {
      cwd: session.directory,
      root: session.directory,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "tool-calls",
    variant: session.model?.variant,
  }
  const userTextPart: MessageV2.TextPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: userID,
    type: "text",
    text: editorCapabilityLabel(input.capability),
  }
  const assistantTextPart: MessageV2.TextPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: assistantID,
    type: "text",
    text: "点击前往编辑区",
  }
  const toolPart: MessageV2.ToolPart = {
    id: PartID.ascending(),
    sessionID,
    messageID: assistantID,
    type: "tool",
    callID,
    tool: "studio_editor_entry",
    state: {
      status: "completed",
      input: {
        capability: input.capability,
        entryID: input.entryID,
      },
      output: JSON.stringify({
        type: "editor_entry",
        capability: input.capability,
        entryID: input.entryID,
      }),
      title: `进入${editorCapabilityLabel(input.capability)}编辑区`,
      metadata: {
        studio: {
          type: "editor_entry",
          capability: input.capability,
          entryID: input.entryID,
        },
      },
      time: {
        start: createdAt,
        end: createdAt,
      },
    },
  }

  SyncEvent.run(MessageV2.Event.Updated, { sessionID, info: userInfo })
  SyncEvent.run(MessageV2.Event.Updated, { sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID, part: userTextPart, time: createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID, part: assistantTextPart, time: createdAt })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID, part: toolPart, time: createdAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: createdAt }).where(eq(SessionTable.id, sessionID)).run(),
  )
  return {
    entryID: input.entryID,
    userMessageID: userID,
    assistantMessageID: assistantID,
  }
}

function completeStudioSession(input: {
  sessionID: SessionID
  turn: StudioPersistedTurn
  result: StudioGenerationResult & { completedAt: number }
}) {
  const assistantInfo: MessageV2.Assistant = {
    ...input.turn.assistantInfo,
    time: {
      ...input.turn.assistantInfo.time,
      completed: input.result.completedAt,
    },
  }
  const toolPart: MessageV2.ToolPart = {
    ...input.turn.toolPart,
    state: {
      status: "completed",
      title: "图片生成",
      input: input.turn.toolPart.state.input,
      output: JSON.stringify(
        {
          ok: true,
          provider: input.result.provider,
          capability: input.result.capability,
          toolAction: input.result.toolAction ?? toolActionForCapability(input.result.capability),
          taskId: input.result.taskId,
          model: input.result.model,
          aspectRatio: input.result.aspectRatio,
          videoMode: input.result.videoMode,
          duration: input.result.duration,
          videoQualityMode: input.result.videoQualityMode,
          width: input.result.images[0]?.width,
          height: input.result.images[0]?.height,
          imageCount: input.result.images.length,
          images: input.result.images.filter((image) => !isVideoKind(image.kind)).map((image) => image.remoteUrl ?? image.url),
          videos: input.result.images.filter((image) => isVideoKind(image.kind)).map((image) => image.remoteUrl ?? image.url),
          primaryImage: input.result.images.find((image) => !isVideoKind(image.kind))?.remoteUrl ?? input.result.images.find((image) => !isVideoKind(image.kind))?.url ?? null,
          primaryVideo: input.result.images.find((image) => isVideoKind(image.kind))?.remoteUrl ?? input.result.images.find((image) => isVideoKind(image.kind))?.url ?? null,
          progress: input.result.progress,
          order: input.result.order,
          rawStatus: input.result.rawStatus,
          response: input.result.response,
        },
        null,
        2,
      ),
      metadata: stripUndefined({
        request: input.result.request,
        response: input.result.response,
        statusCode: 200,
        studio: {
          generationID: input.result.id,
          status: "succeeded",
          rawStatus: input.result.rawStatus,
          progress: 100,
        },
      }) as Record<string, unknown>,
      time: {
        start: input.turn.toolPart.state.time.start,
        end: input.result.completedAt,
      },
      attachments: input.result.images.map((image, index) => ({
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: input.turn.toolPart.messageID,
        type: "file" as const,
        mime: isVideoKind(image.kind) ? "video/mp4" : "image/png",
        filename: `${input.result.prompt.slice(0, 24).replace(/[\\/:*?"<>|]/g, "-") || (isVideoKind(image.kind) ? "studio-video" : "studio-image")}-${index + 1}.${isVideoKind(image.kind) ? "mp4" : "png"}`,
        url: image.remoteUrl ?? image.url,
      })),
    },
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: input.result.completedAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: input.result.completedAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
}

function failStudioSession(input: {
  sessionID: SessionID
  turn: StudioPersistedTurn
  error: unknown
  rawStatus?: number | string
  studioStatus?: Extract<StudioGenerationStatus, "create_failed" | "failed">
}) {
  const completedAt = Date.now()
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const assistantInfo: MessageV2.Assistant = {
    ...input.turn.assistantInfo,
    time: {
      ...input.turn.assistantInfo.time,
      completed: completedAt,
    },
    finish: "error",
  }
  const toolPart: MessageV2.ToolPart = {
    ...input.turn.toolPart,
    state: {
      status: "error",
      input: input.turn.toolPart.state.input,
      error: message,
      metadata: {
        ...input.turn.toolPart.state.metadata,
        statusCode: 500,
        studio: {
          ...((input.turn.toolPart.state.metadata?.studio as Record<string, unknown> | undefined) ?? {}),
          status: input.studioStatus ?? "failed",
          ...(input.rawStatus === undefined ? {} : { rawStatus: input.rawStatus }),
        },
      },
      time: {
        start: input.turn.toolPart.state.time.start,
        end: completedAt,
      },
    },
  }
  SyncEvent.run(MessageV2.Event.Updated, { sessionID: input.sessionID, info: assistantInfo })
  SyncEvent.run(MessageV2.Event.PartUpdated, { sessionID: input.sessionID, part: toolPart, time: completedAt })
  Database.use((db) =>
    db.update(SessionTable).set({ time_updated: completedAt }).where(eq(SessionTable.id, input.sessionID)).run(),
  )
}

function failGenerationCreation(input: {
  id: string
  sessionID: SessionID
  turn: StudioPersistedTurn
  error: unknown
}) {
  const completedAt = Date.now()
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({
        status: "create_failed",
        error: message,
        completed_at: completedAt,
        next_poll_at: Number.MAX_SAFE_INTEGER,
        time_updated: completedAt,
      })
      .where(eq(StudioGenerationTable.id, input.id))
      .run(),
  )
  failStudioSession({
    sessionID: input.sessionID,
    turn: input.turn,
    error: message,
    studioStatus: "create_failed",
  })
}

function generationRequest(record: StudioGenerationRecord) {
  const data = record.request as { input?: StudioGenerationRequest; task?: ImageGenerationTask }
  if (!data.input) throw new Error(`Studio generation ${record.id} has no request input.`)
  return data as { input: StudioGenerationRequest; task?: ImageGenerationTask }
}

function loadPersistedTurn(record: StudioGenerationRecord): StudioPersistedTurn {
  const assistant = Database.use((db) =>
    db.select({ data: MessageTable.data }).from(MessageTable).where(eq(MessageTable.id, record.assistant_message_id)).get(),
  )
  const part = Database.use((db) =>
    db.select({ data: PartTable.data }).from(PartTable).where(eq(PartTable.id, record.tool_part_id)).get(),
  )
  if (!assistant || !part) throw new Error(`Studio generation ${record.id} session turn is missing.`)
  const assistantInfo = { ...assistant.data, id: record.assistant_message_id, sessionID: record.session_id } as MessageV2.Assistant
  const toolPart = {
    ...part.data,
    id: record.tool_part_id,
    sessionID: record.session_id,
    messageID: record.assistant_message_id,
  } as MessageV2.ToolPart
  if (toolPart.state.status !== "running") throw new Error(`Studio generation ${record.id} tool part is not running.`)
  return {
    assistantInfo,
    toolPart: toolPart as MessageV2.ToolPart & { state: MessageV2.ToolStateRunning },
  }
}

function generationSnapshot(record: StudioGenerationRecord): StudioGenerationAccepted {
  const data = generationRequest(record)
  const result = record.result as StudioGenerationResult | undefined
  return {
    id: record.id,
    sessionID: record.session_id,
    status: record.status,
    capability: record.capability,
    prompt: generationPrompt(data.input),
    displayPrompt: data.input.displayPrompt,
    provider: record.provider,
    model: result?.model ?? data.task?.model ?? data.input.styleModel ?? "internel",
    aspectRatio: result?.aspectRatio ?? data.input.aspectRatio ?? "3:4",
    taskId: result?.taskId ?? data.task?.taskId ?? record.provider_task_id ?? undefined,
    images: result?.images ?? [],
    progress: record.progress,
    order: record.queue_order ?? undefined,
    rawStatus: record.raw_status ?? undefined,
    ...(record.error ? { error: record.error } : {}),
    createdAt: record.time_created,
    updatedAt: record.time_updated,
    ...(record.completed_at ? { completedAt: record.completed_at } : {}),
  }
}

function updateStudioGenerationProgress(record: StudioGenerationRecord, query: ImageGenerationQuery) {
  const updatedAt = Date.now()
  const updated = Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({
        status: query.status,
        raw_status: String(query.rawStatus),
        progress: query.progress,
        queue_order: query.order,
        error: null,
        poll_attempts: record.poll_attempts + 1,
        next_poll_at: updatedAt + (query.status === "queued" ? 4000 : 2500),
        time_updated: updatedAt,
      })
      .where(and(
        eq(StudioGenerationTable.id, record.id),
        inArray(StudioGenerationTable.status, ["queued", "running"]),
      ))
      .returning({ id: StudioGenerationTable.id })
      .get(),
  )
  if (!updated) return false
  const current = Database.use((db) =>
    db
      .select({ status: StudioGenerationTable.status })
      .from(StudioGenerationTable)
      .where(eq(StudioGenerationTable.id, record.id))
      .get(),
  )
  if (!current || current.status !== "queued" && current.status !== "running") return false
  const turn = loadPersistedTurn(record)
  const toolPart: MessageV2.ToolPart = {
    ...turn.toolPart,
    state: {
      ...turn.toolPart.state,
      metadata: {
        ...turn.toolPart.state.metadata,
        studio: {
          generationID: record.id,
          status: query.status,
          rawStatus: query.rawStatus,
          progress: query.progress,
          order: query.order,
        },
      },
    },
  }
  SyncEvent.run(MessageV2.Event.PartUpdated, {
    sessionID: record.session_id,
    part: toolPart,
    time: updatedAt,
  })
  return true
}

function buildGenerationResult(
  record: StudioGenerationRecord,
  output: ImageGenerationQuery | ImageGenerateOutput,
) {
  const input = generationRequest(record).input
  const completedAt = Date.now()
  return stripUndefined({
    id: record.id,
    status: "succeeded",
    capability: input.capability,
    prompt: generationPrompt(input),
    displayPrompt: input.displayPrompt,
    provider: output.provider,
    toolAction: output.toolAction ?? toolActionForCapability(input.capability),
    taskId: output.taskId,
    model: output.model,
    aspectRatio: input.aspectRatio ?? "3:4",
    ...(input.capability === "video.generate"
      ? {
          videoMode: videoMode(input),
          duration: videoDuration(input),
          videoQualityMode: videoQualityMode(input),
        }
      : {}),
    images: output.images.map((image, index) => ({
      id: `studio_img_${record.id}_${index}`,
      ...(image.kind ? { kind: image.kind } : {}),
      url: image.url,
      thumbnailUrl: image.thumbnailUrl ?? image.url,
      remoteUrl: image.url,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}),
      ...(image.duration !== undefined ? { duration: image.duration } : {}),
    })),
    request: stripUndefined(output.request),
    response: stripUndefined(resultSummary({ provider: record.provider, raw: output.raw, rawBody: output.rawBody })),
    progress: 100,
    rawStatus: "rawStatus" in output ? output.rawStatus : 2,
    createdAt: record.time_created,
    updatedAt: completedAt,
    completedAt,
  }) as StudioGenerationResult & { completedAt: number }
}

async function failGeneration(record: StudioGenerationRecord, error: unknown, rawStatus?: number | string) {
  const message = error instanceof Error ? error.message : String(error)
  const completedAt = Date.now()
  const claimed = Database.transaction(
    (db) => {
      const current = db
        .select({ status: StudioGenerationTable.status })
        .from(StudioGenerationTable)
        .where(eq(StudioGenerationTable.id, record.id))
        .get()
      if (!current || current.status !== "queued" && current.status !== "running") return false
      db
        .update(StudioGenerationTable)
        .set({
          status: "failed",
          ...(rawStatus === undefined ? {} : { raw_status: String(rawStatus) }),
          error: message,
          completed_at: completedAt,
          next_poll_at: Number.MAX_SAFE_INTEGER,
          time_updated: completedAt,
        })
        .where(eq(StudioGenerationTable.id, record.id))
        .run()
      return true
    },
    { behavior: "immediate" },
  )
  if (!claimed) return
  failStudioSession({
    sessionID: record.session_id,
    turn: loadPersistedTurn(record),
    error,
    rawStatus,
  })
}

async function completeGeneration(record: StudioGenerationRecord, output: ImageGenerationQuery | ImageGenerateOutput) {
  if (output.images.length === 0) {
    throw new Error(
      [
        `${record.provider} image generation returned no image URLs.`,
        `request=${JSON.stringify(output.request)}`,
        `response=${JSON.stringify(resultSummary({ provider: record.provider, raw: output.raw, rawBody: output.rawBody }))}`,
      ].join("\n"),
    )
  }
  const result = buildGenerationResult(record, output)
  const claimed = Database.transaction(
    (db) => {
      const current = db
        .select({ status: StudioGenerationTable.status })
        .from(StudioGenerationTable)
        .where(eq(StudioGenerationTable.id, record.id))
        .get()
      if (!current || current.status !== "queued" && current.status !== "running") return false
      db
        .update(StudioGenerationTable)
        .set({
          status: "succeeded",
          raw_status: String(result.rawStatus ?? 2),
          progress: 100,
          queue_order: null,
          error: null,
          result: result as unknown as Record<string, unknown>,
          completed_at: result.completedAt,
          next_poll_at: Number.MAX_SAFE_INTEGER,
          time_updated: result.completedAt,
        })
        .where(eq(StudioGenerationTable.id, record.id))
        .run()
      return true
    },
    { behavior: "immediate" },
  )
  if (!claimed) return
  completeStudioSession({ sessionID: record.session_id, turn: loadPersistedTurn(record), result })
}

async function processGeneration(record: StudioGenerationRecord) {
  try {
    if (Date.now() - record.time_created > 30 * 60_000) {
      throw new Error(`Studio generation timed out after 30 minutes. id=${record.id}`)
    }
    const data = generationRequest(record)
    if (record.provider === "jimeng") {
      await completeGeneration(
        record,
        await executeJimengImageGenerate({
          capability: data.input.capability,
          prompt: generationPrompt(data.input),
          styleModel: data.input.styleModel,
          aspectRatio: data.input.aspectRatio,
          count: data.input.count,
          referenceImages: data.input.referenceImages,
          sourceImage: data.input.sourceImage,
          extra: data.input.extra,
        }),
      )
      return
    }

    const task = data.task
    if (!task) throw new Error(`Studio generation ${record.id} has no provider task id.`)
    if (!record.provider_task_id) {
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({
            provider_task_id: task.taskId,
            request: stripUndefined({ input: data.input, task }) as Record<string, unknown>,
            status: "running",
            time_updated: Date.now(),
          })
          .where(eq(StudioGenerationTable.id, record.id))
          .run(),
      )
    }
    const query = await queryInternalGeneration(task)
    if (query.status === "succeeded") {
      await completeGeneration(record, query)
      return
    }
    if (query.status === "failed") {
      await failGeneration(
        record,
        Number(query.rawStatus) === 4
          ? "用户取消生成"
          : `query_task returned failure. taskId=${task.taskId} status=${query.rawStatus}`,
        query.rawStatus,
      )
      return
    }
    updateStudioGenerationProgress(record, query)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      Date.now() - record.time_created < 30 * 60_000 &&
      (/network failed/i.test(message) || /status=(408|409|425|429|500|502|503|504)/.test(message))
    ) {
      Database.use((db) =>
        db
          .update(StudioGenerationTable)
          .set({
            error: message,
            poll_attempts: record.poll_attempts + 1,
            next_poll_at: Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(record.poll_attempts, 5)),
            time_updated: Date.now(),
          })
          .where(and(
            eq(StudioGenerationTable.id, record.id),
            inArray(StudioGenerationTable.status, ["queued", "running"]),
          ))
          .run(),
      )
      return
    }
    await failGeneration(record, error)
  }
}

async function createProviderTask(input: StudioGenerationPromptInput, provider: StudioProvider) {
  if (provider !== "internel") return
  return createInternalGeneration({
    capability: input.capability,
    prompt: generationPrompt(input),
    styleModel: isEditorGenerationCapability(input.capability) ? undefined : input.styleModel,
    aspectRatio: isEditorGenerationCapability(input.capability) ? undefined : input.aspectRatio,
    count: isEditorGenerationCapability(input.capability) ? undefined : input.count,
    referenceImages: input.referenceImages,
    sourceImage: input.sourceImage,
    extra: input.extra,
  })
}

const workerTimers = new Map<string, ReturnType<typeof setInterval>>()
const activeGenerations = new Set<string>()

async function tickStudioGenerationWorker(directory: string) {
  const now = Date.now()
  const records = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(
        and(
          eq(StudioGenerationTable.directory, directory),
          inArray(StudioGenerationTable.status, ["queued", "running"]),
          lte(StudioGenerationTable.next_poll_at, now),
        ),
      )
      .limit(4)
      .all(),
  )
  await Promise.all(
    records
      .filter((record) => !activeGenerations.has(record.id))
      .map(async (record) => {
        const claimed = Database.transaction(
          (db) => {
            const current = db
              .select({
                next_poll_at: StudioGenerationTable.next_poll_at,
                status: StudioGenerationTable.status,
              })
              .from(StudioGenerationTable)
              .where(eq(StudioGenerationTable.id, record.id))
              .get()
            if (!current || current.status !== "queued" && current.status !== "running" || current.next_poll_at > now) return false
            db
              .update(StudioGenerationTable)
              .set({ next_poll_at: now + 60_000, time_updated: now })
              .where(and(
                eq(StudioGenerationTable.id, record.id),
                inArray(StudioGenerationTable.status, ["queued", "running"]),
              ))
              .run()
            return true
          },
          { behavior: "immediate" },
        )
        if (!claimed) return
        activeGenerations.add(record.id)
        await processGeneration(record).finally(() => activeGenerations.delete(record.id))
      }),
  )
}

export function startStudioGenerationWorker() {
  const directory = Instance.directory
  if (workerTimers.has(directory)) return
  const tick = Instance.bind(() => tickStudioGenerationWorker(directory).catch((error) => {
    console.error("[studio.worker] tick failed", error)
  }))
  workerTimers.set(directory, setInterval(tick, 1000))
  void tick()
}

registerDisposer(async (directory) => {
  const timer = workerTimers.get(directory)
  if (!timer) return
  clearInterval(timer)
  workerTimers.delete(directory)
})

export async function createGeneration(input: StudioGenerationRequest): Promise<StudioGenerationAccepted> {
  const sessionID = SessionID.zod.parse(input.sessionID)
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!session) throw new Error(`Studio session not found: ${sessionID}`)
  if (session.directory !== Instance.directory) throw new Error(`Studio session does not belong to the current directory: ${sessionID}`)
  const createdAt = Date.now()
  const id = Identifier.create("studio_gen", "ascending")
  const provider = resolveProvider(input)
  const promptRefine = await refineStudioPrompt(input, session)
  const generationInput: StudioGenerationPromptInput = {
    ...input,
    displayPrompt: input.displayPrompt,
    refinedPrompt: promptRefine.refinedPrompt,
    effectivePrompt: promptRefine.effectivePrompt,
    promptRefineFallback: promptRefine.fallback,
  }
  const turn = persistStudioSession({
    generationID: id,
    sessionID,
    request: generationInput,
    provider,
    promptRefine,
    createdAt,
  })
  if (!turn) throw new Error(`Unable to create Studio session turn: ${sessionID}`)
  Database.use((db) =>
    db.insert(StudioGenerationTable).values({
      id,
      session_id: sessionID,
      directory: session.directory,
      assistant_message_id: turn.assistantInfo.id,
      tool_part_id: turn.toolPart.id,
      provider,
      capability: input.capability,
      status: "queued",
      progress: 0,
      request: stripUndefined({ input: generationInput }) as Record<string, unknown>,
      next_poll_at: Number.MAX_SAFE_INTEGER,
      time_created: createdAt,
      time_updated: createdAt,
    }).run(),
  )
  const created = await createProviderTask(generationInput, provider).then(
    (task) => ({ task } as const),
    (error) => ({ error } as const),
  )
  if ("error" in created) {
    failGenerationCreation({ id, sessionID, turn, error: created.error })
    return getGeneration(id)
  }
  const task = created.task
  Database.use((db) =>
    db
      .update(StudioGenerationTable)
      .set({
        provider_task_id: task?.taskId,
        status: task ? "running" : "queued",
        request: stripUndefined({ input: displayInput(generationInput, task), task }) as Record<string, unknown>,
        next_poll_at: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(StudioGenerationTable.id, id))
      .run(),
  )
  startStudioGenerationWorker()
  const record = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.id, id), eq(StudioGenerationTable.directory, Instance.directory)))
      .get(),
  )
  if (!record) throw new Error(`Unable to load Studio generation: ${id}`)
  return generationSnapshot(record)
}

export async function getGeneration(id: string): Promise<StudioGenerationResult & { sessionID: string }> {
  const record = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.id, id), eq(StudioGenerationTable.directory, Instance.directory)))
      .get(),
  )
  if (!record) throw new Error(`Studio generation not found: ${id}`)
  const snapshot = generationSnapshot(record)
  return {
    ...snapshot,
    ...(record.result as StudioGenerationResult | undefined),
    sessionID: record.session_id,
    status: record.status,
    progress: record.progress,
    order: record.queue_order ?? undefined,
    rawStatus: record.raw_status ?? undefined,
    error: record.error ?? undefined,
    updatedAt: record.time_updated,
    completedAt: record.completed_at ?? undefined,
  }
}

export async function cancelGeneration(id: string): Promise<StudioGenerationResult & { sessionID: string }> {
  const record = Database.use((db) =>
    db
      .select()
      .from(StudioGenerationTable)
      .where(and(eq(StudioGenerationTable.id, id), eq(StudioGenerationTable.directory, Instance.directory)))
      .get(),
  )
  if (!record) throw new Error(`Studio generation not found: ${id}`)
  if (record.status === "failed" && record.raw_status === "4") return getGeneration(id)
  if (record.status === "succeeded") throw new Error(`Studio generation is already completed and cannot be cancelled: ${id}`)
  if (record.status === "failed") throw new Error(`Studio generation has already failed and cannot be cancelled: ${id}`)
  if (record.provider !== "internel") throw new Error(`Studio generation provider does not support cancellation: ${record.provider}`)
  if (!record.provider_task_id) throw new Error(`Studio generation has no provider task id and cannot be cancelled: ${id}`)

  await cancelInternalGeneration(record.provider_task_id)

  const completedAt = Date.now()
  const claimed = Database.transaction(
    (db) => {
      const current = db
        .select({ status: StudioGenerationTable.status, raw_status: StudioGenerationTable.raw_status })
        .from(StudioGenerationTable)
        .where(eq(StudioGenerationTable.id, id))
        .get()
      if (!current) return "missing" as const
      if (current.status !== "queued" && current.status !== "running") {
        return current.status === "failed" && current.raw_status === "4" ? "cancelled" as const : "terminal" as const
      }
      db
        .update(StudioGenerationTable)
        .set({
          status: "failed",
          raw_status: "4",
          error: "用户取消生成",
          queue_order: null,
          next_poll_at: Number.MAX_SAFE_INTEGER,
          completed_at: completedAt,
          time_updated: completedAt,
        })
        .where(eq(StudioGenerationTable.id, id))
        .run()
      return "claimed" as const
    },
    { behavior: "immediate" },
  )
  if (claimed === "missing") throw new Error(`Studio generation not found: ${id}`)
  if (claimed === "terminal") return getGeneration(id)
  if (claimed === "claimed") {
    failStudioSession({
      sessionID: record.session_id,
      turn: loadPersistedTurn(record),
      error: "用户取消生成",
      rawStatus: 4,
    })
  }
  return getGeneration(id)
}
