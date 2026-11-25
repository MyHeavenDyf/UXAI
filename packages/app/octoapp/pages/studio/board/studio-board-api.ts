import z from "zod"
import { BoardDocument, BoardSubmission } from "@opencode-ai/core/studio-board"
import { authTokenFromCredentials } from "@/utils/server"
import { directoryHeader } from "@/utils/headers"

export const boardResponse = z.object({
  sessionID: z.string(),
  revision: z.number().int().nonnegative(),
  document: BoardDocument,
  pendingReboots: z
    .array(z.object({ cardID: z.string(), generationID: z.string(), operationID: z.string().uuid() }))
    .default([]),
})
export const boardGenerationRequest = z.object({
  sessionID: z.string().min(1),
  capability: z.enum(["image.generate", "video.generate", "image.upscale", "image.cutout", "image.inpaint"]),
  prompt: z.string().min(1),
  extra: z.object({ userIdx: z.string().optional() }).catchall(z.unknown()).optional(),
  board: BoardSubmission,
})
export type BoardGenerationRequest = z.infer<typeof boardGenerationRequest>

const pendingRequest = z.union([
  boardGenerationRequest,
  z.object({ cardID: z.string(), body: boardGenerationRequest, submission: BoardSubmission }).transform((item, ctx) => {
    if (item.cardID !== item.body.board.cardID || JSON.stringify(item.body.board) !== JSON.stringify(item.submission)) {
      ctx.addIssue({ code: "custom", message: "待确认提交信息不一致" })
      return z.NEVER
    }
    return item.body
  }),
])

export const boardBackup = z.object({
  creationID: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  document: BoardDocument,
  suppressed: z.array(z.string()).default([]),
  reboots: z.array(z.object({ cardID: z.string(), operationID: z.string().uuid() })).default([]),
  pending: z.array(pendingRequest),
})
export function readBoardBackup(key: string) {
  return Promise.resolve()
    .then(() => {
      const value = localStorage.getItem(key)
      return value ? boardBackup.parse(JSON.parse(value)) : undefined
    })
    .catch(() => {
      throw new Error("本地草稿备份格式异常或提交信息不一致，已保留备份，请检查后重试")
    })
}
export class BoardRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
export function boardErrorMessage(error: unknown, fallback = "画板操作失败") {
  if (typeof error === "string") return error || fallback
  if (!error || typeof error !== "object") return fallback
  const data = "data" in error ? error.data : undefined
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string")
    return data.message || fallback
  if ("message" in error && typeof error.message === "string") return error.message || fallback
  if ("error" in error && typeof error.error === "string") return error.error || fallback
  return fallback
}
export function createBoardRequest(http: { url: string; username?: string; password?: string }, directory: string) {
  const headers = {
    "Content-Type": "application/json",
    ...directoryHeader(directory),
    ...(http.password
      ? { Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}` }
      : {}),
  }
  return async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    if (!http.url) throw new Error("服务尚未就绪")
    const response = await fetch(new URL(path, http.url), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value: unknown = await response.json()
    if (!response.ok)
      throw new BoardRequestError(boardErrorMessage(value, `请求失败 (${response.status})`), response.status)
    return value as T
  }
}
