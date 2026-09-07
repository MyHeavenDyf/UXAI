/**
 * fastui dev server 的生命周期管理(SPEC-DES-001 §8.6.1)
 *
 * 为什么由主进程持有,而不是让 skill 脚本自己起:
 * 内网实测(2026-09-06)——`verify.mjs` 用 detached 起的 dev server,脚本一退出就没了。
 * 根因在上游 `packages/opencode/src/tool/shell.ts`:Windows 下 shell 工具显式用
 * `detached: false`,整条链 opencode → PowerShell → verify.mjs → dev server 在同一个
 * Job Object 里,工具收尾时整棵树被清掉;而 shell 工具没有 background 参数。
 *
 * 主流 agent 的做法都是「让一个长命进程持有它」而不是「让子进程脱离」,
 * Electron 主进程正好是那个长命进程。附带解决两件事:
 *   - 不再弹空的 node 窗口(主进程是 GUI 应用,没有 console 可继承)
 *   - 进程有人回收(mac 上 detached 能活,但活到没人管,是另一种问题)
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, openSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs"
import { join } from "node:path"

import log from "electron-log/main.js"

/** webpack dev server 每实例吃数百 MB,不设上限会把设计师的机器拖垮 */
const MAX_SERVERS = 3

type SessionState = {
  name?: string
  projectDir: string
  port: number
  envDir: string
  depsDir: string
}

type Running = {
  sessionDir: string
  projectDir: string
  port: number
  pid: number
  child: ChildProcess
  startedAt: number
}

const running = new Map<string, Running>()
/** 正在等 .octo-fastui.json 出现的会话 */
const pending = new Map<string, { watcher?: FSWatcher; timer: NodeJS.Timeout; deadline: NodeJS.Timeout }>()

export type EnsureResult =
  | { ok: true; port: number; pid: number; logPath: string; reused: boolean }
  | { ok: false; error: string }

function nodeBinOf(envDir: string) {
  return process.platform === "win32" ? join(envDir, "node", "node.exe") : join(envDir, "node", "bin", "node")
}

function readState(sessionDir: string): SessionState | null {
  try {
    const raw = readFileSync(join(sessionDir, ".octo-fastui.json"), "utf8")
    const state = JSON.parse(raw) as SessionState
    if (!state?.projectDir || !state?.port || !state?.depsDir || !state?.envDir) return null
    return state
  } catch {
    return null
  }
}

/** 关掉最旧的,直到运行数低于上限 */
function enforceLimit() {
  while (running.size >= MAX_SERVERS) {
    let oldest: Running | undefined
    for (const r of running.values()) if (!oldest || r.startedAt < oldest.startedAt) oldest = r
    if (!oldest) return
    log.info("[fastui] 超过并发上限,关闭最旧的 dev server", { sessionDir: oldest.sessionDir, port: oldest.port })
    stop(oldest.sessionDir)
  }
}

/**
 * 起(或复用)一个会话的 dev server。
 * 幂等:同一个 sessionDir 重复调用直接返回已有的。
 */
