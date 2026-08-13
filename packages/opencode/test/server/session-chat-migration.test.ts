import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import {
  applyChatMigration,
  ChatMigrationError,
  previewChatMigration,
  runChatMigration,
  verifyBackupFile,
} from "@/session/session-chat-migration"
import { listInsightSessions } from "@/session/session-insight-query"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { eq, sql } from "drizzle-orm"
import { init } from "#db"
import fs from "fs"
import os from "os"
import path from "path"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((s) => s.create(input)))
  },
}

function rowOf(sessionID: SessionID) {
  return Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())!
}

function legacyIDs(): SessionID[] {
  return Database.use((db) =>
    db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.agent, "octo_ai")).all(),
  ).map((r) => r.id)
}

afterEach(async () => {
  await disposeAllInstances()
})

// SPEC-INS-031。测试库跑在 :memory:(test/preload.ts),故「备份 + VACUUM INTO」那一段
// 只能验到「拿不到库文件就明确中止」;三列 UPDATE 本体与备份校验各自单测。
describe("chat migration (SPEC-INS-031)", () => {
  test("preview counts legacy chat sessions across directories, ignoring the target directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "chat-1", agent: "octo_ai" })
        await svc.create({ title: "chat-2", agent: "octo_ai" })
        await svc.create({ title: "insight-1", agent: "octo_insight" })
        await svc.create({ title: "no-agent" })
        await WithInstance.provide({
          directory: other.path,
          fn: async () => svc.create({ title: "chat-elsewhere", agent: "octo_ai" }),
        })

        // 跨目录的那条也要算进来:chat 列表当年就是跨目录全展示的,迁移范围与 directory 无关。
        expect(previewChatMigration({ directory: tmp.path }).pending).toBe(3)
        expect(previewChatMigration({ directory: other.path }).pending).toBe(3)
      },
    })
  })

  // V0:守住「路径 B 读时合并」确实撤干净了。曾经把列表过滤放宽成 agent IN (octo_insight,
  // octo_ai),那会让 chat 历史在**当初创建它的那个目录**下半可见;SPEC-INS-030 §6.1 推翻了它,
  // 改走本 spec 的显式迁移。这条一旦变红,说明口子又被开回去了。
  test("legacy chat sessions stay invisible in the insight list until migrated", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const insight = await svc.create({ title: "insight-1", agent: "octo_insight" })
        const projectID = rowOf(insight.id).project_id

        const before = listInsightSessions({ projectID, directory: tmp.path, limit: 100, offset: 0 })
        expect(before.items.map((s) => s.id)).not.toContain(chat.id)
        expect(before.total).toBe(1)

        applyChatMigration({ targets: [chat.id], directory: tmp.path, projectID })

        const after = listInsightSessions({ projectID, directory: tmp.path, limit: 100, offset: 0 })
        expect(after.items.map((s) => s.id)).toContain(chat.id)
        expect(after.total).toBe(2)
      },
    })
  })

  test("writes all three columns so the migrated sessions show up in the insight list", async () => {
    await using from = await tmpdir({ git: true })
    await using to = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: from.path,
      fn: async () => {
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const before = rowOf(chat.id)

        // 目标目录是另一个 git 仓库 → project_id 必然与原值不同,专治「只改 directory 的静默失败」。
        const target = await WithInstance.provide({
          directory: to.path,
          fn: async () => svc.create({ title: "anchor", agent: "octo_insight" }),
        })
        const targetProjectID = rowOf(target.id).project_id
        expect(targetProjectID).not.toBe(before.project_id)

        applyChatMigration({ targets: [chat.id], directory: to.path, projectID: targetProjectID })

        const after = rowOf(chat.id)
        expect(after.agent).toBe("octo_insight")
        expect(after.directory).toBe(to.path)
        expect(after.project_id).toBe(targetProjectID)

        // 归属之外一个字不动。
        expect(after.title).toBe(before.title)
        expect(after.time_created).toBe(before.time_created)
        expect(after.time_updated).toBe(before.time_updated)

        const page = listInsightSessions({ projectID: targetProjectID, directory: to.path, limit: 100, offset: 0 })
        expect(page.items.map((s) => s.id)).toContain(chat.id)
      },
    })
  })

  test("touches only the named rows: other agents and agent-less sessions stay put", async () => {
    await using from = await tmpdir({ git: true })
    await using to = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: from.path,
      fn: async () => {
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const make = await svc.create({ title: "make-1", agent: "octo_make" })
        const bare = await svc.create({ title: "no-agent" })
        const makeBefore = rowOf(make.id)
        const bareBefore = rowOf(bare.id)

        applyChatMigration({ targets: [chat.id], directory: to.path, projectID: makeBefore.project_id })

        expect(rowOf(make.id)).toEqual(makeBefore)
        expect(rowOf(bare.id)).toEqual(bareBefore)
      },
    })
  })

  test("re-running finds nothing to migrate and leaves the data alone", async () => {
    await using from = await tmpdir({ git: true })
    await using to = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: from.path,
      fn: async () => {
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const projectID = rowOf(chat.id).project_id

        applyChatMigration({ targets: legacyIDs(), directory: to.path, projectID })
        expect(legacyIDs().length).toBe(0)

        const after = rowOf(chat.id)
        applyChatMigration({ targets: legacyIDs(), directory: to.path, projectID })
        expect(rowOf(chat.id)).toEqual(after)
      },
    })
  })

  test("aborts instead of migrating when the database has no file to back up", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const before = rowOf(chat.id)

        // 备份拿不到库文件 → 中止在 backup 阶段,一行都不能动(「宁可中断也不丢数据」)。
        expect(() => runChatMigration({ directory: tmp.path, projectID: before.project_id })).toThrow(
          ChatMigrationError,
        )
        expect(rowOf(chat.id)).toEqual(before)
        expect(legacyIDs()).toContain(chat.id)
      },
    })
  })
})

describe("chat migration backup verification (SPEC-INS-031 §5.2.1)", () => {
  function tmpFile(name: string) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chat-migrate-bak-")), name)
  }

  test("rejects a missing backup file", () => {
    expect(() => verifyBackupFile(tmpFile("nope.db"), 1)).toThrow(/备份文件不存在/)
  })

  test("rejects an empty backup file", () => {
    const file = tmpFile("empty.db")
    fs.writeFileSync(file, "")
    expect(() => verifyBackupFile(file, 1)).toThrow(/备份文件为空/)
  })

  test("rejects a file that is not a readable sqlite database", () => {
    const file = tmpFile("garbage.db")
    fs.writeFileSync(file, "definitely not sqlite")
    expect(() => verifyBackupFile(file, 1)).toThrow(/备份文件无法读取/)
  })

  test("rejects a backup whose legacy chat session count does not match", () => {
    const file = tmpFile("mismatch.db")
    const db = init(file)
    db.run(sql`create table session (id text primary key, agent text)`)
    db.run(sql`insert into session (id, agent) values ('a', 'octo_ai')`)
    db.$client.close()

    expect(() => verifyBackupFile(file, 5)).toThrow(/备份内容与当前数据不一致/)
    // 条数对上就放行,返回的正是备份里那批要保护的数据的条数。
    expect(verifyBackupFile(file, 1)).toBe(1)
  })
})
