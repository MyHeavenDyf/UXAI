import { Database } from "@/storage/db"
import { eq, inArray, sql } from "drizzle-orm"
import { init } from "#db"
import fs from "fs"
import path from "path"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import type { SessionID } from "./schema"

// 普通工作区 → 代码工作区原地升级(设计记录:opencode_modify/workspace-upgrade-normal-to-code.md)。
//
// 迁移动作 = 两件事:
//   1. 文件:把 <ws>/.octo/<sid>/outputs/** 按会话目录**复制**(不是移动)到
//      <ws>/output/<sid 前 12 位>/<原相对路径>,保留原目录结构与文件名;
//   2. DB:改写 in-scope 会话 message/part 行里对这些产物路径的引用(4 种旧路径变体 →
//      output/ 新绝对路径),事务内改写 + 读回自检,任一已映射变体残留即回滚。
//
// 【最高原则】(同 session-chat-migration)对用户数据务求稳妥:宁可中断并明确报错,
// 绝不造成不可逆的数据丢失。改动时不要破坏这三条:
//   1. 原件永不删除、目标文件绝不覆盖 —— .octo/<sid>/outputs(含 uploads)原样保留,
//      未被改写的引用仍可经 .octo 会话式 serve 打开,天然兜底;
//   2. DB 只 UPDATE message/part 的 data 列,session 三列(directory/project_id/path)
//      一律不动 —— kind(normal/code)是纯前端标记,服务端不感知,翻转在前端 store 做;
//   3. 备份先行(VACUUM INTO 整库快照),写前校验备份可读且含本次要改的行。
//
// 路径变体:同一条产物路径在 data(JSON 文本)里最多出现 4 种形态 —— 绝对/相对 ×
// 正斜杠/反斜杠。替换一律在**原始 JSON 文本**上做(不 JSON.parse 再 stringify,
// 避免大数精度等 round-trip 风险):TS 层匹配用原样变体,DB 层 instr 自检用反斜杠
// 转义后的变体(JSON 里 `\` 存为 `\\`)。

const STUDIO_AGENT = "octo_studio"
const SESSION_BASE_DIR = ".octo"
const OUTPUTS_DIR = "outputs"
const OUTPUT_DIR = "output"
const BACKUP_MARKER = ".ws-upgrade-bak-"

// SQLite 单条语句绑定参数上限(旧版默认 999)。id 列表按此分批。
const ID_BATCH = 500

export type UpgradeStage = "resolve" | "busy" | "backup" | "verify-backup" | "plan" | "copy" | "rewrite" | "cleanup"

export class WorkspaceUpgradeError extends Error {
  readonly stage: UpgradeStage
  constructor(stage: UpgradeStage, message: string) {
    super(message)
    this.name = "WorkspaceUpgradeError"
    this.stage = stage
  }
}

function log(event: string, data: Record<string, unknown>) {
  console.log(`[octo:ws-upgrade] ${event}`, JSON.stringify(data))
}

/** 迁移失败的统一日志出口(handler 调用),排查口诀:看到 failed 就一定没动过数据。 */
export function logWorkspaceUpgradeFailure(stage: UpgradeStage, error: unknown) {
  console.error(
    `[octo:ws-upgrade] failed`,
    JSON.stringify({ stage, error: String(error instanceof Error ? error.message : error) }),
  )
}

// ── 目标收集 ─────────────────────────────────────────────────────────────────

export interface UpgradeTargets {
  /** in-scope:directory 精确匹配且非 octo_studio 的会话(含子会话/归档,studio 会话的产物路径白名单只认 .octo,搬了会坏) */
  sessions: SessionID[]
  studioSkipped: number
}

export function collectUpgradeTargets(directory: string): UpgradeTargets {
  const rows = Database.use((db) =>
    db
      .select({ id: SessionTable.id, agent: SessionTable.agent })
      .from(SessionTable)
      .where(eq(SessionTable.directory, directory))
      .all(),
  )
  const sessions = rows.filter((r) => r.agent !== STUDIO_AGENT).map((r) => r.id as SessionID)
  return { sessions, studioSkipped: rows.length - sessions.length }
}

// ── 产物文件发现与命名规划 ──────────────────────────────────────────────────

