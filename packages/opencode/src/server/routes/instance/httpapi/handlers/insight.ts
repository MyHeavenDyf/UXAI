import * as InstanceState from "@/effect/instance-state"
import { listInsightSessions } from "@/session/session-insight-query"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import path from "path"
import { InstanceHttpApi } from "../api"
import { InsightSessionListQuery, InsightFileListQuery } from "../groups/insight"

export const insightHandlers = HttpApiBuilder.group(InstanceHttpApi, "insight", (handlers) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const listSessions = Effect.fn("InsightHttpApi.listSessions")(function* (ctx: {
      query: typeof InsightSessionListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      return listInsightSessions({
        projectID: instance.project.id,
        directory: ctx.query.directory ?? instance.directory,
        limit: ctx.query.limit ?? 100,
        offset: ctx.query.offset ?? 0,
      })
    })

    // SPEC-INS-014 §10:列 <projectDir>/insight/<sessionId>/<category>/。worktree 本身扁平
    // (不像 make 的 artifacts 目录会有子文件夹),所以只做单层 readDirectory,不做递归 /
    // 不做 kind 分类(客户端复用已有的 extToOutputType()/fileTypeIconUrl())。
    const listFiles = Effect.fn("InsightHttpApi.listFiles")(function* (ctx: {
      query: typeof InsightFileListQuery.Type
    }) {
      const instance = yield* InstanceState.context
      const dir = path.join(instance.directory, "insight", ctx.query.sessionId, ctx.query.category)

      const exists = yield* fs.exists(dir).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) return { files: [] }

      const entries = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))
      const files: Array<{ name: string; path: string; size: number; mtime: number }> = []
      for (const name of entries) {
        if (name.startsWith(".")) continue
        const fullPath = path.join(dir, name)
        const stat = yield* fs.stat(fullPath).pipe(Effect.catch(() => Effect.succeed(null)))
        if (!stat || stat.type === "Directory") continue // 扁平设计:忽略任何意外出现的子目录
        files.push({
          name,
          path: fullPath,
          size: typeof stat.size === "bigint" ? Number(stat.size) : (stat.size ?? 0),
          mtime: Option.isSome(stat.mtime) ? stat.mtime.value.getTime() : Date.now(),
        })
      }
      return { files }
    })

    return handlers.handle("listSessions", listSessions).handle("listFiles", listFiles)
  }),
)
