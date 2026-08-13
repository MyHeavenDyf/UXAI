import { Database } from "@/storage/db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { SessionTable } from "./session.sql"
import { fromRow, type Info } from "./session"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "session-insight-query" })

// insight 专用会话查询(SPEC-INS-013)。与通用 session.list 解耦:
// 服务端**先按 agent 过滤再分页**,修「会话超 100 条后最早 insight 对话看不到」——
// 根因是共享 session.list「先 limit 100 再前端筛 agent」的顺序错。硬编码 agent,
// 不暴露入参,不碰 session 组。作用域 = project_id(instance) + directory(query),
// 不加 roots 过滤(保留 task 子会话可见,见 session-agent-attribution §B-1)。
//
// SPEC-INS-030 §6 路径 B(读时合并):chat 下线后,其历史会话(agent=octo_ai)也从 insight 侧列出。
// 选 B 不选「回填 agent 字段」是因为 B 不写数据、随时可回退 —— 把这行改回单值即恢复原状。
// 渲染兼容是降级的:insight-turn 对 chat 那些 bash/edit part 走 GenericTool 兜底("调用了 xxx"),
// 底线是不报错 + 不丢原对话内容(不为外来会话加特殊闸)。
const LISTED_AGENTS = ["octo_insight", "octo_ai"]

export function listInsightSessions(input: {
  projectID: ProjectID
  directory: string
  limit: number
  offset: number
}): { items: Info[]; total: number } {
  const conditions = [
    eq(SessionTable.project_id, input.projectID),
    eq(SessionTable.directory, input.directory),
    inArray(SessionTable.agent, LISTED_AGENTS),
  ]

  return Database.use((db) => {
    // total:不受 limit 影响的全量计数,驱动前端精确 hasMore(已显示数 < total)。
    const total =
      db
        .select({ n: sql<number>`count(*)` })
        .from(SessionTable)
        .where(and(...conditions))
        .get()?.n ?? 0

    const rows = db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated))
      .limit(input.limit)
      .offset(input.offset)
      .all()

    // 坏行跳过兜底:单行 schema 解码失败不致整页崩,对齐 session-category-query。
    const items: Info[] = []
    for (const row of rows) {
      try {
        items.push(fromRow(row))
      } catch (err) {
        log.error("insight-session-list:skip-bad-row", { sessionID: row.id, error: String(err) })
      }
    }
    return { items, total }
  })
}