interface OutputFile {
  sid: SessionID
  /** 相对 outputs 根的 posix 路径(可含子目录) */
  relPath: string
  src: string
  size: number
}

/**
 * 递归收集 <ws>/.octo/<sid>/outputs 下的所有普通文件(目录不存在/读不了 → 空)。
 * `.` 开头的文件与子目录一律跳过:outputs 里的 .gitkeep(空目录占位)、.history/**
 * (编辑器本地历史快照)是内部文件不是产物,既不计数也不迁移(与项目文件列表过滤
 * `.` 条目的口径一致)。
 */
function listOutputFiles(ws: string, sid: SessionID, out: OutputFile[]): void {
  const root = path.join(ws, SESSION_BASE_DIR, sid, OUTPUTS_DIR)
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const childAbs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(childAbs, childRel)
      else if (entry.isFile()) {
        try {
          out.push({ sid, relPath: childRel, src: childAbs, size: fs.statSync(childAbs).size })
        } catch {
          // stat 失败(并发删除等)跳过该文件
        }
      }
    }
  }
  walk(root, "")
}

/**
 * sid 前 12 位 = `ses_` 之后的时间戳+计数器 hex 段,同毫秒创建也不会重复(id.ts);
 * 且不随 base62 随机段变化,重跑命名稳定。形态异常的 id 兜底用整串。
 */
function sidPrefix(sid: SessionID): string {
  return sid.startsWith("ses_") && sid.length >= 16 ? sid.slice(4, 16) : sid
}

interface PlannedFile extends OutputFile {
  /** 相对 output/ 的 posix 目标路径 = <sidPrefix>/<relPath>,与前端 computeArtifactFilePath 推导逐字一致 */
  dest: string
  name: string
  /** true = 需要复制;false = 目标已存在且内容相同(重跑复用,不重复复制) */
  copy: boolean
}

function sameFile(a: string, b: string): boolean {
  // 先比大小再逐字节比;产物以 html/svg 等小文件为主。读不了按不同处理(触发中断报错)。
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false
    return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0
  } catch {
    return false
  }
}

/**
 * 命名规划(纯只读,不创建任何目录/文件,备份失败时文件系统零触碰):目标 =
 * <ws>/output/<sidPrefix>/<relPath>,保留原目录结构与文件名。撞名分两种,都**报错中断**
 * 而不是加后缀:后缀会击穿「迁移落盘名 ↔ 前端 text 卡片推导」的逐字一致不变量,且嵌套
 * 下撞名只可能是异常状态(盘上已有异内容同名文件),挪走冲突文件重跑即可(run 幂等)。
 * 内容相同的目标复用(重跑幂等);createdDirs 记录本次需要新建的目录链(失败清理用)。
 */
function planFileCopies(ws: string, files: OutputFile[]): { planned: PlannedFile[]; createdDirs: string[] } {
  const taken = new Set<string>()
  const createdDirs = new Set<string>()
  const planned: PlannedFile[] = []
  const sorted = files.slice().sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  for (const file of sorted) {
    const name = `${sidPrefix(file.sid)}/${file.relPath}`
    if (taken.has(name)) {
      throw new WorkspaceUpgradeError("plan", `会话产物目标路径冲突：${name}（会话 id 前缀异常，请检查会话数据）`)
    }
    const dest = path.join(ws, OUTPUT_DIR, ...name.split("/"))
    if (fs.existsSync(dest)) {
      if (!sameFile(file.src, dest)) {
        throw new WorkspaceUpgradeError("plan", `目标已存在且内容不同：${dest}（请先移走该文件后重试）`)
      }
      planned.push({ ...file, dest, name, copy: false })
    } else {
      planned.push({ ...file, dest, name, copy: true })
      for (let dir = path.dirname(dest); ; dir = path.dirname(dir)) {
        if (fs.existsSync(dir)) break
        createdDirs.add(dir)
        if (path.dirname(dir) === dir) break
      }
    }
    taken.add(name)
  }
  return { planned, createdDirs: [...createdDirs] }
}

// ── 路径变体与替换映射 ──────────────────────────────────────────────────────

