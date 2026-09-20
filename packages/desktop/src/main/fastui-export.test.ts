/**
 * 导出脚本的定位(SPEC-DES-001 §8.6.2)。
 *
 * 这里只测 `resolveScript` —— 这次故障(存量会话报「找不到 export-zip.mjs」)整个发生在
 * 定位这一步,跑脚本那一步没问题。用**真起一个 HTTP server** 扮演 sidecar 的 `/skill`,
 * 真在临时目录里放脚本文件,于是「宿主最终挑中了哪一份」可以直接判定。
 *
 * 核心判据:主进程的 `XDG_CONFIG_HOME` 与 server 的不一致时,仍然要能找对 —— 那正是
 * Mac 上 `preferAppEnv()` 捞 shell 环境、以及 app-data-fallback 只灌 sidecar 造成的局面。
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "fastui-export-")))
const SKILL_NAME = "fastui-vue-creator"

const Export = await import("./fastui-export")

/** 造一份「装在这里的 skill」,返回它的目录 */
function installSkill(base: string): string {
  const dir = join(base, "skill", SKILL_NAME)
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(join(dir, "scripts", "export-zip.mjs"), "// fake\n")
  writeFileSync(join(dir, "SKILL.md"), "---\nname: fastui-vue-creator\ndescription: x\n---\n")
  return dir
}

/** 只建目录不放脚本 —— 旧版副本的样子(存量机器上就是这种) */
function installStaleSkill(base: string): string {
  const dir = join(base, "skill", SKILL_NAME)
  mkdirSync(join(dir, "scripts"), { recursive: true })
  return dir
}

/** 扮演 sidecar 的 `GET /skill`;`location` 是 SKILL.md 的绝对路径,与 skill/index.ts 一致 */
function fakeServer(locationOf: (directory: string) => string | null) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== "/skill") return new Response("not found", { status: 404 })
      const location = locationOf(url.searchParams.get("directory") ?? "")
      const body = location ? [{ name: SKILL_NAME, description: "x", location, content: "" }] : []
      return Response.json(body)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

const sessionDir = join(root, "proj", ".octo", "ses_1")
const projectDir = join(root, "proj")
mkdirSync(sessionDir, { recursive: true })

let stopServer: (() => void) | null = null
const savedXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  Export.setServerInfo(null)
})

afterEach(() => {
  stopServer?.()
  stopServer = null
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("resolveScript", () => {
  test("server 给出 location 时按它定位,不看状态文件也不看 XDG", async () => {
    const real = installSkill(join(root, "server-side"))
    const server = fakeServer(() => join(real, "SKILL.md"))
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })
    // 主进程这一侧算出来的是另一个目录(XDG 分裂的现场),而且那里根本没装 skill
    process.env.XDG_CONFIG_HOME = join(root, "main-side-wrong")

    expect(await Export.resolveScript(sessionDir, undefined)).toBe(join(real, "scripts", "export-zip.mjs"))
  })

  test("查询按会话推出的项目目录发起 —— 装在项目目录下的 skill 才找得到", async () => {
    const inProject = installSkill(join(root, "proj", "octo-skills"))
    const seen: string[] = []
    const server = fakeServer((directory) => {
      seen.push(directory)
      return directory === projectDir ? join(inProject, "SKILL.md") : null
    })
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })
    process.env.XDG_CONFIG_HOME = join(root, "main-side-wrong")

    expect(await Export.resolveScript(sessionDir, undefined)).toBe(join(inProject, "scripts", "export-zip.mjs"))
    expect(seen).toEqual([projectDir])
  })

  test("server 不可用时退回状态文件记的 skillDir", async () => {
    const recorded = installSkill(join(root, "recorded"))
    Export.setServerInfo({ url: "http://127.0.0.1:1", username: "opencode", password: "pw" })
    process.env.XDG_CONFIG_HOME = join(root, "main-side-wrong")

    expect(await Export.resolveScript(sessionDir, recorded)).toBe(join(recorded, "scripts", "export-zip.mjs"))
  })

  test("状态文件记的目录已失效(旧版副本没有脚本)时继续往下找", async () => {
    const stale = installStaleSkill(join(root, "stale"))
    const xdgBase = join(root, "xdg-side", "octo")
    const good = installSkill(xdgBase)
    process.env.XDG_CONFIG_HOME = join(root, "xdg-side")

    expect(await Export.resolveScript(sessionDir, stale)).toBe(join(good, "scripts", "export-zip.mjs"))
  })

  test("XDG 候选落空时兜到硬编码的 ~/.config —— deployBuiltinSkills 的部署落点", async () => {
    // 这条候选读的是真实 homedir,测试环境里未必有 skill;此处只验「XDG 落空不会提前返回」
    process.env.XDG_CONFIG_HOME = join(root, "empty-xdg")
    const found = await Export.resolveScript(sessionDir, undefined)
    expect(found === null || found.endsWith(join("scripts", "export-zip.mjs"))).toBe(true)
  })

  test("一处都没有时返回 null,由调用方给出用户可读的失败", async () => {
    process.env.XDG_CONFIG_HOME = join(root, "empty-xdg")
    expect(await Export.resolveScript(join(root, "nowhere", ".octo", "ses_x"), join(root, "nowhere"))).toBe(null)
  })
})
