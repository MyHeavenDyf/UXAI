import { mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
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

export function resolveDesktopStorage(userDataPath: string) {
  const storedMode = getStore().get(STORAGE_MODE_KEY)
  if (storedMode === "app-data-fallback") return createAppDataFallbackStorage(userDataPath, "stored-fallback")

  const legacy = createLegacyStorage(userDataPath)
  if (legacy.explicitDatabase) return legacy

  const availability = ensureWritableDirectory(legacy.dataDirectory)
  if (availability.ok) return legacy

  const fallback = createAppDataFallbackStorage(userDataPath, availability.reason)
  getStore().set(STORAGE_MODE_KEY, fallback.mode)
  return fallback
}

export function createAppDataFallbackStorage(userDataPath: string, reason?: string): DesktopStorage {
  const dataHome = userDataPath
  const dataDirectory = join(dataHome, "opencode")
  const databasePath = join(dataDirectory, databaseFileName())
  const storage = {
    mode: "app-data-fallback" as const,
    dataHome,
    dataDirectory,
    databasePath,
    env: {
      OPENCODE_DB: databasePath,
      XDG_DATA_HOME: dataHome,
      XDG_CONFIG_HOME: join(userDataPath, "xdg-config"),
      XDG_CACHE_HOME: join(userDataPath, "xdg-cache"),
      XDG_STATE_HOME: join(userDataPath, "xdg-state"),
    },
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