/** 同一产物路径的 4 种旧形态:绝对/相对 × 正斜杠/反斜杠(posix 下反斜杠形态永不匹配,无害)。 */
function pathVariants(ws: string, sid: SessionID, relPath: string): string[] {
  const wsFwd = ws.replace(/\\/g, "/")
  const relFwd = `${SESSION_BASE_DIR}/${sid}/${OUTPUTS_DIR}/${relPath}`
  const relWin = relFwd.replace(/\//g, "\\")
  return [`${wsFwd}/${relFwd}`, `${ws}${path.sep}${relWin}`, relFwd, relWin]
}

/** JSON 字符串字面量里的形态:反斜杠翻倍。路径不含引号/控制字符,翻倍即全部差异。 */
function jsonEscaped(s: string): string {
  return s.replace(/\\/g, "\\\\")
}

/** 旧路径变体 → <ws>/output/<sidPrefix>/<relPath>(正斜杠绝对路径,name 本就是 posix 路径)。 */
function buildKeyMap(ws: string, planned: PlannedFile[]): Map<string, string> {
  const wsFwd = ws.replace(/\\/g, "/")
  const map = new Map<string, string>()
  for (const file of planned) {
    const target = `${wsFwd}/${OUTPUT_DIR}/${file.name}`
    for (const variant of pathVariants(ws, file.sid, file.relPath)) {
      if (!map.has(variant)) map.set(variant, target)
    }
  }
  return map
}

// ── DB 改写 ─────────────────────────────────────────────────────────────────

interface RowUpdate {
  table: "message" | "part"
  id: string
  data: string
}

/**
 * 在原始 JSON 文本上做变体替换(不 parse)。按变体**长度降序**应用:abs 变体包含 rel
 * 变体子串,先替换 rel 会拼出 `D:/ws/D:/ws/output/...` 的坏路径。改写范围 = 所有
 * in-scope 会话的行(覆盖会话间交叉引用:子会话引用父会话产物)。
 */
function rewriteRows(scopeIDs: SessionID[], keysDescending: string[], keyMap: Map<string, string>): RowUpdate[] {
  const escaped = keysDescending.map(jsonEscaped)
  const updates: RowUpdate[] = []
  for (const table of ["message", "part"] as const) {
    for (let i = 0; i < scopeIDs.length; i += ID_BATCH) {
      const batch = scopeIDs.slice(i, i + ID_BATCH)
      const rows = Database.use((db) =>
        db.all<{ id: string; data: string }>(sql`
          select "id", "data" from ${sql.raw(`"${table}"`)}
          where "session_id" in (${sql.join(
            batch.map((id) => sql`${id}`),
            sql`, `,
          )}) and instr("data", ${SESSION_BASE_DIR}) > 0
        `),
      )
      for (const row of rows) {
        let text = row.data
        let changed = false
        for (let k = 0; k < escaped.length; k++) {
          if (text.includes(escaped[k])) {
            text = text.split(escaped[k]).join(keyMap.get(keysDescending[k])!)
            changed = true
          }
        }
        if (changed) updates.push({ table, id: row.id, data: text })
      }
    }
  }
  return updates
}

/**
 * 事务内写回 + 读回自检:in-scope 会话所有含 .octo 的行里,任何已映射变体(转义形态)
 * 都不得残留,任一残留抛错整体回滚。rows 在事务外先算好(见 runWorkspaceUpgrade 的
 * busy 守卫说明),自检兜住「算完到提交之间」的并发写入。
 */
function applyRewrite(scopeIDs: SessionID[], updates: RowUpdate[], escapedKeys: string[]): void {
  if (updates.length === 0) return
  try {
    Database.transaction((tx) => {
      for (const u of updates) {
        tx.run(sql`update ${sql.raw(`"${u.table}"`)} set "data" = ${u.data} where "id" = ${u.id}`)
      }
      for (const table of ["message", "part"] as const) {
        for (let i = 0; i < scopeIDs.length; i += ID_BATCH) {
          const batch = scopeIDs.slice(i, i + ID_BATCH)
          const rows = tx.all<{ data: string }>(sql`
            select "data" from ${sql.raw(`"${table}"`)}
            where "session_id" in (${sql.join(
              batch.map((id) => sql`${id}`),
              sql`, `,
            )}) and instr("data", ${SESSION_BASE_DIR}) > 0
          `)
          for (const row of rows) {
            for (const key of escapedKeys) {
              if (row.data.includes(key)) throw new Error(`路径改写自检未通过：残留 ${key}`)
            }
          }
        }
      }
    })
  } catch (err) {
    if (err instanceof WorkspaceUpgradeError) throw err
    throw new WorkspaceUpgradeError("rewrite", String(err instanceof Error ? err.message : err))
  }
}

// ── 备份 ────────────────────────────────────────────────────────────────────

interface ScopeRowCounts {
  message: number
  part: number
}

type RowCounter = ReturnType<typeof init> | Parameters<Parameters<typeof Database.use>[0]>[0]

function countScopeRows(db: RowCounter, scopeIDs: SessionID[]): ScopeRowCounts {
  let message = 0
  let part = 0
  for (let i = 0; i < scopeIDs.length; i += ID_BATCH) {
    const batch = scopeIDs.slice(i, i + ID_BATCH)
    message +=
      db
        .select({ n: sql<number>`count(*)` })
        .from(MessageTable)
        .where(inArray(MessageTable.session_id, batch))
        .get()?.n ?? 0
    part +=
      db
        .select({ n: sql<number>`count(*)` })
        .from(PartTable)
        .where(inArray(PartTable.session_id, batch))
        .get()?.n ?? 0
  }
  return { message, part }
}

/** 打开备份库读取(独立连接,读完即关),同 chat-migration 的 readBackup。 */
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

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/**
 * VACUUM INTO 整库快照(每次 run 新建一份,永不覆盖)+ 三条校验:文件存在且非空、
 * 能作为 SQLite 打开、in-scope 会话的 message/part 行数与当前库一致(要改的行必须
 * 都在备份里)。VACUUM INTO 不能在事务内执行,必须在任何写入之前。
 */
function backupAndVerify(dbPath: string, scopeIDs: SessionID[]): string {
  if (dbPath === ":memory:") {
    throw new WorkspaceUpgradeError("backup", "当前数据库在内存中运行，无法创建备份")
  }
  const target = `${dbPath}${BACKUP_MARKER}${Date.now()}`
  try {
    Database.use((db) => db.run(sql`VACUUM INTO ${target}`))
  } catch (err) {
    throw new WorkspaceUpgradeError("backup", `创建备份失败：${String(err)}`)
  }
  log("backup", { to: target, bytes: sizeOf(target) })

  const expected = Database.use((db) => countScopeRows(db, scopeIDs))
  try {
    if (!fs.existsSync(target) || sizeOf(target) <= 0) throw new Error("备份文件为空")
    const actual = readBackup(target, (db) => countScopeRows(db, scopeIDs))
    if (actual.message !== expected.message || actual.part !== expected.part) {
      throw new Error(
        `备份内容与当前数据不一致（message ${actual.message}/${expected.message}，part ${actual.part}/${expected.part}）`,
      )
    }
  } catch (err) {
    throw new WorkspaceUpgradeError("verify-backup", String(err instanceof Error ? err.message : err))
  }
  log("backup-verified", { to: target, message: expected.message, part: expected.part })
  return target
}

// ── 文件复制与失败清理 ──────────────────────────────────────────────────────

/** 复制计划内的文件(copy 不 move)。目录创建在这里做(mkdir recursive 幂等,plan 阶段零写入);
 * 失败时先清掉本次已建的副本再抛错(原件从未被动过)。 */
function copyPlanned(planned: PlannedFile[], createdDirs: string[]): string[] {
  const created: string[] = []
  const dirs = new Set(planned.map((file) => path.dirname(file.dest)))
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      cleanupCreated(created, createdDirs)
      throw new WorkspaceUpgradeError("copy", `创建产物目录失败：${dir}（${String(err)}）`)
    }
  }
  for (const file of planned) {
    if (!file.copy) continue
    try {
      fs.cpSync(file.src, file.dest)
      created.push(file.dest)
    } catch (err) {
      cleanupCreated(created, createdDirs)
      throw new WorkspaceUpgradeError("copy", `复制产物文件失败：${file.src} → ${file.dest}（${String(err)}）`)
    }
  }
  return created
}