export function ensure(sessionDir: string): EnsureResult {
  const existing = running.get(sessionDir)
  if (existing && !existing.child.killed && existing.child.exitCode === null) {
    return { ok: true, port: existing.port, pid: existing.pid, logPath: join(sessionDir, "devserver.log"), reused: true }
  }

  const state = readState(sessionDir)
  if (!state) return { ok: false, error: `读不到会话状态 ${join(sessionDir, ".octo-fastui.json")}` }

  const nodeBin = nodeBinOf(state.envDir)
  if (!existsSync(nodeBin)) return { ok: false, error: `共享池里没有 node: ${nodeBin}` }

  const cli = join(state.depsDir, "@turboui", "turbo-ui-cli-service", "bin", "turbo-ui-cli-service.js")
  if (!existsSync(cli)) return { ok: false, error: `共享池里没有 turbo-ui-cli-service: ${cli}` }

  const portalDir = join(state.projectDir, "packages", "portal")
  if (!existsSync(portalDir)) return { ok: false, error: `工程目录不存在: ${portalDir}` }

  enforceLimit()

  // 日志路径固定为 .octo/<sid>/devserver.log —— verify 靠读它做编译判定,换地方它就只能超时
  const logPath = join(sessionDir, "devserver.log")
  let logFd: number
  try {
    logFd = openSync(logPath, "a")
  } catch (error) {
    return { ok: false, error: `打不开日志文件 ${logPath}: ${String(error)}` }
  }

  let child: ChildProcess
  try {
    child = spawn(nodeBin, [cli, "serve", "--replace-policy=dev", "--target=esnext"], {
      cwd: portalDir,
      // OCTO_DEPS 缺了 copy-webpack-plugin 找不到拷贝源会 Failed to compile;
      // OCTO_PORT 缺了会回落 8081,多会话必撞(SPEC-DES-001 §2.2)
      env: { ...process.env, OCTO_DEPS: state.depsDir, OCTO_PORT: String(state.port) },
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    })
  } catch (error) {
    try {
      closeSync(logFd)
    } catch {
      /* 已关或无效 */
    }
    return { ok: false, error: `启动失败: ${String(error)}` }
  }

  // spawn 的失败分两种:同步 throw(上面 try/catch 接住)和**异步 error 事件**。
  // 后者(ENOENT、权限不足等)如果没有监听器,Node 会把它当成 unhandled error 抛出去,
  // 直接打爆主进程 —— 参照 server.ts:114 的处理方式。
  child.on("error", (error) => {
    log.warn("[fastui] dev server 进程错误", { sessionDir, error: String(error) })
    if (running.get(sessionDir)?.child === child) running.delete(sessionDir)
  })

  // fd 传给子进程后它有自己的副本,父进程这边必须关掉,否则每起一次泄漏一个
  try {
    closeSync(logFd)
  } catch {
    /* 已关或无效,忽略 */
  }

  if (!child.pid) return { ok: false, error: "启动后拿不到 pid" }

  const entry: Running = {
    sessionDir,
    projectDir: state.projectDir,
    port: state.port,
    pid: child.pid,
    child,
    startedAt: Date.now(),
  }
  running.set(sessionDir, entry)

  child.on("exit", (code) => {
    log.info("[fastui] dev server 退出", { sessionDir, port: entry.port, code })
    // rmSync 必须在这个条件**内**:被 LRU 淘汰的旧进程可能延迟退出,
    // 而那时同一个 sessionDir 上可能已经起了新进程并写好了 .devserver.json ——
    // 在条件外删就会把新进程的状态文件删掉,表现成"宿主时灵时不灵"
    if (running.get(sessionDir) !== entry) return
    running.delete(sessionDir)
    // 进程没了就把状态文件删掉 —— 留着的话 verify 会读到一个死 pid,
    // 而那时端口可能已经被别的会话占用了
    try {
      rmSync(join(sessionDir, ".devserver.json"), { force: true })
    } catch {
      /* 删不掉不影响什么 */
    }
  })

  try {
    writeFileSync(
      join(sessionDir, ".devserver.json"),
      JSON.stringify(
        { port: entry.port, pid: entry.pid, projectDir: entry.projectDir, logPath, startedAt: new Date().toISOString() },
        null,
        2,
      ),
    )
  } catch (error) {
    log.warn("[fastui] 写 .devserver.json 失败", { sessionDir, error: String(error) })
  }

  log.info("[fastui] dev server 已启动", { sessionDir, port: entry.port, pid: entry.pid })
  return { ok: true, port: entry.port, pid: entry.pid, logPath, reused: false }
}

/**
 * @param sync 同步等待进程结束。**只有 app 退出时才该传 true** ——
 *   `spawnSync` 阻塞的是主进程,平时用会直接冻住整个 Electron UI;
 *   而退出那一刻必须同步,否则来不及杀就没了。
 */
