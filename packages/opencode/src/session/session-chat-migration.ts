import { Database } from "@/storage/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import { init } from "#db"
import fs from "fs"
import path from "path"
import { SessionTable } from "./session.sql"
import { fromRow, type Info } from "./session"
import type { SessionID } from "./schema"
import type { ProjectID } from "../project/schema"

// SPEC-INS-031 chat 历史会话迁移(临时功能,chat 模块下线的收尾)。
//
// 迁移动作 = 一条 UPDATE:agent → octo_insight、directory → 用户选的目录、
// project_id → 该目录解析出的 project(三列缺一不可,少写 project_id 会「提示成功但列表空」)。
//
// 【最高原则】对用户数据务求稳妥:宁可中断并明确报错,绝不造成不可逆的数据丢失。
// 本模块天然不具备"丢数据"的能力,改动时不要破坏这三条:
//   1. 只有 UPDATE,没有任何 DELETE / DROP;
//   2. 只写 agent / directory / project_id 三列,不碰 title / time_* / 消息表 / parts 表;
//   3. 即使三列全写错,对话内容仍完整躺在库里,最坏是"列表里找不到",可以再迁一次修正。
//
// 不动 session_category 表:那张表只影响通用 session.list 的 category 过滤,insight 列表走
// listInsightSessions(独立查询,不看 category)。迁过来的行 category 仍是 chat 时代的 "dev",
// 而 dev 分类的入口(chat 侧栏)已随 SPEC-INS-030 下线,实际无可见影响。改它属三字段契约之外
// 的额外写入,按上面的原则不做。

const LEGACY_CHAT_AGENT = "octo_ai"
const INSIGHT_AGENT = "octo_insight"

// 备份文件名:<当前库文件>.chat-migrate-bak-<时间戳>。**永不覆盖、永不自动删除**,
// 备份库里 agent='octo_ai' 的那批 id 天然就是「哪些会话是迁过来的」这份记录(不建表、不加 schema)。
const BACKUP_MARKER = ".chat-migrate-bak-"

// SQLite 单条语句的绑定参数上限(旧版默认 999)。id 列表按此分批,避免 "too many SQL variables"。
const ID_BATCH = 500

export type MigrationStage = "resolve-project" | "backup" | "verify-backup" | "update"

export class ChatMigrationError extends Error {
  readonly stage: MigrationStage
  constructor(stage: MigrationStage, message: string) {
    super(message)
    this.name = "ChatMigrationError"
    this.stage = stage
  }
}

function log(event: string, data: Record<string, unknown>) {
  console.log(`[octo:chat-migrate] ${event}`, JSON.stringify(data))
}

function logError(data: Record<string, unknown>) {
  console.error(`[octo:chat-migrate] failed`, JSON.stringify(data))
}

/** 当前库里还没迁走的 chat 历史(agent='octo_ai')。与 directory 无关——chat 本来就跨目录。 */
function pendingIDs(): SessionID[] {
  return Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.agent, LEGACY_CHAT_AGENT))
      .all(),
  ).map((r) => r.id)
}

/** 已有备份文件(有则复用,§5.2.2「只在首次迁移时备份」)。找不到返回 undefined。 */
function findBackup(): string | undefined {
  const dbPath = Database.Path
  if (dbPath === ":memory:") return undefined
  const dir = path.dirname(dbPath)
  const prefix = path.basename(dbPath) + BACKUP_MARKER
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return undefined
  }
  const found = entries.filter((name) => name.startsWith(prefix)).sort()
  return found[0] ? path.join(dir, found[0]) : undefined
}

/**
 * 打开备份库读取一批 id。备份库是一个独立完整的 SQLite 文件(VACUUM INTO 产出),
 * 用独立连接打开、读完即关,不影响当前库的连接。
 */
function readBackup<T>(file: string, read: (db: ReturnType<typeof init>) => T): T {
  const bak = init(file)
  try {
    return read(bak)
  } finally {
    try {
      bak.$client.close()
    } catch {
      // 关不掉不影响读到的结果,忽略。
    }
  }
}

function backupLegacyIDs(file: string): SessionID[] {
  return readBackup(file, (db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.agent, LEGACY_CHAT_AGENT))
      .all()
      .map((r) => r.id),
  )
}

/** 当前库中仍存在的 id(备份里的会话可能已被用户删掉,重迁不该把它算进去)。 */
function existingIDs(ids: SessionID[]): SessionID[] {
  if (ids.length === 0) return []
  const alive: SessionID[] = []
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH)
    const rows = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(inArray(SessionTable.id, batch)).all(),
    )
    for (const row of rows) alive.push(row.id)
  }
  return alive
}

