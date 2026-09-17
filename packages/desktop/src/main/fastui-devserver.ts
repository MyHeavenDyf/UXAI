/**
 * fastui 预览服务(SPEC-DES-004)
 *
 * **卡片只记产物,不记端口;地址在点击那一刻由这里当场给出。**
 *
 *   前端:(会话目录, 产物名) ──IPC──▶ 这里
 *   这里:内存里有这个工程的服务,进程活着,端口也能应答?
 *         ├─ 是 → 直接返回它的端口
 *         └─ 否 → 挑一个空闲端口 → 起服务 → 等端口可连 → 返回端口
 *   前端:拿到端口,拼出 http://127.0.0.1:<端口>,挂 iframe
 *
 * 为什么由主进程持有(SPEC-DES-003 §8.6.1):skill 脚本是短命进程,Windows 下它起的进程
 * 会随 shell 工具收尾被整棵清掉;主进程是那个长命进程,也只有它能在退出时统一回收。
 *
 * 端口为什么不再记下来:记下来的端口会过期 —— 服务一停就还给系统,被别的对话捡走之后,
 * 记着它的卡片就指到了别人那里(「前一个对话的卡片点进去变成后一个对话的页面」)。
 * 所有服务都由这一个进程起,端口在 spawn 那一刻挑,就不需要任何登记表。
 */
import { type ChildProcess, execFile, spawn, spawnSync } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import net from "node:net"
import { homedir } from "node:os"
import { basename, join, resolve, sep } from "node:path"

import log from "electron-log/main.js"

const PORT_START = 8081
const PORT_TRIES = 200
/** 端口被抢导致秒退时换端口重试的上限 */
const MAX_PORT_RETRIES = 5
/** 起服务到端口可连的上限。依赖装好后编译在十几秒量级,留足余量;超时一律报错,不无限等 */
const startTimeoutMs = () => Number(process.env.OCTO_FASTUI_START_TIMEOUT_MS) || 90_000
/** 端口通了之后再看一眼进程还在不在 —— 探测到 listen 之间端口被别人抢了的话,我们的进程会随即退出 */
const READY_GRACE_MS = 1000
const REQUEST_POLL_MS = 1000
/**
 * 每次起服务前写进日志的标记,与 skill 的 scripts/lib/host.mjs `START_MARK` 一致。
 * 日志按产物追加,换过进程后 verify 靠它只看新进程的输出。
 */
const START_MARK = "[octo-devserver] start port="
/** 与 new-session 的 --name 校验一致:产物名不能带路径分隔符,防止拼出 outputs 以外的路径 */
const PROJECT_NAME_RE = /^[\w.\-一-龥]+$/

type SessionState = {
  projectDir?: string
  envDir?: string
  depsDir?: string
  nodeBin?: string
}

type Entry = {
  sessionDir: string
  projectDir: string
  name: string
  status: "starting" | "ready"
  port: number
  pid: number
  child?: ChildProcess
  envDir: string
  ready: Promise<OpenResult>
}

export type OpenResult =
  | { ok: true; port: number; reused: boolean }
  | { ok: false; error: string; logTail?: string }

/** 以工程目录为键 —— 身份的单位是产物工程,不是会话(同一对话可以有多个工程,要能同时预览) */
const running = new Map<string, Entry>()
/** 已分出去的端口,包括正在探测中的。先占再探测,两个工程同时起服务时不会挑到同一个 */
const reservedPorts = new Set<number>()

// ── 路径 ─────────────────────────────────────────────────────────

/** 与 skill 的 scripts/lib/paths.mjs `envDir()` 保持一致 */
export function fastuiEnvDir(): string {
  if (process.env.OCTO_FASTUI_ENV_DIR) return resolve(process.env.OCTO_FASTUI_ENV_DIR)
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    return join(base, "OctoAgent", "fastui-env")
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "OctoAgent", "fastui-env")
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "OctoAgent", "fastui-env")
}

/** 共享池里的 node。导出脚本(fastui-export.ts)也用它,故导出。 */
export function nodeBinOf(envDir: string) {
  return process.platform === "win32" ? join(envDir, "node", "node.exe") : join(envDir, "node", "bin", "node")
}

