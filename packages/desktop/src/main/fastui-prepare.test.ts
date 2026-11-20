/**
 * 分享导入的 fastui 工程在本机接手(octo-agent SPEC-DES-009 §3.4 / §5.1)。
 *
 * 与 fastui-export.test.ts 同一个做法:真起一个 HTTP server 扮演 sidecar 的 `/skill`,
 * 真在临时目录里放一份假 skill —— 脚本按 skill 的契约输出 `RESULT:` 行,并把自己被怎么调用
 * 记进日志文件,于是「宿主按什么顺序、带什么参数调了哪几个脚本」可以直接判定。
 * 假安装脚本是 bash,Windows 上跳过(那边的分支只是换成 powershell + `-Upgrade`)。
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "fastui-prepare-")))
const SKILL_NAME = "fastui-vue-creator"

// 经 fastui-export → storage → store 传递导入 electron,原因同 fastui-export.test.ts
const electronMock = { app: { getPath: () => join(root, "user-data"), isPackaged: false }, dialog: {} }
mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const Export = await import("./fastui-export")
const DevServer = await import("./fastui-devserver")
const Prepare = await import("./fastui-prepare")

/** 假 skill 的三个脚本。行为由共享池里的文件决定,调用记录写进 FAKE_LOG */
const ENSURE_ENV = `
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
const env = process.env.OCTO_FASTUI_ENV_DIR
appendFileSync(process.env.FAKE_LOG, "ensure-env\\n")
if (!existsSync(join(env, "deps", "node_modules"))) console.log("RESULT: FAIL | ENV_MISSING: 共享依赖池未安装")
else if (existsSync(join(env, "outdated"))) console.log("RESULT: FAIL | ENV_OUTDATED: 共享池的依赖树与当前 skill 的 template 不一致")
else console.log("RESULT: OK\\nNODE_BIN: " + JSON.parse(readFileSync(join(env, "env.lock.json"), "utf8")).nodePath)
`
const NEW_SESSION = `
import { appendFileSync, mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
const arg = (k) => process.argv.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3)
appendFileSync(process.env.FAKE_LOG, ["new-session", ...process.argv.slice(2), "sid=" + process.env.OCTO_SESSION_ID, "ws=" + process.env.OCTO_WORKSPACE_DIR].join(" ") + "\\n")
if (process.env.FAKE_NEW_SESSION_FAIL) {
  console.error("[warn] 过程日志")
  console.log("RESULT: FAIL | LINK_FAILED: 建依赖链接失败")
  process.exit(1)
}
const env = process.env.OCTO_FASTUI_ENV_DIR
symlinkSync(join(env, "deps", "node_modules"), join(arg("artifact-dir"), arg("name"), "node_modules"), "dir")
console.log("RESULT: OK\\nMODE: reused\\nREUSED_FROM: imported")
`
const INSTALL_SH = `#!/usr/bin/env bash
set -e
echo "install $*" >> "$FAKE_LOG"
mkdir -p "$OCTO_FASTUI_ENV_DIR/deps/node_modules"
rm -f "$OCTO_FASTUI_ENV_DIR/outdated"
printf '{"nodePath":"%s"}' "$FAKE_NODE" > "$OCTO_FASTUI_ENV_DIR/env.lock.json"
echo "RESULT: OK"
`

