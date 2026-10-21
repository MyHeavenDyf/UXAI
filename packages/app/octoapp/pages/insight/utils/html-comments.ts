import { directoryHeader } from "@/utils/headers"
import type { FileComment, CommentAttachment, CommentPopoverTarget } from "../../make/components/result-viewer/comment-popover"

export function commentAuthor() {
  try {
    const user = JSON.parse(localStorage.getItem("userInfo") ?? "{}")
    return {
      commenterName: typeof user?.nickName === "string" ? user.nickName : "用户名",
      commenterAccount: typeof user?.account === "string" ? user.account : "",
    }
  } catch {
    return { commenterName: "用户名", commenterAccount: "" }
  }
}

/** 文件路径编码为一个安全目录名，避免服务端把斜杠改成下划线后同名串档。 */
export async function commentFileKey(path: string) {
  const normalized = path.replace(/\\/g, "/")
  const bytes = new TextEncoder().encode(/^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return `insight-${Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("")}`
}

export function commentTarget(value: unknown): CommentPopoverTarget | undefined {
  if (!value || typeof value !== "object") return
  const data = value as Record<string, unknown>
  if (typeof data.elementId !== "string" || typeof data.selector !== "string") return
  if (!data.position || typeof data.position !== "object") return
  const rect = data.position as Record<string, unknown>
  if (![rect.x, rect.y, rect.w, rect.h].every(n => typeof n === "number" && Number.isFinite(n))) return
  const point = data.hoverPoint as Record<string, unknown> | undefined
  return {
    elementId: data.elementId,
    selector: data.selector,
    label: typeof data.label === "string" ? data.label : "",
    text: typeof data.text === "string" ? data.text : "",
    htmlHint: typeof data.htmlHint === "string" ? data.htmlHint : "",
    contentSignature: typeof data.contentSignature === "string" ? data.contentSignature : undefined,
    nativeId: typeof data.nativeId === "string" ? data.nativeId : undefined,
    position: { x: rect.x as number, y: rect.y as number, w: rect.w as number, h: rect.h as number },
    hoverPoint: point && typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y } : undefined,
  }
}

export function createHtmlComments(origin: { url: string; directory: string; sessionId: string; filePath: string }, request = fetch) {
  const snapshot = { ...origin }
  const scope = commentFileKey(snapshot.filePath).then(commentFilePath => ({ sessionId: snapshot.sessionId, commentFilePath }))
  const query = async (extra: Record<string, string> = {}) => new URLSearchParams({ ...await scope, ...extra })
  const send = async (path: string, init?: RequestInit) => {
    const response = await request(`${snapshot.url}/comment/file${path}`, {
      ...init, headers: { "Content-Type": "application/json", ...directoryHeader(snapshot.directory) },
    })
    if (!response.ok) throw new Error("标注请求失败，请重试")
    const data = await response.json()
    if (data.ok === false) throw new Error("标注操作失败，请重试")
    return data
  }
  return {
    load: async (): Promise<FileComment[]> => (await send(`?${await query()}`)).comments,
    save: async (comment: FileComment) => send("", { method: "POST", body: JSON.stringify({ ...await scope, comment }) }),
    remove: async (commentId: string) => send(`?${await query({ commentId })}`, { method: "DELETE" }),
    upload: async (commentId: string, file: File, sourceFilePath: string): Promise<CommentAttachment> =>
      (await send("/attachment", { method: "POST", body: JSON.stringify({ ...await scope, commentId, sourceFilePath, filename: file.name, mime: file.type, size: file.size }) })).attachment,
    removeAttachment: async (commentId: string, attachmentId: string) =>
      send(`/attachment/${encodeURIComponent(attachmentId)}?${await query({ commentId })}`, { method: "DELETE" }),
  }
}
