/**
 * 分享导入的 fastui / chart 工程在本机接手(octo-agent SPEC-DES-009 §3.4)
 *
 * 会话分享把对话与工程源码带到了这台机器,但工程能跑起来要的几样东西是发送方机器上的:
 * 标记里的依赖池 / node 路径、`node_modules` 链接,这台机器可能连共享池都没装过。
 * 点卡片时 `open()` 判出 `needsPrepare`,渲染进程转而调这里,完成后再照常 `open()`。
 *
 * **这里只编排,不实现**:装环境、改写标记、建链接都在 skill 自己的脚本里(与 @skill 接着改走的
 * 是同一段逻辑),这里按 SKILL.md 的顺序调用它们、读 `RESULT:` 行 —— 与导出代码包同一个模式。
 * 约定「返回结果对象、永不 throw」。
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import log from "electron-log/main.js"

import { type FastuiTarget, fastuiEnvDir, needsPrepare, resolveProject } from "./fastui-devserver"
import { parseContract, resolveScript } from "./fastui-export"

const SKILL_NAME = "fastui-vue-creator"
/** 首装要下 node、装 1GB 依赖,内网实测几分钟;上限只兜「卡死」,网络超时由安装脚本自己管 */
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const SCRIPT_TIMEOUT_MS = 2 * 60 * 1000
/** ensure-env 报这些码时跑安装脚本(与它 HINT 给的命令一致),true = 带升级开关 */
const INSTALL_CODES: Record<string, boolean> = {
  ENV_MISSING: false,
  ENV_NODE_BROKEN: false,
  ENV_OUTDATED: true,
  ENV_NODE_MISMATCH: true,
}

export type PrepareResult = { ok: true; adopted: boolean } | { ok: false; error: string; logTail?: string }

type RunResult = { code: number | null; stdout: string; stderr: string; error?: string }

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      // 不经 shell:安装路径里有 `Application Support` 这种空格(SPEC-DES-002 §4.4.8 坑 3)
      child = spawn(bin, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error: String(error) })
      return
    }
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
      finish({ code: null, stdout, stderr, error: "超时" })
    }, timeoutMs)
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    // spawn 的异步失败(ENOENT、权限不足)没有监听器时会被当成 unhandled error 打爆主进程
    child.on("error", (error) => finish({ code: null, stdout, stderr, error: String(error) }))
    child.on("close", (code) => finish({ code, stdout, stderr }))
  })
}

/** `RESULT: FAIL | CODE: 原因` → { code, reason } */
function failureOf(result: string | null) {
  const m = /^FAIL \| ([A-Z_]+): (.*)$/.exec(result ?? "")
  return m ? { code: m[1], reason: m[2] } : { code: "", reason: result ?? "" }
}

const tail = (text: string, lines = 40) => text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n")

/** 一步脚本的结果翻成 PrepareResult 的失败形态;成功返回 null */
function failed(step: string, r: RunResult): (PrepareResult & { ok: false }) | null {
  const { result } = parseContract(r.stdout)
  if (result === "OK") return null
  const reason = r.error ? `${step}未能完成（${r.error}）` : failureOf(result).reason || `${step}未能完成`
  return { ok: false, error: `预览环境准备失败：${reason}`, logTail: tail(`${r.stdout}\n${r.stderr}`) }
}

/** 本机共享池记下的 node(setup-env 写进 env.lock.json 的 nodePath:池里的 portable node 或复用的系统 node) */
function nodeFromLock(envDir: string): string | null {
  try {
    const lock = JSON.parse(readFileSync(join(envDir, "env.lock.json"), "utf8")) as { nodePath?: string }
    return lock.nodePath && existsSync(lock.nodePath) ? lock.nodePath : null
  } catch {
    return null
  }
}

/**
 * 跑安装脚本。按平台拼,与 ensure-env.mjs 的 installHint / upgradeHint 逐字同构:
 * PowerShell 只认 `-Upgrade`,写成 `--upgrade` 会被位置绑定到 `$Manifest`(ensure-env.mjs 注释,v14 踩过)。
 */
