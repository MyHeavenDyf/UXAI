import { app } from "electron"
import log from "electron-log/main.js"
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { CHANNEL } from "./constants"
import { effectiveXdgCacheHome, octoConfigDir, standardXdgConfigHome } from "./storage"
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

// 恒定 ~/.config/octo(standardXdgConfigHome = XDG_CONFIG_HOME || ~/.config,与 ipc.ts
// getOctoConfigPath 同语义)—— 技能库不随 app-data-fallback 覆盖漂移到 <userData>/xdg-config。
function constantOctoConfigDir() {
  return join(standardXdgConfigHome(), "octo")
}

export function deploySkillsJson(options?: { configDir?: string; sourcePath?: string }) {
  const configDir = options?.configDir ?? constantOctoConfigDir()
  const targetPath = join(configDir, "skills.json")

  const sourcePath =
    options?.sourcePath ??
    (app.isPackaged
      ? join(process.resourcesPath, "skills.json")
      : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node", "skills.json"))

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

export function deployBuiltinSkills(options?: { configDir?: string; skillsSource?: string }) {
  const octoSkillDir = join(options?.configDir ?? constantOctoConfigDir(), "skill")

  // Skills are now flattened in dist/node/skill/ during build
  const builtinSource =
    options?.skillsSource ??
    (app.isPackaged
      ? join(process.resourcesPath, "skills")
      : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node", "skill"))

  if (!existsSync(builtinSource)) {
    log.warn("builtin skills deployment: source directory not found", builtinSource)
    return
  }

  try {
    mkdirSync(octoSkillDir, { recursive: true })
    for (const skillDir of readdirSync(builtinSource, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue
      // spreadsheets 由 extract_document 静态嵌入，不部署到用户维护的 skill 目录。
      // 同名目录可能是用户自定义技能，必须完整保留。
      if (skillDir.name === "spreadsheets") continue
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

const OCTO_CONFIG_COPY_FILES = [
  "skills.json",
  "skill_config.json",
  "assets_config.json",
  "octo.json",
  "octo.jsonc",
  "opencode.json",
  "opencode.jsonc",
] as const

/** 仅复制缺失项,绝不覆盖目标侧已有内容(用户定制/新版本部署优先) */
function copyMissingConfigItems(from: string, to: string) {
  const copied: string[] = []

  const fromSkill = join(from, "skill")
  if (existsSync(fromSkill)) {
    for (const entry of readdirSync(fromSkill, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dest = join(to, "skill", entry.name)
      if (existsSync(dest)) continue
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(join(fromSkill, entry.name), dest, { recursive: true })
      copied.push(`skill/${entry.name}`)
    }
  }

  for (const name of OCTO_CONFIG_COPY_FILES) {
    const src = join(from, name)
    const dest = join(to, name)
    if (!existsSync(src) || existsSync(dest)) continue
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
    copied.push(name)
  }

  if (copied.length > 0) log.log("octo config migration: copied", { from, to, copied })
  return copied
}

/**
 * 把 skill/配置内容对齐到 sidecar 实际读取的 octoConfig 目录。
 *
 * 正向(覆盖激活,octoConfigDir() 指向 <userData>/xdg-config/octo):把 ~/.config/octo
 * 里已有的用户 skill 与配置 copy-if-missing 过去,避免"部署落点跟着搬、存量内容留在原地"。
 *
 * 反向补救(探测式修复后回到 ~/.config/octo):旧版本覆盖窗口期间 server 曾把保存的
 * 全局配置(octo.json 等)写进 <userData>/xdg-config/octo —— rescueDir 存在时把这些
 * 缺失项救回标准目录,防止用户在坏窗口里改的设置凭空消失。
 *
 * 不碰 proxy_config.json(proxy-config.ts 刻意钉死 ~/.config/octo)与 prototype/、
 * design/(server 端硬编码消费,见 deployProtoTools 注释)。
 */
export function migrateLegacyOctoConfig(options?: { sourceDir?: string; targetDir?: string; rescueDir?: string }) {
  const sourceDir = options?.sourceDir ?? join(standardXdgConfigHome(), "octo")
  const targetDir = options?.targetDir ?? octoConfigDir()

  try {
    if (resolve(sourceDir) === resolve(targetDir)) {
      const rescueDir = options?.rescueDir
      if (rescueDir && resolve(rescueDir) !== resolve(targetDir) && existsSync(rescueDir)) {
        copyMissingConfigItems(rescueDir, targetDir)
      }
      return
    }
    if (!existsSync(sourceDir)) return
    mkdirSync(targetDir, { recursive: true })
    copyMissingConfigItems(sourceDir, targetDir)
  } catch (err) {
    log.warn("octo config migration: failed", err)
  }
}

// 刻意保持硬编码 ~/.config/octo/prototype:server 端 proto_tool 硬编码同一路径
// (opencode/src/tool/proto_tool/load_components_docs.ts designSystemDir/designDir、
// agent/proto/theme.ts themeOverrideDir),deployProtoTools 单边跟随 octoConfigDir()
// 会在 app-data-fallback 覆盖模式下把部署落点与 server 读取落点劈开。
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

// jk-j60099994-replace-with-60062650-desktop-main-migrate-1-start
// 同 deployProtoTools:消费方(server 端脚本/工具)按 ~/.config/octo 硬编码路径解析,不跟随 octoConfigDir()。
export async function deployResourceLibraryScripts() {
  const configDir = join(homedir(), ".config", "octo")

  const builtinSource = app.isPackaged
    ? process.resourcesPath
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", "node")

  const srcDir = join(builtinSource, "scripts", "resourceLibraryScript")
  if (!existsSync(srcDir)) {
    log.warn("resourceLibraryScripts deployment: source directory not found", srcDir)
    return
  }

  const destDir = join(configDir, "resourceLibraryScript")

  try {
    cpSync(srcDir, destDir, { recursive: true, force: true })
    log.log("resourceLibraryScripts deployment: copied to", destDir)
  } catch (err) {
    log.warn("resourceLibraryScripts deployment: failed", err)
  }
}
// jk-j60099994-replace-with-60062650-desktop-main-migrate-1-end

/** 安装包内捆绑的 rg 二进制路径（不存在返回 null），deployRipgrep 与 sidecar env 注入共用 */
export function bundledRipgrepPath(): string | null {
  const { platform, arch } = process

  const platformKey = platform === "darwin"
    ? `darwin-${arch === "arm64" ? "arm64" : "x64"}`
    : platform === "linux"
      ? `linux-${arch === "arm64" ? "arm64" : "x64"}`
      : `windows-${arch === "arm64" ? "arm64" : "x64"}`

  const binaryName = platform === "win32" ? `rg-${platformKey}.exe` : `rg-${platformKey}`

  const sourceDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources", "bin")

  const sourcePath = join(sourceDir, binaryName)
  return existsSync(sourcePath) ? sourcePath : null
}

/**
 * 安装包内捆绑的 @opencode-ai/plugin SDK seed 目录（不存在返回 null）。
 * sidecar env 注入共用；运行时由 opencode 侧 plugin-sdk-seed.ts 消费，替代配置目录的 npm install 联网
 * （内网环境 registry.npmjs.org 不可达会卡启动 ~5 分钟）。
 */
export function bundledPluginSdkPath(): string | null {
  const sourceDir = app.isPackaged
    ? join(process.resourcesPath, "plugin-sdk")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources", "plugin-sdk")

  try {
    return statSync(sourceDir).isDirectory() ? sourceDir : null
  } catch {
    return null
  }
}

export function deployRipgrep(options?: { targetDir?: string; sourcePath?: string }) {
  const { platform } = process
  const targetName = platform === "win32" ? "rg.exe" : "rg"

  const sourcePath = options?.sourcePath ?? bundledRipgrepPath()

  if (!sourcePath) {
    log.warn("ripgrep deployment: source binary not found")
    return
  }

  // Use the effective cache home so the deployed copy lands where the sidecar's
  // Global.Path.bin looks (app-data-fallback overrides XDG_CACHE_HOME). In
  // practice OPENCODE_RIPGREP_PATH (server.ts createSidecarEnv) points at the
  // bundled binary and takes priority — this copy only matters when the bundle
  // is missing.
  const targetDir = options?.targetDir ?? join(effectiveXdgCacheHome(), "opencode", "bin")
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
