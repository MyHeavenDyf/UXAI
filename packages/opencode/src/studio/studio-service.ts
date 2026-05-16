import { executeJimengImageGenerate, summarizeJimengOutput } from "@/tool/jimeng_image_generate"
import { executeInternelImageGenerate, summarizeInternalOutput } from "@/tool/internel_image_generate"
import * as Database from "@/storage/db"
import { eq } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import type { StudioCapability } from "./image-provider"

type StudioProvider = "jimeng" | "internel"

export type StudioGenerationRequest = {
  sessionID?: string
  capability: StudioCapability
  prompt: string
  styleModel?: string
  aspectRatio?: string
  count?: number
  imageTool?: StudioProvider
  referenceImages?: string[]
  sourceImage?: string
  extra?: Record<string, unknown>
}

export type StudioGenerationResult = {
  id: string
  status: "succeeded"
  capability: StudioCapability
  prompt: string
  provider: StudioProvider
  model: string
  aspectRatio: string
  images: { id: string; url: string; thumbnailUrl?: string; remoteUrl?: string; width?: number; height?: number }[]
  request?: unknown
  response?: unknown
  rawBody?: string
  createdAt: number
  completedAt: number
}

function resolveProvider(input: StudioGenerationRequest): StudioProvider {
  if (input.imageTool) return input.imageTool
  if (input.extra?.imageTool === "internel") return "internel"
  return "jimeng"
}

function buildAssistantText(input: StudioGenerationRequest) {
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

async function persistStudioSession(input: {
  sessionID: SessionID
  request: StudioGenerationRequest
  result: StudioGenerationResult
}) {
  const session = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
  )
  if (!session) return

  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()
  const userTextPartID = PartID.ascending()
  const assistantTextPartID = PartID.ascending()
  const toolPartID = PartID.ascending()
  const provider = resolveProvider(input.request)
  const assistantText = buildAssistantText(input.request)
  const providerID = session.model ? ProviderID.make(session.model.providerID) : ProviderID.make("octo_studio")
  const modelID = session.model ? ModelID.make(session.model.id) : ModelID.make("octo_studio")
  const modelVariant = session.model?.variant
  const userInfo: Omit<MessageV2.User, "id" | "sessionID"> = {
    role: "user",
    time: { created: input.result.createdAt },
    agent: session.agent ?? "octo_studio",
    model: {
      providerID,
      modelID,
      variant: modelVariant,
    },
  }
  const assistantInfo: Omit<MessageV2.Assistant, "id" | "sessionID"> = {
    role: "assistant",
    time: { created: input.result.createdAt, completed: input.result.completedAt },
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
  const userTextPart: Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID"> = {
    type: "text",
    text: input.request.prompt,
  }
  const assistantTextPart: Omit<MessageV2.TextPart, "id" | "sessionID" | "messageID"> = {
    type: "text",
    text: assistantText,
  }
  const toolPart: Omit<MessageV2.ToolPart, "id" | "sessionID" | "messageID"> = {
    type: "tool",
    callID: `studio_${input.result.id}`,
    tool: toolName(provider),
    state: {
      status: "completed",
      title: "图片生成",
      input: {
        prompt: input.request.prompt,
        styleModel: input.request.styleModel,
        aspectRatio: input.request.aspectRatio,
        count: input.request.count,
        referenceImages: input.request.referenceImages,
        sourceImage: input.request.sourceImage,
        extra: input.request.extra,
      },
      output: JSON.stringify(
        {
          ok: true,
          provider: input.result.provider,
          model: input.result.model,
          images: input.result.images.map((image) => image.remoteUrl ?? image.url),
          primaryImage: input.result.images[0]?.remoteUrl ?? input.result.images[0]?.url ?? null,
          response: input.result.response,
        },
        null,
        2,
      ),
      metadata: {
        request: input.result.request,
        response: input.result.response,
      },
      time: {
        start: input.result.createdAt,
        end: input.result.completedAt,
      },
      attachments: input.result.images.map((image, index) => ({
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: assistantID,
        type: "file" as const,
        mime: "image/png",
        filename: `${input.result.prompt.slice(0, 24).replace(/[\\/:*?"<>|]/g, "-") || "studio-image"}-${index + 1}.png`,
        url: image.remoteUrl ?? image.url,
      })),
    },
  }

  Database.use((db) => {
    db.insert(MessageTable)
      .values([
        {
          id: userID,
          session_id: input.sessionID,
          time_created: input.result.createdAt,
          time_updated: input.result.createdAt,
          data: userInfo,
        },
        {
          id: assistantID,
          session_id: input.sessionID,
          time_created: input.result.createdAt,
          time_updated: input.result.completedAt,
          data: assistantInfo,
        },
      ])
      .run()

    db.insert(PartTable)
      .values([
        {
          id: userTextPartID,
          message_id: userID,
          session_id: input.sessionID,
          time_created: input.result.createdAt,
          time_updated: input.result.createdAt,
          data: userTextPart,
        },
        {
          id: assistantTextPartID,
          message_id: assistantID,
          session_id: input.sessionID,
          time_created: input.result.createdAt,
          time_updated: input.result.completedAt,
          data: assistantTextPart,
        },
        {
          id: toolPartID,
          message_id: assistantID,
          session_id: input.sessionID,
          time_created: input.result.createdAt,
          time_updated: input.result.completedAt,
          data: toolPart,
        },
      ])
      .run()

    db.update(SessionTable)
      .set({ time_updated: input.result.completedAt })
      .where(eq(SessionTable.id, input.sessionID))
      .run()
  })
}