/**
 * 失败清理:只删**本次新建**的 output 副本(重跑复用的既有文件不删),再按深度降序
 * rmdir 本次新建的目录链(只有空目录删得掉,留有复用文件的目录自然保留)。清理失败
 * 只打日志,不算迁移失败(重跑幂等)。
 */
function cleanupCreated(created: string[], createdDirs: string[]): void {
  for (const file of created) {
    try {
      fs.rmSync(file)
    } catch (err) {
      console.error(`[octo:ws-upgrade] cleanup-failed`, JSON.stringify({ file, error: String(err) }))
    }
  }
  const depth = (dir: string) => dir.split(path.sep).length
  const dirs = createdDirs.slice().sort((a, b) => depth(b) - depth(a))
  for (const dir of dirs) {
    try {
      fs.rmdirSync(dir)
    } catch {
      // 目录非空/已不存在/删不掉:留着无害(空目录或重跑现场),忽略。
    }
  }
}

// ── preview / run ───────────────────────────────────────────────────────────

export interface WorkspaceUpgradePreview {
  /** 有产物文件待迁移的会话数 */
  sessions: number
  files: number
  bytes: number
  studioSkipped: number
}

export function previewWorkspaceUpgrade(input: { directory: string }): WorkspaceUpgradePreview {
  const targets = collectUpgradeTargets(input.directory)
  const files: OutputFile[] = []
  for (const sid of targets.sessions) listOutputFiles(input.directory, sid, files)
  const result: WorkspaceUpgradePreview = {
    sessions: new Set(files.map((f) => f.sid)).size,
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
    studioSkipped: targets.studioSkipped,
  }
  log("preview", { directory: input.directory, ...result })
  return result
}

