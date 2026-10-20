import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import { previewWorkspaceUpgrade, runWorkspaceUpgrade, WorkspaceUpgradeError } from "@/session/workspace-upgrade"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import type { MessageID, PartID, SessionID } from "@/session/schema"
import { sql } from "drizzle-orm"
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

// 测试库是共享的 :memory: 实例,跨用例不重置;各用例用独立 tmpdir 做 directory,
// collectUpgradeTargets 的 directory 精确匹配天然隔离,无需像 chat-migration 那样清残留。
let seq = 0
function insertMessage(sessionID: SessionID, data: Record<string, unknown>) {
  const id = `msg_${Date.now().toString(36)}_${seq++}` as MessageID
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(MessageTable)
      .values({
        id,
        session_id: sessionID,
        time_created: now,
        time_updated: now,
        data: data as unknown as NonNullable<(typeof MessageTable.$inferInsert)["data"]>,
      })
      .run(),
  )
  return id
}

function insertPart(sessionID: SessionID, messageID: MessageID, data: Record<string, unknown>) {
  const id = `prt_${Date.now().toString(36)}_${seq++}` as PartID
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(PartTable)
      .values({
        id,
        message_id: messageID,
        session_id: sessionID,
        time_created: now,
        time_updated: now,
        data: data as unknown as NonNullable<(typeof PartTable.$inferInsert)["data"]>,
      })
      .run(),
  )
  return id
}

function rowData(table: "message" | "part", id: string): string {
  return Database.use((db) =>
    db.all<{ data: string }>(sql`select "data" from ${sql.raw(`"${table}"`)} where "id" = ${id}`),
  )[0]!.data
}

function writeOutput(ws: string, sid: SessionID, rel: string, content: string) {
  const file = path.join(ws, ".octo", sid, "outputs", rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function outputDir(ws: string) {
  return path.join(ws, "output")
}

function listOutput(ws: string): string[] {
  return fs.existsSync(outputDir(ws)) ? fs.readdirSync(outputDir(ws)).sort() : []
}

/** 与模块 sidPrefix 同规则:ses_ 后 12 位时间戳+计数器 hex 段。 */
function prefixOf(sid: SessionID) {
  return sid.startsWith("ses_") && sid.length >= 16 ? sid.slice(4, 16) : sid
}

function variantsOf(ws: string, sid: SessionID, rel: string) {
  const wsFwd = ws.replace(/\\/g, "/")
  const relFwd = `.octo/${sid}/outputs/${rel}`
  const relWin = relFwd.replace(/\//g, "\\")
  return {
    wsFwd,
    absFwd: `${wsFwd}/${relFwd}`,
    absWin: `${ws}${path.sep}${relWin}`,
    relFwd,
    relWin,
  }
}

// 备份目标路径前缀:VACUUM INTO 导出到 <dbPath>.ws-upgrade-bak-<ts>,目录无需预先存在。
function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ws-upgrade-db-")), "opencode.db")
}

// 注:与 session-chat-migration.test.ts 相同的 afterEach;disposeAllInstances 在本机
// Windows 上偶发超过 bun 默认 5s hook 超时,表现为一个 "(unnamed)" 偶发红,属环境固有
// 现象(基准文件同样偶发),与用例逻辑无关。
afterEach(async () => {
  await disposeAllInstances()
})

describe("workspace upgrade preview (normal → code)", () => {
  test("counts sessions/files/bytes and skips studio sessions", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const make1 = await svc.create({ title: "make-1", agent: "octo_make" })
        await svc.create({ title: "make-2", agent: "octo_make" }) // 无产物文件,不计入 sessions
        const studio = await svc.create({ title: "studio-1", agent: "octo_studio" })
        writeOutput(ws.path, make1.id, "landing.html", "hello")
        writeOutput(ws.path, make1.id, "sub/chart.svg", "world")
        writeOutput(ws.path, studio.id, "poster.png", "poster")

        const result = previewWorkspaceUpgrade({ directory: ws.path })
        expect(result.sessions).toBe(1)
        expect(result.files).toBe(2)
        expect(result.bytes).toBe("hello".length + "world".length)
        expect(result.studioSkipped).toBe(1)
      },
    })
  })
})