export async function createGeneration(input: StudioGenerationRequest): Promise<StudioGenerationResult> {
  const createdAt = Date.now()
  const provider = resolveProvider(input)
  console.log("[studio.service] create generation", {
    sessionID: input.sessionID,
    capability: input.capability,
    prompt: input.prompt,
    styleModel: input.styleModel,
    aspectRatio: input.aspectRatio,
    count: input.count,
    provider,
    referenceImageCount: input.referenceImages?.length ?? 0,
    hasSourceImage: Boolean(input.sourceImage),
  })

  const output = provider === "internel"
    ? await executeInternelImageGenerate({
        capability: input.capability,
        prompt: input.prompt,
        styleModel: input.styleModel,
        aspectRatio: input.aspectRatio,
        count: input.count,
        referenceImages: input.referenceImages,
        sourceImage: input.sourceImage,
        extra: input.extra,
      })
    : await executeJimengImageGenerate({
        capability: input.capability,
        prompt: input.prompt,
        styleModel: input.styleModel,
        aspectRatio: input.aspectRatio,
        count: input.count,
        referenceImages: input.referenceImages,
        sourceImage: input.sourceImage,
        extra: input.extra,
      })

  console.log("[studio.service] generation tool result", {
    provider: output.provider,
    model: output.model,
    statusCode: output.statusCode,
    imageCount: output.images.length,
  })

  if (output.images.length === 0) {
    throw new Error(
      [
        `${provider} image generation returned no image URLs.`,
        `request=${JSON.stringify(output.request)}`,
        `response=${JSON.stringify(resultSummary({ provider, raw: output.raw, rawBody: output.rawBody }))}`,
      ].join("\n"),
    )
  }

  const result = {
    id: `studio_gen_${createdAt}`,
    status: "succeeded" as const,
    capability: input.capability,
    prompt: input.prompt,
    provider: output.provider,
    model: output.model,
    aspectRatio: input.aspectRatio ?? "3:4",
    images: output.images.map((image, index) => ({
      id: `studio_img_${createdAt}_${index}`,
      url: image.url,
      thumbnailUrl: image.url,
      remoteUrl: image.url,
      width: image.width,
      height: image.height,
    })),
    request: output.request,
    response: resultSummary({ provider, raw: output.raw, rawBody: output.rawBody }),
    createdAt,
    completedAt: Date.now(),
  }

  if (input.sessionID) {
    await persistStudioSession({
      sessionID: SessionID.zod.parse(input.sessionID),
      request: input,
      result,
    })
  }

  return result
}
