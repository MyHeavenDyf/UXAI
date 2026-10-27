/**
 * global.ts 顶层目录 mkdir 的容错:历史上是无 catch 的 Promise.all,任一目录
 * EACCES 会炸掉模块求值 —— 桌面端 sidecar(utility process)直接 exit 1 且无错误
 * 上报(真实事故:用户 ~/.config 被 root 占用)。
 *
 * 跨平台模拟「目录不可写」用「普通文件占位」:recursive mkdir 遇到已存在的
 * 文件路径必抛(与 desktop storage.test.ts 同一手法,Windows 上 chmod 不可靠)。
 * 四个 XDG 环境变量全部重定向到临时目录,避免动真实家目录。
 *
 * 必须独立于 global.test.ts:env 重定向要在模块加载前生效,而那个文件的静态
 * import 会先加载模块;本文件用动态 import + catch 钉住「加载本身不抛」。
 */
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "global-test-")))

const dataHome = join(root, "data")
const cacheHome = join(root, "cache")
const stateHome = join(root, "state")
const configHome = join(root, "config")
mkdirSync(dataHome, { recursive: true })
mkdirSync(cacheHome, { recursive: true })
mkdirSync(stateHome, { recursive: true })
mkdirSync(configHome, { recursive: true })
// 「不可写」模拟:octo 目录被普通文件占位
writeFileSync(join(configHome, "octo"), "not a directory")

process.env.XDG_DATA_HOME = dataHome
process.env.XDG_CACHE_HOME = cacheHome
process.env.XDG_STATE_HOME = stateHome
process.env.XDG_CONFIG_HOME = configHome

const warnings: string[] = []
const originalWarn = console.warn
console.warn = (message: unknown) => {
  warnings.push(String(message))
}

let importError: unknown
const Global = await import("../src/global").catch((error: unknown) => {
  importError = error
  return undefined
})

console.warn = originalWarn

const savedEnv = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
}

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})

describe("global.ts 顶层 mkdir 容错", () => {
  test("config 目录建不出来不再炸模块求值(桌面端 sidecar 崩溃的根因)", () => {
    expect(importError).toBeUndefined()
    expect(Global).toBeDefined()
  })

  test("失败的目录以 warn 上报,其余目录照常创建", () => {
    expect(warnings.some((line) => line.includes(join(configHome, "octo")))).toBe(true)
    // data 可写,照常建出
    expect(existsSync(join(dataHome, "opencode"))).toBe(true)
  })

  test("路径常量不受 mkdir 失败影响,值仍指向 XDG 解析结果", () => {
    expect(Global!.Path.octoConfig).toBe(join(configHome, "octo"))
    expect(Global!.Path.config).toBe(join(configHome, "opencode"))
    expect(Global!.Path.data).toBe(join(dataHome, "opencode"))
  })
})