function installSkill(base: string): string {
  const dir = join(base, "skill", SKILL_NAME)
  mkdirSync(join(dir, "scripts", "install"), { recursive: true })
  writeFileSync(join(dir, "scripts", "ensure-env.mjs"), ENSURE_ENV)
  writeFileSync(join(dir, "scripts", "new-session.mjs"), NEW_SESSION)
  writeFileSync(join(dir, "scripts", "install", "install.sh"), INSTALL_SH)
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${SKILL_NAME}\ndescription: x\n---\n`)
  return dir
}

/** 扮演 sidecar 的 `GET /skill`,只认得 SKILL_NAME */
function fakeServer(location: string) {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/skill"
        ? Response.json([{ name: SKILL_NAME, description: "x", location, content: "" }])
        : new Response("not found", { status: 404 }),
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

type Case = { ws: string; env: string; project: string; log: string }
let current: Case
let stopServer: (() => void) | null = null
const saved = { ...process.env }
let seq = 0

/** 分享导入、尚未接手的工程:带标记但记的是发送方的路径,没有 node_modules */
function importedProject(ws: string, skill = SKILL_NAME) {
  const project = join(ws, "alpha")
  mkdirSync(join(project, "packages", "portal"), { recursive: true })
  writeFileSync(
    join(project, ".octo-fastui.json"),
    JSON.stringify({ schema: 1, skill, name: "alpha", sessions: ["ses_sender"], envDir: "/sender/env", depsDir: "/sender/env/deps/node_modules", nodeBin: "/sender/env/node/bin/node" }),
  )
  return project
}

/** 本机共享池已装好:有依赖目录,清单里记着能跑的 node */
function installedEnv(env: string) {
  mkdirSync(join(env, "deps", "node_modules"), { recursive: true })
  writeFileSync(join(env, "env.lock.json"), JSON.stringify({ nodePath: process.execPath }))
}

const calls = () => (existsSync(current.log) ? readFileSync(current.log, "utf8").trim().split("\n").map((l) => l.trimEnd()) : [])
const target = () => ({ workspaceDir: current.ws, sessionId: "ses_receiver", name: "alpha" })

beforeEach(() => {
  const base = join(root, `case-${++seq}`)
  const ws = join(base, "ws")
  const env = join(base, "env")
  mkdirSync(ws, { recursive: true })
  mkdirSync(env, { recursive: true })
  current = { ws, env, project: importedProject(ws), log: join(base, "calls.log") }
  const skill = installSkill(base)
  const server = fakeServer(join(skill, "SKILL.md"))
  stopServer = server.stop
  Export.setServerInfo({ url: server.url, username: null, password: null })
  process.env.OCTO_FASTUI_ENV_DIR = env
  process.env.FAKE_LOG = current.log
  process.env.FAKE_NODE = process.execPath
  delete process.env.FAKE_NEW_SESSION_FAIL
})

afterEach(() => {
  stopServer?.()
  stopServer = null
  Export.setServerInfo(null)
  for (const k of ["OCTO_FASTUI_ENV_DIR", "FAKE_LOG", "FAKE_NODE", "FAKE_NEW_SESSION_FAIL"]) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("needsPrepare", () => {
  test("open / restart 对未接手的导入工程返回 needsPrepare,不拿发送方的路径去起服务", async () => {
    expect(await DevServer.open(target())).toMatchObject({ ok: false, needsPrepare: true })
    expect(await DevServer.restart(target())).toMatchObject({ ok: false, needsPrepare: true })
  })

  test("已接手(有链接、依赖池与 node 都在本机)不需要接手,不跑任何脚本", async () => {
    installedEnv(current.env)
    symlinkSync(join(current.env, "deps", "node_modules"), join(current.project, "node_modules"), "dir")
    writeFileSync(
      join(current.project, ".octo-fastui.json"),
      JSON.stringify({ schema: 1, skill: SKILL_NAME, name: "alpha", sessions: ["ses_receiver"], envDir: current.env, depsDir: join(current.env, "deps", "node_modules"), nodeBin: process.execPath }),
    )
    expect(await Prepare.prepare(target())).toEqual({ ok: true, adopted: false })
    expect(calls()).toEqual([])
  })
})

describe.skipIf(process.platform === "win32")("prepare", () => {
  test("从没装过环境的机器:先装环境,再 ensure-env,再 new-session --reuse 接手", async () => {
    const r = await Prepare.prepare(target())
    expect(r).toEqual({ ok: true, adopted: true })
    expect(calls()).toEqual([
      "install",
      "ensure-env",
      `new-session --artifact-dir=${current.ws} --name=alpha --reuse sid=ses_receiver ws=${current.ws}`,
    ])
    expect(DevServer.needsPrepare(current.project, { envDir: current.env, depsDir: join(current.env, "deps", "node_modules"), nodeBin: process.execPath })).toBe(false)
  })

  test("已装过环境的机器:不装环境,直接 ensure-env → new-session", async () => {
    installedEnv(current.env)
    expect(await Prepare.prepare(target())).toEqual({ ok: true, adopted: true })
    expect(calls().map((c) => c.split(" ")[0])).toEqual(["ensure-env", "new-session"])
  })

  test("环境过旧(ENV_OUTDATED):带升级开关装一次,再确认一次", async () => {
    installedEnv(current.env)
    writeFileSync(join(current.env, "outdated"), "")
    expect(await Prepare.prepare(target())).toEqual({ ok: true, adopted: true })
    expect(calls().map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual([
      "ensure-env",
      "install --upgrade",
      "ensure-env",
      `new-session --artifact-dir=${current.ws}`,
    ])
  })

  test("new-session 失败:脚本的原因原样透传,带日志末尾", async () => {
    installedEnv(current.env)
    process.env.FAKE_NEW_SESSION_FAIL = "1"
    const r = await Prepare.prepare(target())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe("预览环境准备失败：建依赖链接失败")
    expect(r.logTail).toContain("[warn] 过程日志")
  })

  test("本机没装这个 skill:明确报错,不跑任何脚本", async () => {
    rmSync(current.project, { recursive: true, force: true })
    importedProject(current.ws, "not-installed-skill")
    const r = await Prepare.prepare(target())
    expect(r).toEqual({ ok: false, error: "本机未安装 not-installed-skill，无法预览该产物" })
    expect(calls()).toEqual([])
  })

  test("同一工程并发两次(多个 tab / 连点):共用一次接手", async () => {
    installedEnv(current.env)
    const [a, b] = await Promise.all([Prepare.prepare(target()), Prepare.prepare(target())])
    expect(a).toEqual({ ok: true, adopted: true })
    expect(b).toEqual({ ok: true, adopted: true })
    expect(calls().filter((c) => c.startsWith("new-session"))).toHaveLength(1)
  })
})