function runtimePaths(sessionDir: string, name: string) {
  const dir = join(sessionDir, "devservers")
  return { dir, record: join(dir, `${name}.json`), log: join(dir, `${name}.log`) }
}

function readState(sessionDir: string): SessionState | null {
  try {
    return JSON.parse(readFileSync(join(sessionDir, ".octo-fastui.json"), "utf8")) as SessionState
  } catch {
    return null
  }
}

function isProjectDir(dir: string) {
  return existsSync(join(dir, "packages", "portal"))
}

type Resolved = { ok: true; projectDir: string; name: string; state: SessionState } | { ok: false; error: string }

/**
 * (会话目录, 产物名) → 工程目录。
 *
 * 产物名缺省是给**老卡片**用的(本方案之前生成的卡片只有 `http://127.0.0.1:<port>`):
 * 对话里只有一个工程就是它;有多个就明确报错,不去猜 —— 猜错的后果是显示另一个工程的页面。
 */
export function resolveProject(sessionDir: string, name?: string): Resolved {
  const state = readState(sessionDir)
  if (!state) return { ok: false, error: "未找到该对话的预览工程信息，请让助手重新生成预览" }

  const outputs = join(sessionDir, "outputs")
  if (name) {
    if (!PROJECT_NAME_RE.test(name) || name === "." || name === "..") {
      return { ok: false, error: `预览工程名称不合法：${name}` }
    }
    const projectDir = join(outputs, name)
    if (!isProjectDir(projectDir)) return { ok: false, error: `未找到预览工程「${name}」，可能已被删除` }
    return { ok: true, projectDir, name, state }
  }

  let candidates: string[] = []
  try {
    candidates = readdirSync(outputs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isProjectDir(join(outputs, d.name)))
      .map((d) => d.name)
  } catch {
    /* outputs 不存在 */
  }
  if (candidates.length === 1) return { ok: true, projectDir: join(outputs, candidates[0]), name: candidates[0], state }
  if (candidates.length === 0) return { ok: false, error: "未找到预览工程，请让助手重新生成预览" }
  return {
    ok: false,
    error: "该预览卡片由旧版本生成，当前对话包含多个产物工程，无法确定对应哪一个。请让助手重新生成预览",
  }
}

// ── 进程与端口 ───────────────────────────────────────────────────

function isAlive(e: Entry) {
  return !!e.child && e.child.exitCode === null && e.child.signalCode === null
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM"
  }
}

function bindable(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer()
    srv.once("error", () => done(false))
    srv.once("listening", () => srv.close(() => done(true)))
    srv.listen(port, "127.0.0.1")
  })
}

/**
 * 端口空闲?
 *
 * 只试绑 127.0.0.1 有盲区:监听在 0.0.0.0 / :: / ::1 上的进程看不到(macOS 上 Node 给监听设了
 * SO_REUSEADDR,别人占着 0.0.0.0 时照样能绑上 127.0.0.1)。**不改成去试绑 0.0.0.0**:Windows 上
 * 监听非环回地址会弹防火墙确认框。改为补连接探测 —— 发往环回地址的连接同样会落到通配地址的监听上。
 */
async function portFree(port: number): Promise<boolean> {
  if (!(await bindable(port))) return false
  if (await canConnect(port, 800)) return false
  if (await canConnect(port, 800, "::1")) return false
  return true
}

export function canConnect(port: number, timeoutMs = 1500, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((done) => {
    const sock = net.connect({ port, host })
    const finish = (v: boolean) => {
      sock.destroy()
      done(v)
    }
    sock.setTimeout(timeoutMs, () => finish(false))
    sock.once("connect", () => finish(true))
    sock.once("error", () => finish(false))
  })
}

async function allocatePort(excluded: Set<number>): Promise<number | null> {
  for (let p = PORT_START; p < PORT_START + PORT_TRIES; p++) {
    if (reservedPorts.has(p) || excluded.has(p)) continue
    // 先同步占住再 await 探测:JS 单线程,占位这一步不会和别的起服务请求交错
    reservedPorts.add(p)
    if (await portFree(p)) return p
    reservedPorts.delete(p)
  }
  return null
}