describe("workspace upgrade run (normal → code)", () => {
  test("copies artifacts flat into output/ with sid-prefix names, deduping without overwriting", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const s1 = await svc.create({ title: "make-1", agent: "octo_make" })
        const p = prefixOf(s1.id)
        writeOutput(ws.path, s1.id, "a.html", "A-content")
        writeOutput(ws.path, s1.id, "sub/a.html", "B-content") // 同 basename → -2 后缀
        writeOutput(ws.path, s1.id, "b.svg", "svg")

        // 外来同名文件(内容不同)绝不覆盖:b.svg 的目标名已被占用 → 新副本挪到 -2。
        fs.mkdirSync(outputDir(ws.path), { recursive: true })
        fs.writeFileSync(path.join(outputDir(ws.path), `${p}-b.svg`), "foreign-different")

        const result = runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })
        expect(result.migratedSessions).toBe(1)
        expect(result.movedFiles).toBe(3)
        expect(result.movedBytes).toBe("A-content".length + "B-content".length + "svg".length)
        expect(result.skippedStudio).toBe(0)
        expect(result.backupPath).toBeDefined()

        // 平铺命名按 relpath 排序分配:a.html < b.svg < sub/a.html。
        expect(listOutput(ws.path)).toEqual([`${p}-a.html`, `${p}-a.html-2`, `${p}-b.svg`, `${p}-b.svg-2`])
        expect(fs.readFileSync(path.join(outputDir(ws.path), `${p}-a.html`), "utf8")).toBe("A-content")
        expect(fs.readFileSync(path.join(outputDir(ws.path), `${p}-a.html-2`), "utf8")).toBe("B-content")
        expect(fs.readFileSync(path.join(outputDir(ws.path), `${p}-b.svg-2`), "utf8")).toBe("svg")
        expect(fs.readFileSync(path.join(outputDir(ws.path), `${p}-b.svg`), "utf8")).toBe("foreign-different")

        // 原 .octo/<sid>/outputs 完整保留,原件一字未动。
        expect(fs.readFileSync(path.join(ws.path, ".octo", s1.id, "outputs", "a.html"), "utf8")).toBe("A-content")
        expect(fs.readFileSync(path.join(ws.path, ".octo", s1.id, "outputs", "sub", "a.html"), "utf8")).toBe(
          "B-content",
        )
        expect(fs.readFileSync(path.join(ws.path, ".octo", s1.id, "outputs", "b.svg"), "utf8")).toBe("svg")
      },
    })
  })

  test("rewrites all four path variants across message/part, leaving unmapped and out-of-scope rows alone", async () => {
    await using ws = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const s1 = await svc.create({ title: "make-1", agent: "octo_make" })
        const s2 = await svc.create({ title: "make-2", agent: "octo_make" })
        const elsewhere = await WithInstance.provide({
          directory: other.path,
          fn: () => svc.create({ title: "elsewhere", agent: "octo_make" }),
        })
        writeOutput(ws.path, s1.id, "x.html", "X")

        const v = variantsOf(ws.path, s1.id, "x.html")
        const newPath = `${v.wsFwd}/output/${prefixOf(s1.id)}-x.html`

        // 同一行里塞进全部 4 种旧形态:改写后应全部归一到同一条新绝对路径,且不能出现
        // 「先替换 rel 变体拼出 <abs><new>」的坏路径(长度降序替换的被测点)。
        const msg1 = insertMessage(s1.id, { text: [v.absFwd, v.absWin, v.relFwd, v.relWin].join(" | ") })
        const part1 = insertPart(s1.id, msg1, { type: "tool", filepath: v.absWin })
        // 同目录兄弟会话引用 s1 的产物:会话间交叉引用也在改写范围。
        const msg2 = insertMessage(s2.id, { text: `sibling: ${v.absFwd}` })
        // 其他目录的会话引用本工作区产物:不在范围,一字不动。
        const msg3 = insertMessage(elsewhere.id, { text: `outside: ${v.absFwd}` })
        // 磁盘上没有对应文件的引用:映射不到就不动(.octo 会话式 serve 兜底)。
        const msg4 = insertMessage(s1.id, { text: `unmapped: .octo/${s1.id}/outputs/missing.html` })

        runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })

        expect((JSON.parse(rowData("message", msg1)) as { text: string }).text).toBe(
          [newPath, newPath, newPath, newPath].join(" | "),
        )
        expect((JSON.parse(rowData("part", part1)) as { filepath: string }).filepath).toBe(newPath)
        expect((JSON.parse(rowData("message", msg2)) as { text: string }).text).toBe(`sibling: ${newPath}`)
        expect((JSON.parse(rowData("message", msg3)) as { text: string }).text).toBe(`outside: ${v.absFwd}`)
        expect((JSON.parse(rowData("message", msg4)) as { text: string }).text).toBe(
          `unmapped: .octo/${s1.id}/outputs/missing.html`,
        )
      },
    })
  })

  test("leaves studio sessions and their artifacts untouched", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const make = await svc.create({ title: "make-1", agent: "octo_make" })
        const studio = await svc.create({ title: "studio-1", agent: "octo_studio" })
        writeOutput(ws.path, make.id, "page.html", "P")
        writeOutput(ws.path, studio.id, "poster.png", "poster")
        const v = variantsOf(ws.path, studio.id, "poster.png")
        const studioMsg = insertMessage(studio.id, { text: `studio: ${v.absFwd}` })

        const result = runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })
        expect(result.skippedStudio).toBe(1)
        expect(result.migratedSessions).toBe(1)
        expect(result.movedFiles).toBe(1)
        expect(listOutput(ws.path)).toEqual([`${prefixOf(make.id)}-page.html`])
        // studio 的产物与引用原样保留:其路径白名单只认 .octo,搬走会坏。
        expect(fs.existsSync(path.join(ws.path, ".octo", studio.id, "outputs", "poster.png"))).toBe(true)
        expect((JSON.parse(rowData("message", studioMsg)) as { text: string }).text).toBe(`studio: ${v.absFwd}`)
      },
    })
  })

  test("returns zeros without backup or output dir when nothing to migrate", async () => {
    await using ws = await tmpdir({ git: true })
    const db = tempDbPath()
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        await svc.create({ title: "make-1", agent: "octo_make" })
        const result = runWorkspaceUpgrade({ directory: ws.path, dbPath: db })
        expect(result).toEqual({ migratedSessions: 0, movedFiles: 0, movedBytes: 0, skippedStudio: 0 })
        expect(fs.existsSync(outputDir(ws.path))).toBe(false)
        expect(fs.readdirSync(path.dirname(db)).filter((n) => n.includes(".ws-upgrade-bak-"))).toEqual([])
      },
    })
  })

  test("re-running is a no-op: no duplicate files, no name inflation, DB unchanged", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const s1 = await svc.create({ title: "make-1", agent: "octo_make" })
        const p = prefixOf(s1.id)
        writeOutput(ws.path, s1.id, "a.html", "A")
        const v = variantsOf(ws.path, s1.id, "a.html")
        const msg = insertMessage(s1.id, { text: v.absFwd })

        runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })
        const dataAfterFirst = rowData("message", msg)
        expect((JSON.parse(dataAfterFirst) as { text: string }).text).toBe(`${v.wsFwd}/output/${p}-a.html`)

        const second = runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })
        // 内容相同的既有副本被复用,不重复复制,也不去顶 -2 后缀。
        expect(second.movedFiles).toBe(1)
        expect(listOutput(ws.path)).toEqual([`${p}-a.html`])
        expect(rowData("message", msg)).toBe(dataAfterFirst)
      },
    })
  })

  test("backs up the database first and the backup holds the pre-migration rows", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const s1 = await svc.create({ title: "make-1", agent: "octo_make" })
        writeOutput(ws.path, s1.id, "x.html", "X")
        const v = variantsOf(ws.path, s1.id, "x.html")
        const msg = insertMessage(s1.id, { text: v.absFwd })

        const result = runWorkspaceUpgrade({ directory: ws.path, dbPath: tempDbPath() })
        expect(result.backupPath).toBeDefined()
        expect(fs.existsSync(result.backupPath!)).toBe(true)
        expect(fs.statSync(result.backupPath!).size).toBeGreaterThan(0)

        // 备份是**迁移前**的快照:当前库已改写,备份里仍是旧路径。
        const bak = init(result.backupPath!)
        try {
          const row = bak.all<{ data: string }>(sql`select "data" from "message" where "id" = ${msg}`)[0]
          expect((JSON.parse(row!.data) as { text: string }).text).toBe(v.absFwd)
        } finally {
          bak.$client.close()
        }
      },
    })
  })

  test("aborts before touching anything when the database cannot be backed up", async () => {
    await using ws = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: ws.path,
      fn: async () => {
        const s1 = await svc.create({ title: "make-1", agent: "octo_make" })
        writeOutput(ws.path, s1.id, "x.html", "X")
        const v = variantsOf(ws.path, s1.id, "x.html")
        const msg = insertMessage(s1.id, { text: v.absFwd })

        expect(() => runWorkspaceUpgrade({ directory: ws.path, dbPath: ":memory:" })).toThrow(WorkspaceUpgradeError)
        // 宁可中断也不丢数据:DB 未动、没有复制任何文件、规划期新建的空 output/ 已清理。
        expect((JSON.parse(rowData("message", msg)) as { text: string }).text).toBe(v.absFwd)
        expect(fs.existsSync(outputDir(ws.path))).toBe(false)
        expect(fs.existsSync(path.join(ws.path, ".octo", s1.id, "outputs", "x.html"))).toBe(true)
      },
    })
  })
})
