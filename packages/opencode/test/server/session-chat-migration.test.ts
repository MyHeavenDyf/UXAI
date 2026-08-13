import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import {
  applyChatMigration,
  ChatMigrationError,
  findBackup,
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

// 测试库是同一个 `:memory:` 实例、跨用例共享,而 runChatMigration 是**全库**扫 octo_ai。
// 用它的用例先把前面残留的清零(改 agent,不删数据),否则断言的条数会被上一个用例污染。
function clearLegacy() {
  Database.use((db) => db.run(sql`update "session" set "agent" = 'octo_insight' where "agent" = 'octo_ai'`))
}

function legacyIDs(): SessionID[] {
  return Database.use((db) =>
    db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.agent, "octo_ai")).all(),
  ).map((r) => r.id)
}

afterEach(async () => {
  await disposeAllInstances()
})

// SPEC-INS-031。本组测三列 UPDATE 本体(applyChatMigration);备份那条完整链路见下面
// 「backup path」一组,校验规则见「backup verification」一组。
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
        // 注意别把这条读成「跨 project 也全收」——非 git 目录一律落 ProjectID.global
        // (project.ts fromDirectory),现实中 chat 会话绝大多数都挂在 global 下,所以「与
        // directory 无关」在实际数据上就等价于「全量」。只有在 git 仓库里用过 chat 才会出现
        // 跨 project 的情形,属边角。
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
        clearLegacy()
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const before = rowOf(chat.id)

        // 备份拿不到库文件 → 中止在 backup 阶段,一行都不能动(「宁可中断也不丢数据」)。
        expect(() =>
          runChatMigration({ directory: tmp.path, projectID: before.project_id, dbPath: ":memory:" }),
        ).toThrow(ChatMigrationError)
        expect(rowOf(chat.id)).toEqual(before)
        expect(legacyIDs()).toContain(chat.id)
      },
    })
  })
})

// 备份这条路径原本只有手工验证:测试库跑 `:memory:`,而 `Database.Path` 是模块级常量。
// 把 dbPath 提成入参后就能跑真链路 —— VACUUM INTO 能把内存库导出成一个真实的独立库文件,
// 备份 / 校验 / findBackup / 复用已有备份 / 按备份 id 集合重迁全都是真的在跑。
describe("chat migration backup path (SPEC-INS-031 §5.2)", () => {
  function backupDir() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chat-migrate-db-")), "opencode.db")
  }

  test("backs up before migrating, and the backup is a full snapshot of the pre-migration state", async () => {
    await using from = await tmpdir({ git: true })
    await using to = await tmpdir({ git: true })
    const dbPath = backupDir()
    await WithInstance.provide({
      directory: from.path,
      fn: async () => {
        clearLegacy()
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        await svc.create({ title: "chat-2", agent: "octo_ai" })
        const projectID = rowOf(chat.id).project_id

        const result = runChatMigration({ directory: to.path, projectID, dbPath })
        expect(result.migrated).toBe(2)
        expect(result.backupPath).toBeDefined()

        // 备份是**迁移前**的快照:当前库里 octo_ai 已清零,备份里仍是 2 条。
        expect(legacyIDs().length).toBe(0)
        expect(verifyBackupFile(result.backupPath!, 2)).toBe(2)
        expect(findBackup(dbPath)).toBe(result.backupPath)
      },
    })
  })

  test("never creates a second backup, and re-migrating moves the same batch to the new directory", async () => {
    await using from = await tmpdir({ git: true })
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const dbPath = backupDir()
    await WithInstance.provide({
      directory: from.path,
      fn: async () => {
        clearLegacy()
        const chat = await svc.create({ title: "chat-1", agent: "octo_ai" })
        const projectID = rowOf(chat.id).project_id
        const originalBackup = runChatMigration({ directory: first.path, projectID, dbPath }).backupPath!

        // 用户在**迁错的**目录下新建的会话,不在备份的 octo_ai 集合里 —— 重迁绝不该碰它。
        const bystander = await svc.create({ title: "insight-new", agent: "octo_insight" })
        const bystanderBefore = rowOf(bystander.id)

        const again = runChatMigration({ directory: second.path, projectID, dbPath })
        expect(again.migrated).toBe(1)
        // 备份永不覆盖、永不新建第二份:仍是最初那一份。
        expect(again.backupPath).toBe(originalBackup)
        expect(
          fs.readdirSync(path.dirname(dbPath)).filter((n) => n.includes(".chat-migrate-bak-")).length,
        ).toBe(1)

        // 整批挪走:新目录有、旧目录不留残余。
        expect(rowOf(chat.id).directory).toBe(second.path)
        expect(rowOf(bystander.id)).toEqual(bystanderBefore)
      },
    })
  })

  test("does nothing when there is neither pending data nor a backup", async () => {
    await using tmp = await tmpdir({ git: true })
    const dbPath = backupDir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        clearLegacy()
        const anchor = await svc.create({ title: "insight-1", agent: "octo_insight" })
        const result = runChatMigration({ directory: tmp.path, projectID: rowOf(anchor.id).project_id, dbPath })
        expect(result.migrated).toBe(0)
        expect(result.backupPath).toBeUndefined()
        // 没有可迁的就不该留下备份文件。
        expect(fs.readdirSync(path.dirname(dbPath)).filter((n) => n.includes(".chat-migrate-bak-"))).toEqual([])
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
