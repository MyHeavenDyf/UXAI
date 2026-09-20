/**
 * 导出脚本的定位(SPEC-DES-001 §8.6.2)。
 *
 * 这里只测 `resolveScript` —— 2026-09 那次故障(存量会话报「找不到 export-zip.mjs」)
 * 整个发生在定位这一步,跑脚本那一步没问题。用**真起一个 HTTP server** 扮演 sidecar 的
 * `/skill`,真在临时目录里放脚本文件,于是「宿主最终挑中了哪一份」可以直接判定。
 *
 * 核心判据来自现场:那台 Mac 上 skill 装在 `…/skill/fastui-vue-creator␠/`(目录名尾部
 * 多一个空格,Windows 建不出这种名字,所以同版本 Windows 全部正常)。server 照常扫到,
 * 而宿主拿常量 `SKILL_NAME` 拼目录名永远 miss —— **按 name 找、拿 location** 才不受
 * 目录名影响,这是本次改动的要害,所以单开一条用例钉住。
 *
 * 候选链读的 `homedir()` / `XDG_CONFIG_HOME` 一律走 `PathEnv` 注入:测试结果不能取决于
 * 跑测试的人本地装没装某个 skill。
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "fastui-export-")))
const SKILL_NAME = "fastui-vue-creator"

const Export = await import("./fastui-export")

/** 空目录,保证候选链上每一条都落到「确实不存在」而不是碰巧命中真实机器上的东西 */
const EMPTY_ENV = { xdgConfig: join(root, "empty-xdg"), homeDir: join(root, "empty-home") }

/**
 * 造一份「装在这里的 skill」,返回它的目录。
 * `dirName` 可以与 skill 名不同 —— 现场那台机器就是这样。
 */