/**
 * 设置页进来时查一次,驱动按钮文案与禁用态。
 * - pending:当前库里还没迁的 chat 历史条数(与 directory 无关)
 * - migratable:备份里可重迁的条数(备份 id ∩ 当前库仍存在的行)
 */
export function previewChatMigration(input: { directory: string }): { pending: number; migratable: number } {
  const pending = pendingIDs().length
  const backup = findBackup()
  const migratable = backup ? existingIDs(backupLegacyIDs(backup)).length : 0
  log("preview", { pending, migratable, directory: input.directory })
  return { pending, migratable }
}

/**
 * 备份(VACUUM INTO)+ 校验。**不能用 copyFile**:库是 WAL 模式,裸复制主文件会得到缺最新
 * 数据的快照。VACUUM INTO 产出完整一致的独立库文件,且**不能在事务内执行**,故必须早于 UPDATE。
 *
 * 已有备份则跳过(永不覆盖):那份是「迁移前那份快照」,是唯一的原始数据源。
 */
function backupAndVerify(expected: number | undefined): { path: string; skipped: boolean } {
  const dbPath = Database.Path
  if (dbPath === ":memory:") {
    throw new ChatMigrationError("backup", "当前数据库在内存中运行，无法创建备份")
  }

  const existing = findBackup()
  if (existing) {
    // 已有备份:不再新建、不覆盖。此时不比对条数(备份是**上次**迁移前的快照,与本次 pending
    // 天然不等),只校验它可打开且确实含有那批要保护的数据。
    const count = verifyBackupFile(existing, undefined)
    log("backup", { to: existing, bytes: sizeOf(existing), skipped: true })
    log("backup-verified", { to: existing, octoAiCount: count, expected: null })
    return { path: existing, skipped: true }
  }

  const target = `${dbPath}${BACKUP_MARKER}${Date.now()}`
  try {
    Database.use((db) => db.run(sql`VACUUM INTO ${target}`))
  } catch (err) {
    throw new ChatMigrationError("backup", `创建备份失败：${String(err)}`)
  }

  const bytes = sizeOf(target)
  log("backup", { to: target, bytes, skipped: false })

  const count = verifyBackupFile(target, expected)
  log("backup-verified", { to: target, octoAiCount: count, expected })
  return { path: target, skipped: false }
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/**
 * §5.2.1 三条校验,任一不过就中止迁移:
 *   1. 文件存在且大小 > 0;
 *   2. 能作为 SQLite 库打开;
 *   3. 备份里 agent='octo_ai' 的条数 == 迁移前当前库里数到的条数(expected 为 undefined 时
 *      只要求 > 0——见 backupAndVerify 里复用已有备份的分支)。
 */
export function verifyBackupFile(file: string, expected: number | undefined): number {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    throw new ChatMigrationError("verify-backup", `备份文件不存在：${file}`)
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new ChatMigrationError("verify-backup", `备份文件为空：${file}`)
  }

  let count: number
  try {
    count = readBackup(
      file,
      (db) =>
        db
          .select({ n: sql<number>`count(*)` })
          .from(SessionTable)
          .where(eq(SessionTable.agent, LEGACY_CHAT_AGENT))
          .get()?.n ?? 0,
    )
  } catch (err) {
    throw new ChatMigrationError("verify-backup", `备份文件无法读取：${String(err)}`)
  }

  if (expected === undefined) {
    if (count <= 0) {
      throw new ChatMigrationError("verify-backup", "已有备份中没有可迁移的 Chat 历史会话")
    }
    return count
  }
  if (count !== expected) {
    throw new ChatMigrationError("verify-backup", `备份内容与当前数据不一致（备份 ${count} 条，当前 ${expected} 条）`)
  }
  return count
}

/**
 * 事务 UPDATE 本体:只写 agent / directory / project_id 三列,只碰 targets 里点名的那些行。
 * 写完在同一事务里自检,三列全部到位才提交——否则抛错回滚,数据保持迁移前状态。
 */
