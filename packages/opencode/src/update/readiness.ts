import { Effect } from "effect"
import { SessionStatus } from "@/session/status"
import { Database, inArray } from "@/storage/db"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { hasActiveStudioSubmissions } from "@/studio/prompt-recommendation-state"
import { hasActiveStudioRecommendations } from "@/studio/prompt-recommendation"
import { hasActiveStudioGenerationCreations } from "@/studio/studio-service"

export const getUpdateReadiness = Effect.gen(function* () {
  const sessions = yield* SessionStatus.Service.use((service) => service.listAll())
  if ([...sessions.values()].some((status) => status.type !== "idle")) {
    return { ready: false, reason: "正在执行 Agent 任务，请等待任务结束后再更新。" }
  }
  if ((yield* Effect.promise(hasActiveStudioSubmissions)) || (yield* Effect.promise(hasActiveStudioRecommendations))) {
    return { ready: false, reason: "正在处理 Studio 请求，请等待任务结束后再更新。" }
  }
  if (hasActiveStudioGenerationCreations()) {
    return { ready: false, reason: "正在创建生成任务，请等待任务结束后再更新。" }
  }
  const generating = Database.use((db) => db.select({ id: StudioGenerationTable.id })
    .from(StudioGenerationTable)
    // Creation only runs in this process; persisted creating rows may be left behind by a crash.
    .where(inArray(StudioGenerationTable.status, ["queued", "running"]))
    .limit(1).get())
  if (generating) return { ready: false, reason: "正在生成图片或视频，请等待任务结束后再更新。" }
  return { ready: true }
})