function install(skillDir: string, upgrade: boolean) {
  const dir = join(skillDir, "scripts", "install")
  const [bin, args] =
    process.platform === "win32"
      ? ["powershell", ["-ExecutionPolicy", "Bypass", "-File", join(dir, "install.ps1"), ...(upgrade ? ["-Upgrade"] : [])]]
      : ["bash", [join(dir, "install.sh"), ...(upgrade ? ["--upgrade"] : [])]]
  log.info("[fastui] 接手:安装预览环境", { upgrade })
  return run(bin as string, args as string[], process.env, INSTALL_TIMEOUT_MS)
}

async function adopt(target: FastuiTarget, projectDir: string, name: string, skillName: string): Promise<PrepareResult> {
  // ① skill 在本机的位置:按名字问 server(标记里的 skillDir 是发送方的路径,不传)
  const newSession = await resolveScript(target.workspaceDir, undefined, undefined, skillName, "new-session.mjs")
  if (!newSession) return { ok: false, error: `本机未安装 ${skillName}，无法预览该产物` }
  const skillDir = dirname(dirname(newSession))
  const envDir = fastuiEnvDir()

  // ② 跑 .mjs 用哪个 node。**不用 Electron 自身(ELECTRON_RUN_AS_NODE)**:共享池没有 node 时
  // new-session 会把「跑着它的 node」记进标记的 nodeBin,之后起 dev server 就是再拉起一个 App
  let node = nodeFromLock(envDir)
  if (!node) {
    const fail = failed("安装预览环境", await install(skillDir, false))
    if (fail) return fail
    node = nodeFromLock(envDir)
    if (!node) return { ok: false, error: "预览环境准备失败：安装完成后仍找不到可用的 node" }
  }

  // ③ ensure-env:缺 / 旧就按它的错误码装一次,再确认一次
  const ensureEnv = join(skillDir, "scripts", "ensure-env.mjs")
  let ensured = await run(node, [ensureEnv], process.env, SCRIPT_TIMEOUT_MS)
  const first = failureOf(parseContract(ensured.stdout).result)
  if (first.code in INSTALL_CODES) {
    const fail = failed("安装预览环境", await install(skillDir, INSTALL_CODES[first.code]))
    if (fail) return fail
    node = nodeFromLock(envDir) ?? node
    ensured = await run(node, [ensureEnv], process.env, SCRIPT_TIMEOUT_MS)
  }
  const ensureFail = failed("检查预览环境", ensured)
  if (ensureFail) return ensureFail
  const nodeBin = parseContract(ensured.stdout).fields.NODE_BIN || node

  // ④ new-session 接手:改写标记、建链接、记上本会话。用户点的是本对话历史里的卡片,复用是明确意图
  const adopted = await run(
    nodeBin,
    [newSession, `--artifact-dir=${dirname(projectDir)}`, `--name=${name}`, "--reuse"],
    { ...process.env, OCTO_SESSION_ID: target.sessionId, OCTO_WORKSPACE_DIR: target.workspaceDir },
    SCRIPT_TIMEOUT_MS,
  )
  const adoptFail = failed("接手预览工程", adopted)
  if (adoptFail) return adoptFail
  log.info("[fastui] 接手完成", { projectDir, skillName })
  return { ok: true, adopted: true }
}

/** 同一工程的并发请求(多个 tab、连点)共用一次接手 */
const inflight = new Map<string, Promise<PrepareResult>>()
/** 安装脚本操作的是全机唯一的共享池,不同工程的接手也要排队 */
let queue: Promise<unknown> = Promise.resolve()

export function prepare(target: FastuiTarget): Promise<PrepareResult> {
  const r = resolveProject(target)
  if (!r.ok) return Promise.resolve({ ok: false, error: r.error })
  if (!needsPrepare(r.projectDir, r.state)) return Promise.resolve({ ok: true, adopted: false })
  const existing = inflight.get(r.projectDir)
  if (existing) return existing
  const skillName = r.state.skill || SKILL_NAME
  const task = queue
    .then(() => adopt(target, r.projectDir, r.name, skillName))
    .catch((error): PrepareResult => {
      log.warn("[fastui] 接手出错", { projectDir: r.projectDir, error: String(error) })
      return { ok: false, error: `预览环境准备失败：${String(error)}` }
    })
    .finally(() => inflight.delete(r.projectDir))
  queue = task
  inflight.set(r.projectDir, task)
  return task
}