/** 结束整棵进程树。webpack dev server 底下还有子进程,只杀直接子进程会留下占端口的残留 */
function killTree(pid: number, { sync = false }: { sync?: boolean } = {}) {
  if (!pid || !pidAlive(pid)) return
  if (process.platform === "win32") {
    if (sync) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
    } else {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
      killer.on("error", (error) => log.warn("[fastui] taskkill 失败", { pid, error: String(error) }))
    }
    return
  }
  // 服务以独立进程组启动(spawn 时 detached),向整组发信号
  try {
    process.kill(-pid, sync ? "SIGKILL" : "SIGTERM")
  } catch {
    try {
      process.kill(pid, sync ? "SIGKILL" : "SIGTERM")
    } catch {
      /* 已退出 */
    }
  }
}

function readLogTail(logPath: string, fromOffset: number, maxLines = 40) {
  try {
    const text = readFileSync(logPath, "utf8").slice(fromOffset)
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(-maxLines)
      .join("\n")
  } catch {
    return ""
  }
}

function fileSize(p: string) {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

// ── pid 登记(崩溃后下次启动时清理)──────────────────────────────

const pidRegistryDir = (envDir: string) => join(envDir, ".devserver-pids")

function registerPid(envDir: string, record: { pid: number; projectDir: string; startedAt: string }) {
  try {
    mkdirSync(pidRegistryDir(envDir), { recursive: true })
    writeFileSync(join(pidRegistryDir(envDir), `${record.pid}.json`), JSON.stringify({ ...record, owner: "host" }))
  } catch (error) {
    log.warn("[fastui] 登记 dev server pid 失败", { pid: record.pid, error: String(error) })
  }
}

function unregisterPid(envDir: string, pid: number) {
  try {
    rmSync(join(pidRegistryDir(envDir), `${pid}.json`), { force: true })
  } catch {
    /* 忽略 */
  }
}

function readRecord(sessionDir: string, name: string): { pid?: number; status?: string } | null {
  try {
    return JSON.parse(readFileSync(runtimePaths(sessionDir, name).record, "utf8"))
  } catch {
    return null
  }
}

/**
 * 删记录前核对 pid 是不是自己的。
 * 记录按产物名存,新旧进程写同一个路径;旧进程退得慢(Windows 上 taskkill 是异步的)时,
 * 新进程早已写好了记录 —— 不核对就会把新记录删掉,verify 从此找不到正在跑的服务。
 */
function removeRecordIfOwned(sessionDir: string, name: string, pid: number) {
  const r = readRecord(sessionDir, name)
  if (!r || r.pid !== pid) return
  try {
    rmSync(runtimePaths(sessionDir, name).record, { force: true })
  } catch {
    /* 删不掉不影响什么 */
  }
}

/** 起服务失败时告诉 verify,让它立即失败,而不是白等之后在 Octo 里自己起一个关不掉的进程 */
function writeErrorRecord(sessionDir: string, name: string, projectDir: string, result: { error: string; logTail?: string }) {
  const { dir, record } = runtimePaths(sessionDir, name)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      record,
      JSON.stringify({ projectDir, status: "error", error: result.error, logTail: result.logTail, at: Date.now() }, null, 2),
    )
  } catch (error) {
    log.warn("[fastui] 写失败记录失败", { projectDir, error: String(error) })
  }
}

function writeRecord(e: Entry, logPath: string) {
  const { dir, record } = runtimePaths(e.sessionDir, e.name)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      record,
      JSON.stringify(
        { port: e.port, pid: e.pid, projectDir: e.projectDir, logPath, status: e.status, startedAt: new Date().toISOString(), owner: "host" },
        null,
        2,
      ),
    )
  } catch (error) {
    log.warn("[fastui] 写服务记录失败", { projectDir: e.projectDir, error: String(error) })
  }
}

// ── 起服务 ───────────────────────────────────────────────────────

type WaitOutcome = "ready" | "exited" | "timeout"

