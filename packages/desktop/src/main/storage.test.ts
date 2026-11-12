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
 *
 * resolveDesktopStorage 的 config 探测(2026-10 sidecar 崩溃修复):core/global.ts
 * 在模块顶层无 catch 地批量 mkdir,~/.config 不可写会直接打死 sidecar —— legacy
 * 分支现在同时探测 config 目录,不可写则激活 fallback 并 copy-if-missing 搬迁
 * legacy 用户数据(绝不覆盖、原件不动)。
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const root = realpathSync(mkdtempSync(join(tmpdir(), "storage-test-")))

// store.ts 具名导入 electron,bun 的 ESM 加载器对 CJS 字符串导出做具名链接会失败,
// 必须 mock。`default` 不能省:electron-store 是 ESM 且 default-import electron。
// 注册必须先于下面的动态 import。
const electronMock = { app: { getPath: () => join(root, "user-data"), isPackaged: false }, dialog: {} }
mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const Storage = await import("./storage")
const StoreMod = await import("./store")

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

describe("resolveDesktopStorage 探测决策(config 探测 + 数据搬迁)", () => {
  const savedData = process.env.XDG_DATA_HOME
  const savedConfig = process.env.XDG_CONFIG_HOME
  const savedChannel = process.env.OPENCODE_CHANNEL
  // 测试进程没有 electron-vite 注入的 OPENCODE_CHANNEL 编译常量;钉住 env 侧也不带,
  // databaseFileName() 稳定落到 opencode-local.db
  const DB_NAME = "opencode-local.db"
  const mode = () => StoreMod.getStore().get("desktopStorageMode")

  beforeEach(() => {
    StoreMod.getStore().delete("desktopStorageMode")
    delete process.env.OPENCODE_CHANNEL
  })

  afterEach(() => {
    for (const [key, value] of Object.entries({
      XDG_DATA_HOME: savedData,
      XDG_CONFIG_HOME: savedConfig,
      OPENCODE_CHANNEL: savedChannel,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  function setupEnv(dataHome: string, configHome: string) {
    process.env.XDG_DATA_HOME = dataHome
    process.env.XDG_CONFIG_HOME = configHome
  }

  /** <dataHome>/opencode 下预置 legacy 用户数据(DB/WAL/auth/storage/snapshot) */
  function seedLegacyData(dataHome: string) {
    const data = join(dataHome, "opencode")
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, DB_NAME), "legacy-db")
    writeFileSync(join(data, `${DB_NAME}-wal`), "legacy-wal")
    writeFileSync(join(data, "auth.json"), "legacy-auth")
    mkdirSync(join(data, "storage"), { recursive: true })
    writeFileSync(join(data, "storage", "sessionA.json"), "legacy-storage")
    mkdirSync(join(data, "snapshot", "projA"), { recursive: true })
    writeFileSync(join(data, "snapshot", "projA", "obj.txt"), "legacy-snap")
    return data
  }

  test("data 与 config 都可写 → legacy 模式,不落 storedMode", () => {
    const dataHome = freshDir("legacy-data")
    const configHome = freshDir("legacy-xdg")
    setupEnv(dataHome, configHome)

    const storage = Storage.resolveDesktopStorage(freshDir("legacy-user"))

    expect(storage.mode).toBe("legacy")
    expect("XDG_CONFIG_HOME" in storage.env).toBe(false)
    expect(storage.databasePath).toBe(join(dataHome, "opencode", DB_NAME))
    expect(mode()).toBeUndefined()
    // 探测真的发生过(目录被建出来)
    expect(existsSync(join(configHome, "octo"))).toBe(true)
  })

  test("config 不可写 → 激活 fallback 并重定向 XDG_CONFIG_HOME(用户 ~/.config 被占用的崩溃场景)", () => {
    const dataHome = freshDir("cfg-broken-data")
    const configHome = join(root, "cfg-broken-xdg")
    blockOcto(configHome)
    setupEnv(dataHome, configHome)
    const userData = freshDir("cfg-broken-user")

    const storage = Storage.resolveDesktopStorage(userData)

    expect(storage.mode).toBe("app-data-fallback")
    expect(storage.env.XDG_CONFIG_HOME).toBe(join(userData, "xdg-config"))
    expect(storage.databasePath).toBe(join(userData, "opencode", DB_NAME))
    expect(mode()).toBe("app-data-fallback")
  })

  test("激活时 legacy 的 DB/WAL/auth/storage/snapshot copy-if-missing 跟着搬,原件保留", () => {
    const dataHome = freshDir("copy-data")
    const configHome = join(root, "copy-xdg")
    blockOcto(configHome)
    setupEnv(dataHome, configHome)
    const legacyData = seedLegacyData(dataHome)
    const userData = freshDir("copy-user")

    const storage = Storage.resolveDesktopStorage(userData)
    const target = join(userData, "opencode")

    expect(storage.mode).toBe("app-data-fallback")
    expect(readFileSync(join(target, DB_NAME), "utf-8")).toBe("legacy-db")
    expect(readFileSync(join(target, `${DB_NAME}-wal`), "utf-8")).toBe("legacy-wal")
    expect(readFileSync(join(target, "auth.json"), "utf-8")).toBe("legacy-auth")
    expect(readFileSync(join(target, "storage", "sessionA.json"), "utf-8")).toBe("legacy-storage")
    expect(readFileSync(join(target, "snapshot", "projA", "obj.txt"), "utf-8")).toBe("legacy-snap")
    // 原件不动
    expect(readFileSync(join(legacyData, DB_NAME), "utf-8")).toBe("legacy-db")
    expect(existsSync(join(legacyData, "auth.json"))).toBe(true)
  })

  test("目标已存在时绝不覆盖(用户定制优先)", () => {
    const dataHome = freshDir("keep-data")
    const configHome = join(root, "keep-xdg")
    blockOcto(configHome)
    setupEnv(dataHome, configHome)
    seedLegacyData(dataHome)
    const userData = freshDir("keep-user")
    // 预置用户自己的 DB 与 auth(如坏窗口期新建的内容)
    const target = join(userData, "opencode")
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, DB_NAME), "custom-db")
    writeFileSync(join(target, "auth.json"), "custom-auth")

    const storage = Storage.resolveDesktopStorage(userData)

    expect(storage.mode).toBe("app-data-fallback")
    expect(readFileSync(join(target, DB_NAME), "utf-8")).toBe("custom-db")
    expect(readFileSync(join(target, "auth.json"), "utf-8")).toBe("custom-auth")
  })

  test("data 不可写 → 仍激活 fallback(原行为保持)", () => {
    const dataHome = join(root, "data-broken-home")
    mkdirSync(dataHome, { recursive: true })
    writeFileSync(join(dataHome, "opencode"), "not a directory")
    const configHome = freshDir("data-broken-xdg")
    setupEnv(dataHome, configHome)

    const storage = Storage.resolveDesktopStorage(freshDir("data-broken-user"))

    expect(storage.mode).toBe("app-data-fallback")
    expect(mode()).toBe("app-data-fallback")
  })

  test("storedMode 粘性:再次解析走 stored-fallback;config 恢复可写时自愈回标准目录(数据仍在 userData)", () => {
    StoreMod.getStore().set("desktopStorageMode", "app-data-fallback")
    const configHome = freshDir("sticky-xdg")
    const dataHome = freshDir("sticky-data")
    setupEnv(dataHome, configHome)
    const userData = freshDir("sticky-user")

    const storage = Storage.resolveDesktopStorage(userData)

    expect(storage.mode).toBe("app-data-fallback")
    expect(storage.reason).toBe("stored-fallback")
    // config 已可写 → 不再覆盖 XDG_CONFIG_HOME(自愈),但 DB 留在 userData(粘性)
    expect("XDG_CONFIG_HOME" in storage.env).toBe(false)
    expect(storage.databasePath).toBe(join(userData, "opencode", DB_NAME))
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
