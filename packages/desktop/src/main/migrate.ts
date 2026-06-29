import { app } from "electron"
import log from "electron-log/main.js"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { xdgCache } from "xdg-basedir"
import { CHANNEL } from "./constants"
import { getStore } from "./store"

const TAURI_MIGRATED_KEY = "tauriMigrated"

// Resolve the directory where Tauri stored its .dat files for the given app identifier.
// Mirrors Tauri's AppLocalData / AppData resolution per OS.
function tauriDir(id: string) {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id)
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
  }
}

// The Tauri app identifier changes between dev/beta/prod builds.
const TAURI_APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
function tauriAppId() {
  return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
}

// Old appId values before rename to "Octo AI"
const OLD_APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

function oldAppDataDir() {
  const id = app.isPackaged ? OLD_APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id)
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
  }
}

export function migrateAppId() {
  const newDir = app.getPath("userData")
  const migratedFlag = join(newDir, ".octo-migrated")

  // Already migrated
  if (existsSync(migratedFlag)) return

  // New directory already has content - fresh install
  if (existsSync(newDir)) {
    try {
      if (readdirSync(newDir).length > 0) return
    } catch {
      return
    }
  }

  const oldDir = oldAppDataDir()
  if (!existsSync(oldDir)) return

  try {
    renameSync(oldDir, newDir)
    writeFileSync(migratedFlag, new Date().toISOString())
    log.log("appId migration: renamed", oldDir, "to", newDir)
  } catch (err) {
    log.warn("appId migration: failed to rename directory", err)
  }
}

// Migrate a single Tauri .dat file into the corresponding electron-store.
// `opencode.settings.dat` is special: it maps to the `opencode.settings` store
// (the electron-store name without the `.dat` extension). All other .dat files
// keep their full filename as the electron-store name so they match what the
// renderer already passes via IPC (e.g. `"default.dat"`, `"opencode.global.dat"`).
function migrateFile(datPath: string, filename: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(datPath, "utf-8"))
  } catch (err) {
    log.warn("tauri migration: failed to parse", filename, err)
    return
  }

  // opencode.settings.dat → the electron settings store ("opencode.settings").
  // All other .dat files keep their full filename as the store name so they match
  // what the renderer passes via IPC (e.g. "default.dat", "opencode.global.dat").
  const storeName = filename === "opencode.settings.dat" ? "opencode.settings" : filename
  const target = getStore(storeName)
  const migrated: string[] = []
  const skipped: string[] = []

  for (const [key, value] of Object.entries(data)) {
    // Don't overwrite values the user has already set in the Electron app.
    if (target.has(key)) {
      skipped.push(key)
      continue
    }
    target.set(key, value)
    migrated.push(key)
  }

  log.log("tauri migration: migrated", filename, "→", storeName, { migrated, skipped })
}

export function migrate() {
  if (getStore().get(TAURI_MIGRATED_KEY)) {
    log.log("tauri migration: already done, skipping")
    return
  }

  const dir = tauriDir(tauriAppId())
  log.log("tauri migration: starting", { dir })

  if (!existsSync(dir)) {
    log.log("tauri migration: no tauri data directory found, nothing to migrate")
    getStore().set(TAURI_MIGRATED_KEY, true)
    return
  }

  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith(".dat")) continue
    migrateFile(join(dir, filename), filename)
  }

  log.log("tauri migration: complete")
  getStore().set(TAURI_MIGRATED_KEY, true)
}