export function applyChatMigration(input: { targets: SessionID[]; directory: string; projectID: ProjectID }): void {
  const { targets, directory, projectID } = input
  if (targets.length === 0) return
  try {
    Database.transaction((tx) => {
      for (let i = 0; i < targets.length; i += ID_BATCH) {
        const batch = targets.slice(i, i + ID_BATCH)
        // ⚠️ 故意不用 drizzle 的 .update().set():SessionTable 的 time_updated 带 `$onUpdate`,
        // 走 query builder 会**顺手把它刷成当前时刻** —— 那既违反「只写三列」,也会把整批
        // chat 历史顶到会话列表最前面、打乱原有的时间顺序。裸 SQL 只写点名的三列。
        tx.run(
          sql`update "session" set "agent" = ${INSIGHT_AGENT}, "directory" = ${directory}, "project_id" = ${projectID} where "id" in (${sql.join(
            batch.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      }

      // 写后自检:三列都到位了才提交。任一条对不上就抛错回滚,宁可中断也不留「提示成功但
      // 列表里一条没有」的静默失败(project_id 漏写正是这个症状)。
      let verified = 0
      for (let i = 0; i < targets.length; i += ID_BATCH) {
        const batch = targets.slice(i, i + ID_BATCH)
        verified +=
          tx
            .select({ n: sql<number>`count(*)` })
            .from(SessionTable)
            .where(
              and(
                inArray(SessionTable.id, batch),
                eq(SessionTable.agent, INSIGHT_AGENT),
                eq(SessionTable.directory, directory),
                eq(SessionTable.project_id, projectID),
              ),
            )
            .get()?.n ?? 0
      }
      if (verified !== targets.length) {
        throw new Error(`迁移结果自检未通过（预期 ${targets.length} 条，实际 ${verified} 条）`)
      }
    })
  } catch (err) {
    if (err instanceof ChatMigrationError) throw err
    throw new ChatMigrationError("update", String(err instanceof Error ? err.message : err))
  }
}

/**
 * 执行迁移。调用方(handler)负责先把目录解析成 projectID —— **project_id 必须由目标目录经
 * 服务端解析得到,不能沿用原值**(project 与目录是多对一,非 git 目录全部共用 global)。
 *
 * 执行顺序不能变(§3.3):resolve project(调用方) → 备份 + 校验 → 开事务 UPDATE。
 * 前两步任一失败都还没动过数据;第三步失败则整体回滚,数据保持迁移前状态。
 *
 * 两种模式:
 * - 首次迁移:当前库里有 agent='octo_ai' → 迁这一批,迁前备份。
 * - 重新迁移:当前库已没有 octo_ai,但备份里有 → 按备份的 id 集合改 directory + project_id,
 *   即**整批挪到新目录**(旧目录不留残余)。用户在错误目录下新建的 insight 会话不在这个集合里,
 *   不会被碰到。
 */
export function runChatMigration(input: {
  directory: string
  projectID: ProjectID
}): { migrated: number; migratedIDs: SessionID[]; backupPath?: string } {
  const pending = pendingIDs()

  let targets: SessionID[]
  let backupPath: string | undefined

  if (pending.length > 0) {
    const backup = backupAndVerify(pending.length)
    backupPath = backup.path
    targets = pending
  } else {
    const backup = findBackup()
    if (!backup) {
      // 库里没有待迁的 chat 历史,也没有迁移过的记录 —— 没什么可做的。
      log("run", { directory: input.directory, projectID: input.projectID, matched: 0, migrated: 0 })
      return { migrated: 0, migratedIDs: [], backupPath: undefined }
    }
    // 重迁前也过一遍备份校验:它是 id 集合的唯一来源,读不动就该中止;同时保证
    // `backup-verified` 与 `run` 始终成对出现(§4.3 的排查口诀靠这个判断校验有没有被漏掉)。
    backupPath = backupAndVerify(undefined).path
    targets = existingIDs(backupLegacyIDs(backup))
    if (targets.length === 0) {
      log("run", { directory: input.directory, projectID: input.projectID, matched: 0, migrated: 0 })
      return { migrated: 0, migratedIDs: [], backupPath }
    }
  }

  applyChatMigration({ targets, directory: input.directory, projectID: input.projectID })

  log("run", {
    directory: input.directory,
    projectID: input.projectID,
    matched: targets.length,
    migrated: targets.length,
  })
  return { migrated: targets.length, migratedIDs: targets, backupPath }
}

/** 迁移失败的统一日志出口(handler 调用),排查口诀:看到 failed 就一定没动过数据。 */
export function logChatMigrationFailure(stage: MigrationStage, error: unknown) {
  logError({ stage, error: String(error instanceof Error ? error.message : error) })
}

/**
 * 迁移后要 publish session.updated 让 insight 列表自刷新(列表监听 session.created/updated/
 * deleted 做 refetch;直接 UPDATE 不经 session 服务,不会自动发事件)。这里取出那批行的最新状态。
 * 单行解码失败只跳过该行——发事件是"锦上添花",绝不能因此把已经成功的迁移变成报错。
 */
export function readMigratedSessions(ids: SessionID[]): Info[] {
  const items: Info[] = []
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH)
    const rows = Database.use((db) => db.select().from(SessionTable).where(inArray(SessionTable.id, batch)).all())
    for (const row of rows) {
      try {
        items.push(fromRow(row))
      } catch (err) {
        console.warn(`[octo:chat-migrate] skip-bad-row`, JSON.stringify({ sessionID: row.id, error: String(err) }))
      }
    }
  }
  return items
}
