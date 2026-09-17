/**
 * fastui 预览服务(SPEC-DES-004)的集成测试。
 *
 * 用一个假 dev server 替换 turbo-ui-cli-service,**真起进程、真占端口**。响应体回工程目录,
 * 于是「这个端口上跑的是谁的服务」可以直接判定。重心在 spec §3.6 的硬性判据:
 * 不会显示别的工程的页面、端口冲突自动换、卡死重起、超时与崩溃都给出明确结果而不是挂住。
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

// macOS 的临时目录是 /private/var 的软链,dev server 报的 cwd 是真实路径 —— 先规范化
const root = realpathSync(mkdtempSync(join(tmpdir(), "fastui-host-")))
const envDir = join(root, "env")
process.env.OCTO_FASTUI_ENV_DIR = envDir

const Host = await import("./fastui-devserver")

const nodeBin = Bun.which("node")!
const depsDir = join(envDir, "deps", "node_modules")
const cliDir = join(depsDir, "@turboui", "turbo-ui-cli-service", "bin")

const FAKE_CLI = `
const http = require("http"), fs = require("fs"), path = require("path")
const port = Number(process.env.OCTO_PORT)
const marker = (n) => path.join(process.cwd(), n)
if (fs.existsSync(marker("CRASH"))) { console.log("SyntaxError: fake compile crash"); process.exit(2) }
if (fs.existsSync(marker("EADDRINUSE_ONCE"))) {
  fs.rmSync(marker("EADDRINUSE_ONCE"))
  console.log("Error: listen EADDRINUSE: address already in use 127.0.0.1:" + port); process.exit(1)
}
if (fs.existsSync(marker("NEVER_LISTEN"))) { setInterval(() => {}, 1000); return }
const srv = http.createServer((_q, r) => r.end("SERVED_BY=" + process.cwd()))
srv.listen(port, "127.0.0.1", () => {
  console.log("Compiled successfully")
  if (fs.existsSync(marker("HANG_AFTER_READY"))) setTimeout(() => { srv.close(); setInterval(() => {}, 1000) }, 1500)
})
`

function session(sid: string, projects: string[]) {
  const sessionDir = join(root, "work", ".octo", sid)
  for (const p of projects) mkdirSync(join(sessionDir, "outputs", p, "packages", "portal"), { recursive: true })
  writeFileSync(
    join(sessionDir, ".octo-fastui.json"),
    JSON.stringify({ projectDir: join(sessionDir, "outputs", projects.at(-1)!), envDir, depsDir, nodeBin }),
  )
  return sessionDir
}
const portal = (sessionDir: string, p: string) => join(sessionDir, "outputs", p, "packages", "portal")

async function servedBy(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/`)
  return (await res.text()).replace("SERVED_BY=", "")
}

beforeAll(() => {
  mkdirSync(cliDir, { recursive: true })
  writeFileSync(join(cliDir, "turbo-ui-cli-service.js"), FAKE_CLI)
})
afterEach(() => Host.stopAll())
afterAll(() => {
  Host.stopAll()
  rmSync(root, { recursive: true, force: true })
})

describe("open", () => {
  test("起服务并返回端口;该端口上跑的就是这个工程", async () => {
    const s = session("s1", ["alpha"])
    const r = await Host.open(s, "alpha")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reused).toBe(false)
    expect(await servedBy(r.port)).toBe(portal(s, "alpha"))
    // 运行时记录写在 devservers/<产物名>.json,verify 靠它找到服务
    expect(existsSync(join(s, "devservers", "alpha.json"))).toBe(true)
  })

  test("活着且应答就复用同一个进程与端口", async () => {
    const s = session("s2", ["alpha"])
    const a = await Host.open(s, "alpha")
    const b = await Host.open(s, "alpha")
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.reused).toBe(true)
    expect(b.port).toBe(a.port)
  })

  test("同一对话两个产物、另一个对话的同名产物并发打开:各拿各的端口,各显示各的", async () => {
    const s = session("s3", ["alpha", "beta"])
    const t = session("s4", ["alpha"])
    const [a, b, c] = await Promise.all([Host.open(s, "alpha"), Host.open(s, "beta"), Host.open(t, "alpha")])
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(new Set([a.port, b.port, c.port]).size).toBe(3)
    expect(await servedBy(a.port)).toBe(portal(s, "alpha"))
    expect(await servedBy(b.port)).toBe(portal(s, "beta"))
    expect(await servedBy(c.port)).toBe(portal(t, "alpha"))
  })

  test("同一工程并发打开只起一个进程", async () => {
    const s = session("s5", ["alpha"])
    const rs = await Promise.all([Host.open(s, "alpha"), Host.open(s, "alpha"), Host.open(s, "alpha")])
    const ports = rs.map((r) => (r.ok ? r.port : -1))
    expect(new Set(ports).size).toBe(1)
    expect(Host.list().filter((e) => e.projectDir === join(s, "outputs", "alpha")).length).toBe(1)
  })

  test("端口已被外部进程占用时跳过它", async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(8081, "127.0.0.1", () => r()))
    try {
      const s = session("s6", ["alpha"])
      const r = await Host.open(s, "alpha")
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.port).not.toBe(8081)
    } finally {
      blocker.close()
    }
  })

  test("进程因 EADDRINUSE 退出时换端口重试,最终成功", async () => {
    const s = session("s7", ["alpha"])
    writeFileSync(join(portal(s, "alpha"), "EADDRINUSE_ONCE"), "")
    const r = await Host.open(s, "alpha")
    expect(r.ok).toBe(true)
    if (r.ok) expect(await servedBy(r.port)).toBe(portal(s, "alpha"))
  })

  test("已就绪但不再应答(卡死):再次打开时杀掉并重起", async () => {
    const s = session("s8", ["alpha"])
    writeFileSync(join(portal(s, "alpha"), "HANG_AFTER_READY"), "")
    const a = await Host.open(s, "alpha")
    expect(a.ok).toBe(true)
    const pidBefore = Host.list()[0]?.pid
    await Bun.sleep(2000) // 等它关掉监听
    rmSync(join(portal(s, "alpha"), "HANG_AFTER_READY"))
    const b = await Host.open(s, "alpha")
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(b.reused).toBe(false)
    expect(Host.list()[0]?.pid).not.toBe(pidBefore)
    expect(await servedBy(b.port)).toBe(portal(s, "alpha"))
  }, 15_000)

  test("启动超时:返回明确错误,不挂住,且不留进程", async () => {
    process.env.OCTO_FASTUI_START_TIMEOUT_MS = "3000"
    try {
      const s = session("s9", ["alpha"])
      writeFileSync(join(portal(s, "alpha"), "NEVER_LISTEN"), "")
      const started = Date.now()
      const r = await Host.open(s, "alpha")
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain("未能启动完成")
      expect(Date.now() - started).toBeLessThan(10_000)
      expect(Host.list().length).toBe(0)
    } finally {
      delete process.env.OCTO_FASTUI_START_TIMEOUT_MS
    }
  }, 15_000)

  test("编译崩溃:返回错误并带日志末尾", async () => {
    const s = session("s10", ["alpha"])
    writeFileSync(join(portal(s, "alpha"), "CRASH"), "")
    const r = await Host.open(s, "alpha")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.logTail).toContain("fake compile crash")
  })
})

describe("resolveProject(老卡片没有产物名)", () => {
  test("对话里只有一个工程:用它", () => {
    const s = session("r1", ["only"])
    const r = Host.resolveProject(s)
    expect(r.ok && r.name).toBe("only")
  })
  test("对话里有多个工程:明确报错,不猜", () => {
    const s = session("r2", ["a", "b"])
    const r = Host.resolveProject(s)
    expect(r.ok).toBe(false)
  })
  test("产物名带路径分隔符:拒绝", () => {
    const s = session("r3", ["a"])
    expect(Host.resolveProject(s, "../r1").ok).toBe(false)
    expect(Host.resolveProject(s, "..").ok).toBe(false)
  })
})

describe("清理", () => {
  test("stopAll 结束全部服务进程", async () => {
    const s = session("c1", ["alpha", "beta"])
    await Promise.all([Host.open(s, "alpha"), Host.open(s, "beta")])
    const pids = Host.list().map((e) => e.pid)
    expect(pids.length).toBe(2)
    Host.stopAll()
    await Bun.sleep(300)
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  })

  test("启动清理:只杀登记过且命令行是 turbo-ui-cli-service 的进程", async () => {
    const s = session("c2", ["alpha"])
    const orphan = spawn(nodeBin, [join(cliDir, "turbo-ui-cli-service.js")], {
      cwd: portal(s, "alpha"),
      env: { ...process.env, OCTO_PORT: "8190" },
      detached: true,
      stdio: "ignore",
    })
    orphan.unref()
    const bystander = spawn("sleep", ["30"], { stdio: "ignore" })
    const reg = join(envDir, ".devserver-pids")
    mkdirSync(reg, { recursive: true })
    for (const pid of [orphan.pid!, bystander.pid!]) writeFileSync(join(reg, `${pid}.json`), JSON.stringify({ pid }))
    await Bun.sleep(500)

    await Host.cleanupOrphans()
    await Bun.sleep(300)
    expect(() => process.kill(orphan.pid!, 0)).toThrow()
    expect(() => process.kill(bystander.pid!, 0)).not.toThrow() // pid 被别的程序占用时不能误杀
    expect(readdirSync(reg).length).toBe(0)
    bystander.kill()
  })
})

describe("skill 的起服务请求", () => {
  test("共享池里投一个请求文件,宿主起对应工程的服务并写心跳", async () => {
    const s = session("q1", ["alpha"])
    Host.startRequestWatcher()
    const dir = join(envDir, ".devserver-requests")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "1.json"), JSON.stringify({ sessionDir: s, projectDir: join(s, "outputs", "alpha") }))
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !Host.list().some((e) => e.status === "ready")) await Bun.sleep(200)
    expect(Host.list().some((e) => e.projectDir === join(s, "outputs", "alpha") && e.status === "ready")).toBe(true)
    expect(existsSync(join(envDir, ".octo-host.json"))).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith(".json")).length).toBe(0)
  })

  test("工程不在会话 outputs 下的请求被忽略", async () => {
    const s = session("q2", ["alpha"])
    Host.startRequestWatcher()
    const dir = join(envDir, ".devserver-requests")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "2.json"), JSON.stringify({ sessionDir: s, projectDir: join(root, "elsewhere", "alpha") }))
    await Bun.sleep(1500)
    expect(Host.list().length).toBe(0)
  })
})