function installSkill(base: string, dirName: string = SKILL_NAME): string {
  const dir = join(base, "skill", dirName)
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(join(dir, "scripts", "export-zip.mjs"), "// fake\n")
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${SKILL_NAME}\ndescription: x\n---\n`)
  return dir
}

/** 只建目录不放脚本 —— 旧版副本的样子 */
function installStaleSkill(base: string): string {
  const dir = join(base, "skill", SKILL_NAME)
  mkdirSync(join(dir, "scripts"), { recursive: true })
  return dir
}

type Captured = { directory: string | null; authorization: string | null }

/** 扮演 sidecar 的 `GET /skill`;`location` 是 SKILL.md 的绝对路径,与 skill/index.ts 一致 */
function fakeServer(locationOf: (directory: string) => string | null, opts?: { requireAuth?: string }) {
  const captured: Captured[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== "/skill") return new Response("not found", { status: 404 })
      const authorization = req.headers.get("authorization")
      captured.push({ directory: url.searchParams.get("directory"), authorization })
      if (opts?.requireAuth && authorization !== opts.requireAuth) {
        return new Response("unauthorized", { status: 401 })
      }
      const location = locationOf(url.searchParams.get("directory") ?? "")
      // name 取自 SKILL.md frontmatter,与目录名无关 —— 这正是现场那台机器的形态
      const body = location ? [{ name: SKILL_NAME, description: "x", location, content: "" }] : []
      return Response.json(body)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, captured, stop: () => server.stop(true) }
}

const sessionDir = join(root, "proj", ".octo", "ses_1")
const projectDir = join(root, "proj")
mkdirSync(sessionDir, { recursive: true })

let stopServer: (() => void) | null = null

beforeEach(() => {
  Export.setServerInfo(null)
})

afterEach(() => {
  stopServer?.()
  stopServer = null
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("resolveScript", () => {
  test("目录名与 skill 名不一致时仍能定位 —— 2026-09 内网 Mac 的现场", async () => {
    // 目录名尾部多一个空格。候选链拿常量拼名字,这一整条链在这里全部落空
    const real = installSkill(join(root, "space-suffix"), `${SKILL_NAME} `)
    const server = fakeServer(() => join(real, "SKILL.md"))
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })

    const found = await Export.resolveScript(sessionDir, undefined, {
      // 候选 #3/#4 指向「名字干净」的那个目录:它不存在,正如现场
      xdgConfig: join(root, "space-suffix"),
      homeDir: join(root, "space-suffix-home"),
    })
    expect(found).toBe(join(real, "scripts", "export-zip.mjs"))
    expect(found).toContain(`${SKILL_NAME} `)
  })

  test("server 给出 location 时按它定位,不看状态文件也不看 XDG", async () => {
    const real = installSkill(join(root, "server-side"))
    const server = fakeServer(() => join(real, "SKILL.md"))
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })

    expect(await Export.resolveScript(sessionDir, undefined, EMPTY_ENV)).toBe(
      join(real, "scripts", "export-zip.mjs"),
    )
  })

  test("查询按会话推出的项目目录发起,并带上 Basic auth", async () => {
    const inProject = installSkill(join(root, "proj", "octo-skills"))
    const expected = `Basic ${Buffer.from("opencode:pw").toString("base64")}`
    const server = fakeServer((directory) => (directory === projectDir ? join(inProject, "SKILL.md") : null), {
      requireAuth: expected,
    })
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })

    expect(await Export.resolveScript(sessionDir, undefined, EMPTY_ENV)).toBe(
      join(inProject, "scripts", "export-zip.mjs"),
    )
    expect(server.captured).toEqual([{ directory: projectDir, authorization: expected }])
  })

  test("auth 不对(401)时不当成「没装」,退回候选链", async () => {
    const recorded = installSkill(join(root, "auth-fallback"))
    const server = fakeServer(() => join(root, "never", "SKILL.md"), { requireAuth: "Basic 对不上" })
    stopServer = server.stop
    Export.setServerInfo({ url: server.url, username: "opencode", password: "pw" })

    expect(await Export.resolveScript(sessionDir, recorded, EMPTY_ENV)).toBe(
      join(recorded, "scripts", "export-zip.mjs"),
    )
  })

  test("server 返回的不是数组时不炸,退回候选链", async () => {
    const recorded = installSkill(join(root, "bad-json"))
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ error: "nope" }) })
    stopServer = () => server.stop(true)
    Export.setServerInfo({ url: `http://127.0.0.1:${server.port}`, username: "opencode", password: "pw" })

    expect(await Export.resolveScript(sessionDir, recorded, EMPTY_ENV)).toBe(
      join(recorded, "scripts", "export-zip.mjs"),
    )
  })

  test("server 不可用时退回状态文件记的 skillDir", async () => {
    const recorded = installSkill(join(root, "recorded"))
    Export.setServerInfo({ url: "http://127.0.0.1:1", username: "opencode", password: "pw" })

    expect(await Export.resolveScript(sessionDir, recorded, EMPTY_ENV)).toBe(
      join(recorded, "scripts", "export-zip.mjs"),
    )
  })

  test("状态文件记的目录已失效(旧版副本没有脚本)时继续往下找", async () => {
    const stale = installStaleSkill(join(root, "stale"))
    const xdgBase = join(root, "xdg-side", "octo")
    const good = installSkill(xdgBase)

    expect(await Export.resolveScript(sessionDir, stale, { ...EMPTY_ENV, xdgConfig: join(root, "xdg-side") })).toBe(
      join(good, "scripts", "export-zip.mjs"),
    )
  })

  test("XDG 落空时兜到 deployBuiltinSkills 硬编码的 ~/.config —— 两条候选不是重复", async () => {
    const homeDir = join(root, "home-side")
    const good = installSkill(join(homeDir, ".config", "octo"))

    expect(await Export.resolveScript(sessionDir, undefined, { xdgConfig: join(root, "empty-xdg"), homeDir })).toBe(
      join(good, "scripts", "export-zip.mjs"),
    )
  })

  test("一处都没有时返回 null,由调用方给出用户可读的失败", async () => {
    expect(await Export.resolveScript(join(root, "nowhere", ".octo", "ses_x"), join(root, "nowhere"), EMPTY_ENV)).toBe(
      null,
    )
  })
})