export function stop(sessionDir: string, { sync = false }: { sync?: boolean } = {}) {
  const entry = running.get(sessionDir)
  if (!entry) return false
  running.delete(sessionDir)

  // Windows 上 child.kill() 只结束直接子进程,而 webpack dev server 底下还有 worker,
  // 留下来会继续占着端口和内存。taskkill /T 杀整棵树,/F 强制。
  const fallback = () => {
    try {
      entry.child.kill()
    } catch (error) {
      log.warn("[fastui] 结束 dev server 失败", { sessionDir, pid: entry.pid, error: String(error) })
    }
  }

  try {
    if (process.platform !== "win32") {
      fallback()
    } else if (sync) {
      // spawnSync 失败不 throw,只把错误放在返回值里 —— 不查的话 taskkill 挂了会静默漏杀
      const result = spawnSync("taskkill", ["/PID", String(entry.pid), "/T", "/F"], { windowsHide: true })
      if (result.error || result.status !== 0) fallback()
    } else {
      const killer = spawn("taskkill", ["/PID", String(entry.pid), "/T", "/F"], { windowsHide: true })
      killer.on("error", fallback)
      killer.on("exit", (code) => {
        if (code !== 0) fallback()
      })
    }
  } catch (error) {
    log.warn("[fastui] 结束 dev server 失败", { sessionDir, pid: entry.pid, error: String(error) })
    fallback()
  }

  try {
    rmSync(join(sessionDir, ".devserver.json"), { force: true })
  } catch {
    /* 忽略 */
  }
  return true
}

/** app 退出时统一清理 —— 不做的话设计师做几个页面就留下一堆常驻 webpack */
export function stopAll() {
  // app 退出:必须同步,否则进程还没杀掉 Electron 就没了
  for (const sessionDir of [...running.keys()]) stop(sessionDir, { sync: true })
  for (const [sessionDir, entry] of pending) {
    entry.watcher?.close()
    clearInterval(entry.timer)
    clearTimeout(entry.deadline)
    pending.delete(sessionDir)
  }
}

export function list() {
  return [...running.values()].map((r) => ({
    sessionDir: r.sessionDir,
    projectDir: r.projectDir,
    port: r.port,
    pid: r.pid,
    startedAt: r.startedAt,
  }))
}

/**
 * 会话还没跑 skill 时先挂着,等 `.octo-fastui.json` 一出现就起 dev server。
 *
 * 为什么要这样:前端在**建会话时**就调用它,但那时 skill 还没跑过 `new-session`,
 * 状态文件不存在。让前端去轮询是把复杂度推给页面,而页面正好是最不该管进程的地方。
 *
 * 顺带解决了「怎么区分 fastui 会话和普通会话」——**只有 fastui skill 会写出那个文件**,
 * 所以等不到就是普通会话,超时后静默放弃,对其他 Design 用法零影响。
 *
 * 时机上还有个收益:`new-session` 一写完就起,那时 views 下只有 golden example,
 * 编译很快;模型写代码的几十秒里 webpack 已经编完进入 watch,等 verify 时只剩一次
 * 增量编译(几秒),而不是干等 1–3 分钟的首次编译(SPEC-DES-001 §8.6.1)。
 */
export function ensureWhenReady(sessionDir: string, timeoutMs = 10 * 60 * 1000) {
  if (running.has(sessionDir) || pending.has(sessionDir)) return
  if (existsSync(join(sessionDir, ".octo-fastui.json"))) {
    ensure(sessionDir)
    return
  }
  // 注意:这里**不能**因为会话目录还不存在就放弃 —— 前端建目录用的 writeFileBuffer 是异步的
  // 且没有 await,arm 到达主进程时目录多半还没落盘。放弃的话新建会话首次进入必然接管不上,
  // 表现成"宿主根本没接管",而且是个必现的假阴性。下面 watch 建不起来时靠轮询兜底。

  const done = () => {
    const entry = pending.get(sessionDir)
    if (!entry) return
    pending.delete(sessionDir)
    entry.watcher?.close()
    clearInterval(entry.timer)
    clearTimeout(entry.deadline)
  }

  const check = () => {
    if (!existsSync(join(sessionDir, ".octo-fastui.json"))) return
    done()
    const result = ensure(sessionDir)
    if (!result.ok) log.warn("[fastui] 自动启动 dev server 失败", { sessionDir, error: result.error })
  }

  let watcher: FSWatcher | undefined
  try {
    // watch 的事件在各平台不完全一致(尤其 Windows 的重命名/原子写),
    // 所以配一个 3 秒的轮询兜底 —— 一次 existsSync 的开销可以忽略
    watcher = watch(sessionDir, () => check())
  } catch {
    /* 目录还不可监听,靠轮询 */
  }
  pending.set(sessionDir, {
    watcher,
    timer: setInterval(check, 3000),
    deadline: setTimeout(() => {
      log.info("[fastui] 等待会话状态文件超时,按普通会话处理", { sessionDir })
      done()
    }, timeoutMs),
  })
  check()
}