export function deploySkillsJson() {
  const configDir = join(homedir(), ".config", "octo")
  const targetPath = join(configDir, "skills.json")

  const sourcePath = app.isPackaged
    ? join(process.resourcesPath, "skills.json")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node", "skills.json")

  if (!existsSync(sourcePath)) {
    log.warn("skills.json deployment: source file not found", sourcePath)
    return
  }

  const sourceContent = JSON.parse(readFileSync(sourcePath, "utf-8")) as Record<string, { description?: string; import?: boolean; type?: string }>

  try {
    mkdirSync(configDir, { recursive: true })

    if (!existsSync(targetPath)) {
      copyFileSync(sourcePath, targetPath)
      log.log("skills.json deployment: copied to", targetPath)
      return
    }

    // Merge type field into existing config
    const existing = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<string, { description?: string; import?: boolean; type?: string }>
    let updated = false
    for (const [name, entry] of Object.entries(sourceContent)) {
      if (existing[name] && !existing[name].type && entry.type) {
        existing[name].type = entry.type
        updated = true
      }
    }
    if (updated) {
      writeFileSync(targetPath, JSON.stringify(existing, null, 2), "utf-8")
      log.log("skills.json deployment: merged type fields into", targetPath)
    }
  } catch (err) {
    log.warn("skills.json deployment: failed", err)
  }
}

export function deployBuiltinSkills() {
  const octoSkillDir = join(homedir(), ".config", "octo", "skill")

  // Skills are now flattened in dist/node/skill/ during build
  const builtinSource = app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node", "skill")

  if (!existsSync(builtinSource)) {
    log.warn("builtin skills deployment: source directory not found", builtinSource)
    return
  }

  try {
    mkdirSync(octoSkillDir, { recursive: true })
    for (const skillDir of readdirSync(builtinSource, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue
      const dest = join(octoSkillDir, skillDir.name)
      if (!existsSync(dest)) {
        cpSync(join(builtinSource, skillDir.name), dest, { recursive: true })
        log.log("builtin skills deployment: copied", skillDir.name, "to", dest)
      }
    }
  } catch (err) {
    log.warn("builtin skills deployment: failed", err)
  }
}

export function deployProtoTools() {
  const configDir = join(homedir(), ".config", "octo")

  const builtinSource = app.isPackaged
    ? process.resourcesPath
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node")

  try {
    // 部署设计系统原型目录 prototype/{version}/
    const prototypeSrc = join(builtinSource, "prototype")
    if (!existsSync(prototypeSrc)) {
      log.warn("proto tools deployment: prototype source not found", prototypeSrc)
      return
    }

    const prototypeDest = join(configDir, "prototype")
    mkdirSync(prototypeDest, { recursive: true })

    for (const dsDir of readdirSync(prototypeSrc, { withFileTypes: true })) {
      if (!dsDir.isDirectory()) continue
      const srcDir = join(prototypeSrc, dsDir.name)
      const destDir = join(prototypeDest, dsDir.name)
      if (existsSync(destDir) && readdirSync(destDir).length > 0) continue
      cpSync(srcDir, destDir, { recursive: true })
      log.log("proto tools deployment: copied prototype/" + dsDir.name, "to", destDir)
    }
  } catch (err) {
    log.warn("proto tools deployment: failed", err)
  }
}

export function deployRipgrep() {
  const { platform, arch } = process

  const platformKey = platform === "darwin"
    ? `darwin-${arch === "arm64" ? "arm64" : "x64"}`
    : platform === "linux"
      ? `linux-${arch === "arm64" ? "arm64" : "x64"}`
      : `windows-${arch === "arm64" ? "arm64" : "x64"}`

  const binaryName = platform === "win32" ? `rg-${platformKey}.exe` : `rg-${platformKey}`
  const targetName = platform === "win32" ? "rg.exe" : "rg"

  const sourceDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources", "bin")

  const sourcePath = join(sourceDir, binaryName)

  if (!existsSync(sourcePath)) {
    log.warn("ripgrep deployment: source binary not found", sourcePath)
    return
  }

  // Use xdgCache to match Global.Path.bin in opencode
  const cacheDir = xdgCache ?? join(homedir(), ".cache")
  const targetDir = join(cacheDir, "opencode", "bin")
  const targetPath = join(targetDir, targetName)

  if (existsSync(targetPath)) {
    log.log("ripgrep deployment: already exists at", targetPath)
    return
  }

  try {
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(sourcePath, targetPath)
    if (platform !== "win32") {
      chmodSync(targetPath, 0o755)
    }
    log.log("ripgrep deployment: deployed to", targetPath)
  } catch (err) {
    log.warn("ripgrep deployment: failed", err)
  }
}
