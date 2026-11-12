import { copyFileSync, cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import log from "electron-log/main.js"
import { getStore } from "./store"

declare const OPENCODE_CHANNEL: string | undefined

const STORAGE_MODE_KEY = "desktopStorageMode"

type StorageMode = "legacy" | "app-data-fallback"

export type DesktopStorage = {
  mode: StorageMode
  dataHome: string
  dataDirectory: string
  databasePath: string
  env: Record<string, string>
  explicitDatabase: boolean
  reason?: string
}

// ---------------------------------------------------------------------------
// Effective XDG path resolution (mirror of what the sidecar actually sees).
//
// The sidecar resolves its config dir via xdg-basedir (`env.XDG_CONFIG_HOME ||
// ~/.config`) AFTER sidecar.ts prepareSidecarEnv applied storage.env over
// process.env. Main-process code that deploys or manages files the server
// reads (skills, skill_config.json, global octo.json) MUST use these helpers
// instead of raw process.env — otherwise app-data-fallback mode splits the
// deploy location from the scan location and the server finds nothing.
// Empty-string XDG values count as unset (`||`, matching xdg-basedir).
// ---------------------------------------------------------------------------

let activeStorage: DesktopStorage | null = null

export function setActiveStorage(storage: DesktopStorage | null) {
  activeStorage = storage
}

export function getActiveStorage(): DesktopStorage | null {
  return activeStorage
}

export function standardXdgConfigHome(env: Record<string, string | undefined> = process.env): string {
  return env.XDG_CONFIG_HOME || join(homedir(), ".config")
}

/**
 * storage.env wins over main-process env — same precedence as sidecar.ts prepareSidecarEnv.
 * 不传参时读 activeStorage holder(index.ts 启动时 setActiveStorage 注入)——主进程 env
 * 在 fallback 覆盖模式下并没有那个变量,holder 才是 sidecar 实际看到的语义。
 */
export function effectiveXdgConfigHome(storage?: DesktopStorage | null): string {
  return (storage ?? activeStorage)?.env.XDG_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
}

export function effectiveXdgCacheHome(storage?: DesktopStorage | null): string {
  return (storage ?? activeStorage)?.env.XDG_CACHE_HOME || process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
}

export function octoConfigDir(storage?: DesktopStorage | null): string {
  return join(effectiveXdgConfigHome(storage), "octo")
}

export function resolveDesktopStorage(userDataPath: string) {
  const storedMode = getStore().get(STORAGE_MODE_KEY)
  if (storedMode === "app-data-fallback") return createAppDataFallbackStorage(userDataPath, "stored-fallback")

  const legacy = createLegacyStorage(userDataPath)
  if (legacy.explicitDatabase) return legacy

  // 除 data 落点外还必须探测 config:sidecar 加载的 core/global.ts 在模块顶层对
  // XDG 各目录做无 catch 的批量 mkdir,~/.config 不可写(root 占用、IT 管控机)会
  // 直接打死 sidecar(exit 1、无错误上报)。config 不可写同样激活 fallback:
  // XDG_CONFIG_HOME 重定向到 <userData>/xdg-config,legacy 位置的用户数据
  // copy-if-missing 跟着搬(见 copyLegacyDataIfMissing)。
  const dataAvailability = ensureWritableDirectory(legacy.dataDirectory)
  const configAvailability = dataAvailability.ok ? ensureWritableDirectory(octoConfigDir(legacy)) : undefined
  if (dataAvailability.ok && configAvailability?.ok) return legacy

  const fallback = createAppDataFallbackStorage(userDataPath, configAvailability?.reason ?? dataAvailability.reason)
  copyLegacyDataIfMissing(legacy, fallback)
  getStore().set(STORAGE_MODE_KEY, fallback.mode)
  return fallback
}

export function createAppDataFallbackStorage(
  userDataPath: string,
  reason?: string,
  env: Record<string, string | undefined> = process.env,
): DesktopStorage {
  const dataHome = userDataPath
  const dataDirectory = join(dataHome, "opencode")
  const databasePath = join(dataDirectory, databaseFileName())
  // Probe the standard config home: if `<xdg-config>/octo` is writable, keep
  // using it — the desktop deploys/manages skills there and existing installs
  // already have their content there. Only relocate config into userData when
  // the standard location is broken, mirroring why fallback exists at all
  // (unwritable ~/.local). Unconditional relocation made the sidecar scan
  // <userData>/xdg-config/octo/skill while deploys landed in ~/.config/octo/skill
  // → server discovered zero skills.
  const standardConfigWritable = ensureWritableDirectory(join(standardXdgConfigHome(env), "octo")).ok
  const sidecarEnv: Record<string, string> = {
    OPENCODE_DB: databasePath,
    XDG_DATA_HOME: dataHome,
    XDG_CACHE_HOME: join(userDataPath, "xdg-cache"),
    XDG_STATE_HOME: join(userDataPath, "xdg-state"),
  }
  if (!standardConfigWritable) sidecarEnv.XDG_CONFIG_HOME = join(userDataPath, "xdg-config")
  const storage: DesktopStorage = {
    mode: "app-data-fallback",
    dataHome,
    dataDirectory,
    databasePath,
    env: sidecarEnv,
    explicitDatabase: false,
    reason,
  }

  Object.values(storage.env)
    .filter((value) => value !== storage.databasePath)
    .forEach((directory) => mkdirSync(directory, { recursive: true, mode: 0o700 }))
  mkdirSync(storage.dataDirectory, { recursive: true, mode: 0o700 })
  return storage
}

export function persistAppDataFallback() {
  getStore().set(STORAGE_MODE_KEY, "app-data-fallback")
}

export function shouldRetryWithAppDataFallback(error: unknown, storage: DesktopStorage) {
  if (storage.mode !== "legacy") return false
  if (storage.explicitDatabase) return false
  const message = serializeErrorMessage(error).toLowerCase()
  return message.includes("unable to open database file") || message.includes("sqlite_cantopen")
}

function createLegacyStorage(userDataPath: string): DesktopStorage {
  const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0 ? process.env.XDG_DATA_HOME : join(homedir(), ".local", "share")
  const dataDirectory = join(dataHome, "opencode")
  const explicitDatabase = process.env.OPENCODE_DB
  const databasePath = explicitDatabase
    ? explicitDatabase === ":memory:" || isAbsolute(explicitDatabase)
      ? explicitDatabase
      : join(dataDirectory, explicitDatabase)
    : join(dataDirectory, databaseFileName())

  return {
    mode: "legacy",
    dataHome,
    dataDirectory,
    databasePath,
    env: {
      XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
    },
    explicitDatabase: Boolean(explicitDatabase),
  }
}

/**
 * 激活 fallback 时把 legacy 位置的用户数据 copy-if-missing 搬到 userData:
 * config 坏但 ~/.local/share 可用的机器(用户此前正常用过)升级后,XDG_DATA_HOME/
 * OPENCODE_DB 一并指向 userData,不搬的话历史会话与登录态会「凭空消失」(留在
 * 旧位置不可见)。copy 永不覆盖、原件不动;失败仅警告 —— fallback 本身必须生效,
 * 否则回到 sidecar 崩溃的局面。storedMode 粘性保证这里只跑一次。
 *
 * 目录搬 storage/(json 迁移源)与 snapshot/(会话快照);plans/ 等瞬时数据不搬。
 */
export function copyLegacyDataIfMissing(legacy: DesktopStorage, fallback: DesktopStorage) {
  try {
    if (legacy.databasePath !== ":memory:" && isAbsolute(legacy.databasePath)) {
      copyFileIfMissing(legacy.databasePath, fallback.databasePath)
      copyFileIfMissing(`${legacy.databasePath}-wal`, `${fallback.databasePath}-wal`)
    }
    copyFileIfMissing(join(legacy.dataDirectory, "auth.json"), join(fallback.dataDirectory, "auth.json"))
    for (const name of ["storage", "snapshot"]) {
      const src = join(legacy.dataDirectory, name)
      const dest = join(fallback.dataDirectory, name)
      if (!existsSync(src) || existsSync(dest)) continue
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(src, dest, { recursive: true })
      log.log("storage fallback: copied directory", src, "→", dest)
    }
  } catch (error) {
    log.warn("storage fallback: failed to copy legacy data", error)
  }
}

function copyFileIfMissing(src: string, dest: string) {
  if (!existsSync(src) || existsSync(dest)) return
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  log.log("storage fallback: copied file", src, "→", dest)
}

function ensureWritableDirectory(directory: string) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const probe = join(directory, `.octo-write-test-${process.pid}-${Date.now()}`)
    writeFileSync(probe, "")
    unlinkSync(probe)
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, reason: serializeErrorMessage(error) }
  }
}

function databaseFileName() {
  const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : process.env.OPENCODE_CHANNEL ?? "local"
  if (["latest", "beta", "prod"].includes(channel) || truthy(process.env.OPENCODE_DISABLE_CHANNEL_DB)) return "opencode.db"
  return `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`
}

function truthy(value: string | undefined) {
  if (!value) return false
  return !["0", "false"].includes(value.toLowerCase())
}

function serializeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
