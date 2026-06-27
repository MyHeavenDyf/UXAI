import { Database } from "@/storage/db"
import { and, desc, eq, sql } from "drizzle-orm"
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
const INSIGHT_AGENT = "octo_insight"

export function listInsightSessions(input: {
  projectID: ProjectID
  directory: string
  limit: number
  offset: number
}): { items: Info[]; total: number } {
  const conditions = [
    eq(SessionTable.project_id, input.projectID),
    eq(SessionTable.directory, input.directory),
    eq(SessionTable.agent, INSIGHT_AGENT),
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
