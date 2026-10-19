/**
 * storage.ts 的 XDG 路径语义与 app-data-fallback 的探测决策。
 *
 * 探测决策是 2026-10 skill 全失效修复的核心:fallback 不再无条件覆盖
 * XDG_CONFIG_HOME,而是探测标准 `~/.config/octo` 可写性 —— 可写则保持原位
 * (存量故障机器自愈),不可写才搬到 `<userData>/xdg-config`。
 *
 * 路径助手要钉住的是 `||` 语义(空串 = 未设,与 server 侧 xdg-basedir 一致)
 * 和三级优先级(activeStorage > 主进程 env > 家目录)。跨平台模拟「不可写」
 * 用「普通文件占位」:recursive mkdir 遇到已存在的文件路径必抛。
 */
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "storage-test-")))

// store.ts 具名导入 electron,bun 的 ESM 加载器对 CJS 字符串导出做具名链接会失败,
// 必须 mock。`default` 不能省:electron-store 是 ESM 且 default-import electron。
// 注册必须先于下面的动态 import。
const electronMock = { app: { getPath: () => join(root, "user-data"), isPackaged: false }, dialog: {} }
mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const Storage = await import("./storage")

afterAll(() => rmSync(root, { recursive: true, force: true }))

afterEach(() => {
  Storage.setActiveStorage(null)
})

function freshDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 用普通文件占住 `<base>/octo`,跨平台模拟「该目录不可写」 */
function blockOcto(base: string): void {
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, "octo"), "not a directory")
}

function fakeStorage(xdgConfigHome?: string): Storage.DesktopStorage {
  return {
    mode: "app-data-fallback",
    dataHome: join(root, "fake-home"),
    dataDirectory: join(root, "fake-home", "opencode"),
    databasePath: join(root, "fake-home", "opencode", "opencode.db"),
    env: xdgConfigHome === undefined ? {} : { XDG_CONFIG_HOME: xdgConfigHome },
    explicitDatabase: false,
  }
}

describe("standardXdgConfigHome", () => {
  test("显式设置时返回设置值", () => {
    expect(Storage.standardXdgConfigHome({ XDG_CONFIG_HOME: "/custom-xdg" })).toBe("/custom-xdg")
  })

  test("空串视为未设,退回家目录 —— 与 xdg-basedir 的 || 语义一致", () => {
    expect(Storage.standardXdgConfigHome({ XDG_CONFIG_HOME: "" })).toBe(join(homedir(), ".config"))
    expect(Storage.standardXdgConfigHome({})).toBe(join(homedir(), ".config"))
  })
})

describe("effectiveXdgConfigHome 优先级", () => {
  const saved = process.env.XDG_CONFIG_HOME
  afterEach(() => {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = saved
  })

  test("activeStorage 优先于主进程 env", () => {
    process.env.XDG_CONFIG_HOME = "/from-process"
    Storage.setActiveStorage(fakeStorage("/from-storage"))
    expect(Storage.effectiveXdgConfigHome()).toBe("/from-storage")
  })

  test("activeStorage 未设置时落到主进程 env", () => {
    process.env.XDG_CONFIG_HOME = "/from-process"
    Storage.setActiveStorage(fakeStorage(undefined))
    expect(Storage.effectiveXdgConfigHome()).toBe("/from-process")
  })

  test("activeStorage 的空串穿透到下一级,不当成有效值", () => {
    process.env.XDG_CONFIG_HOME = "/from-process"
    Storage.setActiveStorage(fakeStorage(""))
    expect(Storage.effectiveXdgConfigHome()).toBe("/from-process")
  })

  test("全都没设时退回家目录", () => {
    delete process.env.XDG_CONFIG_HOME
    expect(Storage.effectiveXdgConfigHome()).toBe(join(homedir(), ".config"))
  })
})

describe("路径助手", () => {
  test("octoConfigDir 跟随 effectiveXdgConfigHome", () => {
    Storage.setActiveStorage(fakeStorage("/xdg-override"))
    expect(Storage.octoConfigDir()).toBe(join("/xdg-override", "octo"))
  })

  test("setActiveStorage/getActiveStorage roundtrip", () => {
    const storage = fakeStorage("/roundtrip")
    Storage.setActiveStorage(storage)
    expect(Storage.getActiveStorage()).toBe(storage)
    Storage.setActiveStorage(null)
    expect(Storage.getActiveStorage()).toBe(null)
  })
})

describe("createAppDataFallbackStorage 探测决策", () => {
  test("标准 octo 目录可写时不覆盖 XDG_CONFIG_HOME —— 存量故障机器自愈", () => {
    const userData = freshDir("heal-user")
    const stdHome = freshDir("heal-xdg")

    const storage = Storage.createAppDataFallbackStorage(userData, "test", { XDG_CONFIG_HOME: stdHome })

    expect(storage.mode).toBe("app-data-fallback")
    expect("XDG_CONFIG_HOME" in storage.env).toBe(false)
    expect(storage.env.XDG_DATA_HOME).toBe(userData)
    expect(storage.env.XDG_CACHE_HOME).toBe(join(userData, "xdg-cache"))
    expect(storage.databasePath.startsWith(join(userData, "opencode"))).toBe(true)
    // 探测真的发生过(目录被建出来)
    expect(existsSync(join(stdHome, "octo"))).toBe(true)
  })

  test("标准 octo 目录不可写时覆盖到 <userData>/xdg-config", () => {
    const userData = freshDir("override-user")
    const stdHome = join(root, "override-xdg")
    blockOcto(stdHome)

    const storage = Storage.createAppDataFallbackStorage(userData, "test", { XDG_CONFIG_HOME: stdHome })

    expect(storage.env.XDG_CONFIG_HOME).toBe(join(userData, "xdg-config"))
    expect(existsSync(join(userData, "xdg-config"))).toBe(true)
  })
})
