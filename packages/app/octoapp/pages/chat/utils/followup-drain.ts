import { buildRequestParts } from "@/components/prompt-input/build-request-parts"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { ImageAttachmentPart } from "@/context/prompt"
import type { FollowupItem } from "./followup-queue"

type GlobalSDK = ReturnType<typeof useGlobalSDK>
type GlobalSync = ReturnType<typeof useGlobalSync>

const draftText = (prompt: FollowupItem["prompt"]) =>
  prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: FollowupItem["prompt"]): ImageAttachmentPart[] =>
  prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupBackground(
  globalSDK: GlobalSDK,
  globalSync: GlobalSync,
  sessionID: string,
  item: FollowupItem,
): Promise<void> {
  const directory = item.sessionDirectory
  if (!directory) {
    console.warn("[octo:chat-queue] drain skipped: missing directory", { sessionID })
    return
  }

  // 乐观更新 busy，与 sendFollowupDraft 行为对齐：避免 promptAsync 返回后、SSE 更新到达
  // 前的时间窗口里，reactively drain 的 effect 看到 idle 状态而重复发送。
  // 若发送失败则回滚 busy，否则 session 永久卡在 busy 无法继续 drain。
  const [, setStore] = globalSync.child(directory, { bootstrap: true })
  setStore("session_status", item.sessionID, { type: "busy" })

  const client = globalSDK.createClient({ directory, throwOnError: true })
  const text = draftText(item.prompt)
  const images = draftImages(item.prompt)

  const { requestParts } = buildRequestParts({
    prompt: item.prompt,
    context: item.context,
    images,
    text,
    messageID: item.id,
    sessionID: item.sessionID,
    sessionDirectory: item.sessionDirectory,
  })

  console.log("[octo:chat-queue] drain-send", {
    sessionID,
    directory,
    messageID: item.id,
    model: item.model,
  })

  try {
    await client.session.promptAsync({
      sessionID: item.sessionID,
      agent: item.agent,
      model: item.model,
      messageID: item.id,
      parts: requestParts,
      variant: item.variant,
    })
  } catch (err) {
    setStore("session_status", item.sessionID, { type: "idle" })
    throw err
  }
}
