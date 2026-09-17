/**
 * B2 复现(来自 UXAI#880 review,原样保留):旧进程退出得慢(超过 stopEntry 的 5 秒等待),
 * 会删掉新进程刚写的服务记录;之后 open() 复用服务时也不补写,verify 就再也找不到这个服务。
 */
import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "fastui-b2-")))
const envDir = join(root, "env")
process.env.OCTO_FASTUI_ENV_DIR = envDir
const Host = await import("./fastui-devserver")

const nodeBin = Bun.which("node")!
const depsDir = join(envDir, "deps", "node_modules")
const cliDir = join(depsDir, "@turboui", "turbo-ui-cli-service", "bin")
// 收到 SIGTERM 后 7 秒才退出 —— 模拟 Windows 上 taskkill 异步、webpack 退得慢
const FAKE_CLI = `
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 7000))
require("http").createServer((_q, r) => r.end("ok")).listen(Number(process.env.OCTO_PORT), "127.0.0.1")
`
mkdirSync(cliDir, { recursive: true })
writeFileSync(join(cliDir, "turbo-ui-cli-service.js"), FAKE_CLI)

const sessionDir = join(root, "work", ".octo", "s1")
mkdirSync(join(sessionDir, "outputs", "alpha", "packages", "portal"), { recursive: true })
writeFileSync(
  join(sessionDir, ".octo-fastui.json"),
  JSON.stringify({ projectDir: join(sessionDir, "outputs", "alpha"), envDir, depsDir, nodeBin }),
)
const record = join(sessionDir, "devservers", "alpha.json")

afterAll(() => {
  Host.stopAll()
  rmSync(root, { recursive: true, force: true })
})

test("「重新编译」后旧进程慢退,不应删掉新进程的服务记录", async () => {
  const first = await Host.open(sessionDir, "alpha")
  expect(first.ok).toBe(true)

  const second = await Host.restart(sessionDir, "alpha") // stopEntry 等 5 秒超时后起新进程
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(existsSync(record)).toBe(true)

  await Bun.sleep(4000) // 旧进程在这期间真正退出,exit 回调无条件 rmSync(record)
  expect(existsSync(record)).toBe(true) // ← 实际:false

  // open() 复用活着的服务,也不补写记录
  const third = await Host.open(sessionDir, "alpha")
  expect(third.ok && third.reused).toBe(true)
  expect(existsSync(record) && JSON.parse(readFileSync(record, "utf8")).port).toBe(second.port)
}, 30_000)