async function waitReady(child: ChildProcess, port: number, deadline: number): Promise<WaitOutcome> {
  const exited = () => child.exitCode !== null || child.signalCode !== null
  while (Date.now() < deadline) {
    if (exited()) return "exited"
    if (await canConnect(port, 1000)) {
      await new Promise((r) => setTimeout(r, READY_GRACE_MS))
      return exited() ? "exited" : "ready"
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return exited() ? "exited" : "timeout"
}

async function launch(e: Entry, state: SessionState): Promise<OpenResult> {
  const envDir = state.envDir!
  const nodeBin = state.nodeBin && existsSync(state.nodeBin) ? state.nodeBin : nodeBinOf(envDir)
  if (!existsSync(nodeBin)) return { ok: false, error: `找不到用于启动预览服务的 node：${nodeBin}` }
  const cli = join(state.depsDir!, "@turboui", "turbo-ui-cli-service", "bin", "turbo-ui-cli-service.js")
  if (!existsSync(cli)) return { ok: false, error: `共享依赖中缺少 turbo-ui-cli-service：${cli}` }
  const portalDir = join(e.projectDir, "packages", "portal")

  const { dir, log: logPath } = runtimePaths(e.sessionDir, e.name)
  mkdirSync(dir, { recursive: true })
  const deadline = Date.now() + startTimeoutMs()
  const excluded = new Set<number>()

  for (let attempt = 1; attempt <= MAX_PORT_RETRIES; attempt++) {
    const port = await allocatePort(excluded)
    if (port === null) return { ok: false, error: "没有可用的本地端口，预览服务无法启动" }

    // 写启动标记在记下偏移之后:偏移用于截取本次启动的日志末尾,标记用于 verify 跟随换进程
    const logOffset = fileSize(logPath)
    try {
      appendFileSync(logPath, `\n${START_MARK}${port}\n`)
    } catch {
      /* 写不进去下面 openSync 会报出来 */
    }
    let fd: number
    try {
      fd = openSync(logPath, "a")
    } catch (error) {
      reservedPorts.delete(port)
      return { ok: false, error: `无法写入预览服务日志：${String(error)}` }
    }

    let child: ChildProcess
    try {
      child = spawn(nodeBin, [cli, "serve", "--replace-policy=dev", "--target=esnext"], {
        cwd: portalDir,
        // OCTO_DEPS 缺了 copy-webpack-plugin 找不到拷贝源;OCTO_PORT 是这一刻挑出来的端口
        env: { ...process.env, OCTO_DEPS: state.depsDir, OCTO_PORT: String(port) },
        windowsHide: true,
        // 非 Windows 下以独立进程组启动,结束时能连同 webpack 的子进程一起收掉
        detached: process.platform !== "win32",
        stdio: ["ignore", fd, fd],
      })
    } catch (error) {
      reservedPorts.delete(port)
      return { ok: false, error: `预览服务启动失败：${String(error)}` }
    } finally {
      // fd 传给子进程后它有自己的副本,这边必须关掉,否则每起一次泄漏一个
      try {
        closeSync(fd)
      } catch {
        /* 已关 */
      }
    }

    // 异步 error 事件(ENOENT 等)没有监听器会打爆主进程
    child.on("error", (error) => log.warn("[fastui] dev server 进程错误", { projectDir: e.projectDir, error: String(error) }))
    if (!child.pid) {
      reservedPorts.delete(port)
      return { ok: false, error: "预览服务启动后未获得进程号" }
    }

    const pid = child.pid
    e.port = port
    e.pid = pid
    e.child = child
    const startedAt = new Date().toISOString()
    registerPid(envDir, { pid, projectDir: e.projectDir, startedAt })
    // 起步阶段就写记录:verify 读到它就知道服务已经在起,不会自己再起一个
    writeRecord(e, logPath)

    child.on("exit", (code, signal) => {
      reservedPorts.delete(port)
      unregisterPid(envDir, pid)
      log.info("[fastui] dev server 退出", { projectDir: e.projectDir, port, code, signal })
      // 同一个工程上可能已经起了新进程 —— 只清理属于自己的状态,否则会删掉新进程的记录
      if (e.child !== child) return
      // 起步阶段的退出(端口被抢、启动失败)由 launch() 自己处理重试或报错;
      // 这里若把条目移出表,重试期间的并发请求就会另起一个
      if (e.status === "ready" && running.get(e.projectDir) === e) running.delete(e.projectDir)
    })
    // 记录的清理不受上面条目判断的限制:按 pid 核对,只删属于这个进程的那份
    child.on("exit", () => removeRecordIfOwned(e.sessionDir, e.name, pid))

    const outcome = await waitReady(child, port, deadline)
    if (outcome === "ready") {
      e.status = "ready"
      writeRecord(e, logPath)
      log.info("[fastui] dev server 已就绪", { projectDir: e.projectDir, port, pid })
      return { ok: true, port, reused: false }
    }

    const tail = readLogTail(logPath, logOffset)
    if (outcome === "timeout") {
      killTree(pid)
      log.warn("[fastui] dev server 启动超时", { projectDir: e.projectDir, port })
      return { ok: false, error: `预览服务在 ${Math.round(startTimeoutMs() / 1000)} 秒内未能启动完成`, logTail: tail }
    }
    if (/EADDRINUSE/i.test(tail)) {
      log.info("[fastui] 端口被占用，换一个端口重试", { projectDir: e.projectDir, port, attempt })
      excluded.add(port)
      continue
    }
    return { ok: false, error: "预览服务启动失败", logTail: tail }
  }
  return { ok: false, error: `连续 ${MAX_PORT_RETRIES} 个端口被占用，预览服务无法启动` }
}

function start(sessionDir: string, projectDir: string, name: string, state: SessionState): Promise<OpenResult> {
  const e: Entry = {
    sessionDir,
    projectDir,
    name,
    status: "starting",
    port: 0,
    pid: 0,
    envDir: state.envDir!,
    ready: Promise.resolve({ ok: false, error: "" }),
  }
  // 在第一个 await 之前放进表里:同一个工程的并发请求会拿到同一次启动的结果,不会各起一个
  running.set(projectDir, e)
  e.ready = launch(e, state)
    .catch((error): OpenResult => ({ ok: false, error: `预览服务启动失败：${String(error)}` }))
    .then((result) => {
      if (!result.ok) {
        if (running.get(projectDir) === e) running.delete(projectDir)
        if (e.pid) killTree(e.pid)
        writeErrorRecord(sessionDir, name, projectDir, result)
      }
      return result
    })
  return e.ready
}

/**
 * 按工程串行化「检查 → 必要时杀掉重起」。
 * 服务卡死(活着但不应答)时,UI 点击和 skill 请求可能同时到达:两边都在等连接探测,然后各自
 * 杀掉、各自重起 —— 先起的那个条目被覆盖,退出时 stopAll 收不到它。
 */
const opening = new Map<string, Promise<OpenResult>>()

/**
 * 打开一个产物的预览:活着且应答就复用,否则当场起。
 * 约定为「返回结果对象、永不 throw」。
 */
export async function open(sessionDir: string, name?: string): Promise<OpenResult> {
  const r = resolveProject(sessionDir, name)
  if (!r.ok) return { ok: false, error: r.error }
  if (!r.state.envDir || !r.state.depsDir) return { ok: false, error: "预览工程信息不完整，请让助手重新生成预览" }

  const inflight = opening.get(r.projectDir)
  if (inflight) return inflight
  const task = openResolved(sessionDir, r.projectDir, r.name, r.state).finally(() => {
    if (opening.get(r.projectDir) === task) opening.delete(r.projectDir)
  })
  opening.set(r.projectDir, task)
  return task
}

async function openResolved(sessionDir: string, projectDir: string, name: string, state: SessionState): Promise<OpenResult> {
  const existing = running.get(projectDir)
  if (existing) {
    if (existing.status === "starting") return existing.ready
    if (isAlive(existing)) {
      if (await canConnect(existing.port)) {
        // 记录可能被外部删掉过(旧版本的清理逻辑、用户清目录)—— verify 靠它找服务,复用时补齐
        const rec = readRecord(existing.sessionDir, existing.name)
        if (!rec || rec.pid !== existing.pid) writeRecord(existing, runtimePaths(existing.sessionDir, existing.name).log)
        return { ok: true, port: existing.port, reused: true }
      }
      // 进程在但不应答 —— 卡死了。杀掉当场重起,不让用户对着一个永远加载不出来的页面
      log.warn("[fastui] dev server 不应答，重新启动", { projectDir, port: existing.port })
      await stopEntry(existing)
    } else {
      running.delete(projectDir)
    }
  }
  return start(sessionDir, projectDir, name, state)
}

function stopEntry(e: Entry, { sync = false }: { sync?: boolean } = {}): Promise<void> {
  if (running.get(e.projectDir) === e) running.delete(e.projectDir)
  const child = e.child
  if (!child || !isAlive(e)) return Promise.resolve()
  return new Promise((done) => {
    const timer = setTimeout(done, 5000)
    child.once("exit", () => {
      clearTimeout(timer)
      done()
    })
    killTree(e.pid, { sync })
  })
}

/** 「重新编译」:结束当前服务,当场重起 */
export async function restart(sessionDir: string, name?: string): Promise<OpenResult> {
  const r = resolveProject(sessionDir, name)
  if (!r.ok) return { ok: false, error: r.error }
  // 正在进行的打开先让它有结果,避免与它交错地杀掉/起服务
  await opening.get(r.projectDir)
  const existing = running.get(r.projectDir)
  if (existing) {
    // 正在起的那一次先等它有结果,再结束它,避免留下一个没人管的进程
    if (existing.status === "starting") await existing.ready
    const current = running.get(r.projectDir)
    if (current) await stopEntry(current)
  }
  return open(sessionDir, name)
}

/** app 退出时统一清理。必须同步 —— 否则进程还没杀掉 Electron 就没了 */
export function stopAll() {
  stopRequestWatcher()
  for (const e of [...running.values()]) {
    running.delete(e.projectDir)
    if (e.pid) {
      killTree(e.pid, { sync: true })
      unregisterPid(e.envDir, e.pid)
    }
  }
  removeHeartbeat()
}

export function list() {
  return [...running.values()].map((e) => ({
    sessionDir: e.sessionDir,
    projectDir: e.projectDir,
    port: e.port,
    pid: e.pid,
    status: e.status,
  }))
}

// ── skill 脚本的请求(SPEC-DES-004 §3.7)────────────────────────────
//
// new-session / verify 需要服务时往共享池的全局目录投一个请求文件,这里轮询处理。
// 放在共享池而不是会话目录:后台跑着的对话用户未必点开过,无法提前知道要盯哪个会话目录。
// 心跳文件让脚本知道宿主在 —— 不在的话(外网 V0、终端直接跑)脚本就自己起,不白等。

let requestTimer: ReturnType<typeof setInterval> | undefined
let heartbeatWrittenFor: string | undefined

function heartbeatPath(envDir: string) {
  return join(envDir, ".octo-host.json")
}

function removeHeartbeat() {
  if (!heartbeatWrittenFor) return
  try {
    const hb = JSON.parse(readFileSync(heartbeatPath(heartbeatWrittenFor), "utf8")) as { pid?: number }
    if (hb?.pid === process.pid) rmSync(heartbeatPath(heartbeatWrittenFor), { force: true })
  } catch {
    /* 忽略 */
  }
  heartbeatWrittenFor = undefined
}

function writeHeartbeat(envDir: string) {
  try {
    const tmp = `${heartbeatPath(envDir)}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    renameSync(tmp, heartbeatPath(envDir))
    heartbeatWrittenFor = envDir
  } catch (error) {
    log.warn("[fastui] 写宿主心跳失败", { envDir, error: String(error) })
  }
}

/** 请求里的路径来自本机脚本,仍然校验:工程必须在会话目录的 outputs 下 */
function validRequest(req: { sessionDir?: unknown; projectDir?: unknown }): { sessionDir: string; name: string } | null {
  if (typeof req.sessionDir !== "string" || typeof req.projectDir !== "string") return null
  const sessionDir = resolve(req.sessionDir)
  const projectDir = resolve(req.projectDir)
  const name = basename(projectDir)
  if (!sessionDir.split(sep).includes(".octo")) return null
  if (join(sessionDir, "outputs", name) !== projectDir) return null
  return { sessionDir, name }
}

function pollRequests() {
  const envDir = fastuiEnvDir()
  // 共享池不存在就是这台机器没装过 fastui 环境,什么都不做(也不去创建它)
  if (!existsSync(envDir)) return
  let hbOk = false
  try {
    hbOk = (JSON.parse(readFileSync(heartbeatPath(envDir), "utf8")) as { pid?: number })?.pid === process.pid
  } catch {
    /* 没有或已损坏 */
  }
  if (!hbOk) writeHeartbeat(envDir)

  const dir = join(envDir, ".devserver-requests")
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return
  }
  for (const f of files) {
    const p = join(dir, f)
    let req: { sessionDir?: unknown; projectDir?: unknown } | null = null
    try {
      req = JSON.parse(readFileSync(p, "utf8"))
    } catch {
      /* 读坏了也要删掉,否则每秒都读一次 */
    }
    try {
      rmSync(p, { force: true })
    } catch {
      continue
    }
    const v = req ? validRequest(req) : null
    if (!v) {
      log.warn("[fastui] 忽略无效的起服务请求", { file: f })
      continue
    }
    void open(v.sessionDir, v.name).then((result) => {
      if (result.ok) return
      log.warn("[fastui] 按请求起服务失败", { ...v, error: result.error })
      // 工程解析阶段就失败时 start() 不会被调用,这里补写,让 verify 立即知道。
      // 已有别的记录(可能是一个正在跑的服务)时不覆盖
      const rec = readRecord(v.sessionDir, v.name)
      if (!rec || rec.status === "error") {
        writeErrorRecord(v.sessionDir, v.name, join(v.sessionDir, "outputs", v.name), result)
      }
    })
  }
}

export function startRequestWatcher() {
  if (requestTimer) return
  requestTimer = setInterval(pollRequests, REQUEST_POLL_MS)
  pollRequests()
}

function stopRequestWatcher() {
  if (requestTimer) clearInterval(requestTimer)
  requestTimer = undefined
}

// ── 启动时清理残留进程(SPEC-DES-004 §3.8)────────────────────────
//
// 崩溃、任务管理器结束进程、kill -9 时退出钩子不会执行,dev server 会一直留着。
// 起服务时登记过 pid,这里在下次启动时逐个收掉。杀之前核对命令行:pid 可能已被别的程序复用。

function commandLineOf(pid: number): Promise<string> {
  return new Promise((done) => {
    const cb = (error: Error | null, stdout: string) => done(error ? "" : String(stdout))
    if (process.platform === "win32") {
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { windowsHide: true, timeout: 15_000 },
        cb,
      )
    } else {
      execFile("ps", ["-p", String(pid), "-o", "command="], { timeout: 5000 }, cb)
    }
  })
}

export async function cleanupOrphans(): Promise<number> {
  const envDir = fastuiEnvDir()
  const dir = pidRegistryDir(envDir)
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return 0
  }
  let killed = 0
  for (const f of files) {
    const pid = Number(f.replace(/\.json$/, ""))
    if (!Number.isInteger(pid) || pid <= 0) continue
    // 本次启动后自己起的服务可能恰好复用了这个 pid —— 那是活的,不能动
    if ([...running.values()].some((e) => e.pid === pid)) continue
    if (pidAlive(pid)) {
      const cmd = await commandLineOf(pid)
      if (cmd.includes("turbo-ui-cli-service")) {
        killTree(pid)
        killed++
        log.info("[fastui] 清理上次遗留的 dev server", { pid })
      }
    }
    if ([...running.values()].some((e) => e.pid === pid)) continue
    try {
      rmSync(join(dir, f), { force: true })
    } catch {
      /* 忽略 */
    }
  }
  return killed
}