export interface WorkspaceUpgradeResult {
  migratedSessions: number
  movedFiles: number
  movedBytes: number
  skippedStudio: number
  backupPath?: string
}

/**
 * 执行升级。顺序不能变:命名规划(纯只读,任何失败都还没碰过文件系统) → 备份+校验 →
 * 复制(建目录+拷文件) → 事务改写+自检。规划/备份失败零触碰;复制失败原件不动、副本
 * 已清;改写失败事务回滚 + 副本清理,数据保持升级前状态。原 .octo 产物目录全程不删。
 *
 * busy 守卫(运行中的会话拒绝升级)在 handler 层做(需要 Effect 服务);本模块的
 * 事务自检兜住「rows 算好到提交之间」的并发写入。
 */
export function runWorkspaceUpgrade(input: { directory: string; dbPath?: string }): WorkspaceUpgradeResult {
  const dbPath = input.dbPath ?? Database.Path
  const ws = input.directory
  const targets = collectUpgradeTargets(ws)

  const files: OutputFile[] = []
  for (const sid of targets.sessions) listOutputFiles(ws, sid, files)

  if (files.length === 0) {
    log("run", { directory: ws, matched: 0, migratedSessions: 0, movedFiles: 0, skippedStudio: targets.studioSkipped })
    return { migratedSessions: 0, movedFiles: 0, movedBytes: 0, skippedStudio: targets.studioSkipped }
  }

  const { planned, createdDirs } = planFileCopies(ws, files)
  const keyMap = buildKeyMap(ws, planned)
  const keysDescending = [...keyMap.keys()].sort((a, b) => b.length - a.length)
  const escapedKeys = keysDescending.map(jsonEscaped)

  let created: string[] = []
  let backupPath: string | undefined
  try {
    backupPath = backupAndVerify(dbPath, targets.sessions)
    created = copyPlanned(planned, createdDirs)
    const updates = rewriteRows(targets.sessions, keysDescending, keyMap)
    applyRewrite(targets.sessions, updates, escapedKeys)
  } catch (err) {
    try {
      cleanupCreated(created, createdDirs)
    } catch {
      // cleanup 自身绝不抛(内部已吞),这层只是形式上的保险。
    }
    throw err
  }

  const result: WorkspaceUpgradeResult = {
    migratedSessions: new Set(planned.map((f) => f.sid)).size,
    movedFiles: planned.length,
    movedBytes: planned.reduce((sum, f) => sum + f.size, 0),
    skippedStudio: targets.studioSkipped,
    backupPath,
  }
  log("run", { directory: ws, matched: targets.sessions.length, ...result })
  return result
}
