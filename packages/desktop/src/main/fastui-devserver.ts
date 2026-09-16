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
import net from "node:net"
import { basename, join } from "node:path"

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

/** 共享池里的 node。导出脚本(fastui-export.ts)也用它,故导出。 */
export function nodeBinOf(envDir: string) {
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

/** 把新端口写回会话状态文件 —— verify / export-zip 都从这里读,不回写它们就还盯着旧端口 */
function writeBackPort(sessionDir: string, port: number) {
  const file = join(sessionDir, ".octo-fastui.json")
  try {
    const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    state.port = port
    state.updatedAt = new Date().toISOString()
    writeFileSync(file, JSON.stringify(state, null, 2))
  } catch (error) {
    // 写不回去不阻断启动:dev server 照样能起,只是 verify 那边可能对不上端口
    log.warn("[fastui] 回写会话状态文件的端口失败", { sessionDir, port, error: String(error) })
  }
}

/** 端口空闲? 只探环回 —— dev server 也只监听这里 */
function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
}

async function findFreePortFrom(start: number, tries = 200) {
  for (let p = start; p < start + tries; p++) if (await portFree(p)) return p
  return null
}

const isAlive = (r: Running) => !r.child.killed && r.child.exitCode === null

export type PreviewOwnership =
  /** 就是本会话(本产物工程)的服务,可以挂 */
  | { owner: "self"; port: number }
  /** 这个端口属于别的会话 —— 绝不能挂,挂上去就是「点 A 的卡片看到 B 的页面」 */
  | { owner: "other"; port: number; actualPort?: number }
  /** 没人在跑 */
  | { owner: "none"; port: number; actualPort?: number }
  /** 有人在听,但不是宿主起的(skill 自管的降级路径 / 用户手工 yarn serve) */
  | { owner: "unknown"; port: number; actualPort?: number }

/** 供判定用的最小快照,便于单测(真实调用从 `running` 现拿) */
export type OwnershipEntry = { sessionDir: string; projectDir: string; port: number }

const projectNameOf = (projectDir: string) => basename(projectDir)

/**
 * 归属判定的纯逻辑部分(可单测)。
 *
 * **身份的单位是产物工程,不是会话。** 一个对话里 `new-session --name` 换个值就是另一个
 * projectDir,而会话状态文件只有一份、会被后者覆盖 —— 于是「同一对话的两张卡片指向两个
 * 工程」是可能的。只按 sessionDir 认领会在这种情况下稳定地显示错页面。
 *
 * `projectName` 来自卡片标题(skill 的 PREVIEW_CARD 把产物文件夹名写在 title 上)。
 * 拿不到(老卡片的标题是 `127.0.0.1:8081`)时按**保守**处理:不认作 self、也不回 actualPort,
 * 于是前端不会自动切 —— 宁可让用户看到「起不来」,也不能给他看另一个工程的页面。
 */
export function resolveOwnership(params: {
  entries: OwnershipEntry[]
  sessionDir: string
  port: number
  projectName?: string
  portIsFree: boolean
}): PreviewOwnership {
  const { entries, sessionDir, port, projectName, portIsFree } = params

  // 本会话在跑的条目里,挑出与卡片同一个产物工程的那个
  const mine = entries.filter((e) => e.sessionDir === sessionDir)
  const sameProject = projectName ? mine.find((e) => projectNameOf(e.projectDir) === projectName) : undefined
  // 没给产物名时只能按会话认 —— 但仅在「本会话只有一个工程在跑」时才没有歧义
  const fallback = !projectName && mine.length === 1 ? mine[0] : undefined
  const own = sameProject ?? fallback
  const actualPort = own?.port

  if (actualPort === port) return { owner: "self", port }

  const takenByOther = entries.some((e) => e.port === port && e.sessionDir !== sessionDir)
  if (takenByOther) return { owner: "other", port, actualPort }

  // 同一个会话、但是**另一个产物工程**占着这个端口 —— 对卡片来说一样是别人的
  const takenByOtherProject = entries.some(
    (e) => e.port === port && e.sessionDir === sessionDir && (!own || e.projectDir !== own.projectDir),
  )
  if (takenByOtherProject) return { owner: "other", port, actualPort }

  return portIsFree ? { owner: "none", port, actualPort } : { owner: "unknown", port, actualPort }
}

/**
 * 这个端口上跑的服务属于谁(SPEC-DES-004 §4.1)。
 *
 * 预览卡片是历史消息里的静态文本,它唯一的身份就是端口号 —— 而端口是会被回收复用的
 * 全机资源(宿主自己的 `MAX_SERVERS` LRU 就会主动释放)。于是「前一个对话的卡片点进去
 * 变成后一个对话的页面」。**卡片不能被信任,挂载前必须问一次这里。**
 *
 * 判定全在主进程内部完成:dev server 都是这里 spawn 并持有的,`running` 就是权威,
 * 不需要让 dev server 自证身份(那条路要么改内网模板加中间件、要么过 CORS,都是白花的力气)。
 */
export async function ownerOf(sessionDir: string, port: number, projectName?: string): Promise<PreviewOwnership> {
  const entries: OwnershipEntry[] = [...running.values()]
    .filter(isAlive)
    .map((r) => ({ sessionDir: r.sessionDir, projectDir: r.projectDir, port: r.port }))
  return resolveOwnership({ entries, sessionDir, port, projectName, portIsFree: await portFree(port) })
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
export async function ensure(sessionDir: string): Promise<EnsureResult> {
  const existing = running.get(sessionDir)
  if (existing && isAlive(existing)) {
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

  // **起之前先确认这个端口还是不是我们的**(SPEC-DES-004 §4.3)。
  //
  // `state.port` 是 new-session 当初分配的,而它**永不失效**;真实监听却会被回收 ——
  // 上面的 enforceLimit 自己就会关掉最旧的 dev server 把端口还给系统。于是一个被 LRU
  // 淘汰过的会话再被打开时,它记着的端口可能已经归了别的对话:照着 spawn 的结果是
  // `EADDRINUSE` 秒退(`exit` 钩子顺手删掉 .devserver.json),而用户那边看到的是
  // **自己的卡片显示着别人的页面**,全程没有一条可见的报错。
  //
  // 被占就换一个,并把新端口回写状态文件 —— 从这一刻起宿主也是端口分配的一方。
  let port = state.port
  if (!(await portFree(port))) {
    const next = await findFreePortFrom(port + 1)
    if (!next) return { ok: false, error: `端口 ${port} 被占用,且从 ${port + 1} 起找不到空闲端口` }
    log.info("[fastui] 会话记的端口已被占用,改用新端口", { sessionDir, was: port, now: next })
    port = next
    writeBackPort(sessionDir, port)
  }

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
      env: { ...process.env, OCTO_DEPS: state.depsDir, OCTO_PORT: String(port) },
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
    port,
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
    void ensure(sessionDir).then((result) => {
      if (!result.ok) log.warn("[fastui] 自动启动 dev server 失败", { sessionDir, error: result.error })
    })
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
    void ensure(sessionDir).then((result) => {
      if (!result.ok) log.warn("[fastui] 自动启动 dev server 失败", { sessionDir, error: result.error })
    })
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
