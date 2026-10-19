import path from "path"
import { cpSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { Effect, Exit } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Npm } from "@opencode-ai/core/npm"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "plugin-sdk-seed" })

// 指向安装包内捆绑的 seed 目录,由 desktop 主进程 createSidecarEnv 注入
// (packages/desktop/src/main/server.ts,与 OPENCODE_RIPGREP_PATH 同通道)
const SEED_DIR_ENV = "OPENCODE_PLUGIN_SDK_DIR"
const MARKER_FILE = ".plugin-sdk-seed.json"
const SDK_PACKAGE = "@opencode-ai/plugin"
const SEED_ROOT_NAME = "octo-plugin-sdk-seed"

export type InstallInput = {
  add: { name: string; version?: string }[]
}

type Deps = {
  npm: Npm.Interface
  fs: AppFileSystem.Interface
  flock: EffectFlock.Interface
}

type PkgJson = Record<string, unknown> | undefined

/**
 * 配置目录依赖安装的 seed 旁路:OPENCODE_PLUGIN_SDK_DIR 可用时直接本地拷贝
 * 捆绑的 @opencode-ai/plugin,替代 npm install 联网(内网 registry 不可达时
 * npm 重试退避会卡 instance bootstrap ~5 分钟)。任何不满足接管条件的情况
 * 原样回退 npm 路径。
 */
export const install = (deps: Deps, dir: string, input: InstallInput): Effect.Effect<void, Npm.InstallFailedError | EffectFlock.LockError> =>
  Effect.gen(function* () {
    // 只拦截 SDK 安装;其它输入原样走 npm
    if (!input?.add.some((pkg) => pkg.name === SDK_PACKAGE)) {
      return yield* deps.npm.install(dir, input)
    }

    const seedDir = process.env[SEED_DIR_ENV]
    if (!seedDir) return yield* deps.npm.install(dir, input)

    const manifest = yield* readJsonSafe(deps, path.join(seedDir, "seed-manifest.json"))
    const pluginVersion = manifest?.pluginVersion
    if (
      typeof pluginVersion !== "string" ||
      !(yield* deps.fs.isFile(path.join(seedDir, "plugin", "package.json"))) ||
      !(yield* deps.fs.isFile(path.join(seedDir, "plugin", "dist", "index.js")))
    ) {
      log.warn("plugin SDK seed invalid, falling back to npm", { seedDir })
      return yield* deps.npm.install(dir, input)
    }

    // 与 Npm.install 的 canWrite 语义对齐:不可写直接静默返回
    const writable = yield* deps.fs.access(dir, { writable: true }).pipe(Effect.as(true), Effect.orElseSucceed(() => false))
    if (!writable) return

    const existingPkg = yield* readJsonSafe(deps, path.join(dir, "package.json"))
    const marker = yield* readMarker(deps, dir)

    if (marker?.pluginVersion === pluginVersion) {
      log.info("plugin SDK seed already applied", { dir, pluginVersion })
      return
    }

    if (marker) {
      // 版本不匹配(应用升级):仅当根 package.json 仍是上次 seed 产物时覆盖,防毁用户手动安装
      if (!isUpgradeSafe(existingPkg)) {
        log.info("config package.json no longer seed-managed, falling back to npm", { dir })
        return yield* deps.npm.install(dir, input)
      }
    } else if (!isUnclaimed(existingPkg)) {
      // 无 marker 但 package.json 带依赖(用户/npm 自管理,如 registry 安装过的目录),不接管
      log.info("config package.json is user-managed, falling back to npm", { dir })
      return yield* deps.npm.install(dir, input)
    }

    // 与 Npm.reify 用同一把锁,保证同目录下 seed 拷贝与 arborist reify 互斥。
    // 回退 npm 必须在锁外执行:reify 内部会再取同一把锁(flock 无重入),锁内调用会死锁
    const copied = yield* Effect.tryPromise({
      try: async () => copyTree(deps, dir, seedDir, pluginVersion, existingPkg),
      catch: (cause) => new Npm.InstallFailedError({ dir, cause }),
    }).pipe(Effect.exit, deps.flock.withLock(`npm-install:${dir}`))

    if (Exit.isFailure(copied)) {
      // rmSync 的 Windows EBUSY/EPERM(插件文件正被 import)等失败:保留现状并回退 npm
      log.warn("plugin SDK seed copy failed, falling back to npm", { dir, error: String(copied.cause) })
      return yield* deps.npm.install(dir, input)
    }

    log.info("plugin SDK seed applied", { dir, pluginVersion, upgraded: marker !== undefined })
  })

function copyTree(deps: Deps, dir: string, seedDir: string, pluginVersion: string, existingPkg: PkgJson) {
  const scopedDir = path.join(dir, "node_modules", "@opencode-ai")
  // 只清除本 scope(含旧版 seed / registry 装的 SDK),不动 node_modules 里用户其它包
  rmSync(scopedDir, { recursive: true, force: true })
  mkdirSync(scopedDir, { recursive: true })
  cpSync(path.join(seedDir, "plugin"), path.join(scopedDir, "plugin"), { recursive: true, force: true })

  // 根 package.json:接管已有文件时保留用户附加字段(如 type: module),否则用 seed 模板
  const rootPkg = existingPkg
    ? { ...existingPkg, name: SEED_ROOT_NAME, private: true, dependencies: { [SDK_PACKAGE]: pluginVersion } }
    : { name: SEED_ROOT_NAME, version: "0.0.0", private: true, dependencies: { [SDK_PACKAGE]: pluginVersion } }
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(rootPkg, null, 2) + "\n")

  // lockfileVersion 3:packages[""].dependencies 的键集合满足 Npm.install checkDirty 短路
  // (packages/core/src/npm.ts:157-185),后续真实 install 不再触发 reify 联网
  const lock = {
    name: SEED_ROOT_NAME,
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: SEED_ROOT_NAME,
        version: "0.0.0",
        dependencies: { [SDK_PACKAGE]: pluginVersion },
      },
      "node_modules/@opencode-ai/plugin": {
        version: pluginVersion,
        resolved: "file:plugin",
      },
    },
  }
  writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n")

  const marker = { pluginVersion, createdAt: new Date().toISOString() }
  writeFileSync(path.join(dir, "node_modules", MARKER_FILE), JSON.stringify(marker, null, 2) + "\n")
}

// 升级安全:根 package.json 是 seed 产物(name 标记)、dependencies 只指向 SDK、
// 且无 dev/peer/optional 依赖字段(有则视为用户接管)
function isUpgradeSafe(pkg: PkgJson) {
  if (!isRecord(pkg) || pkg.name !== SEED_ROOT_NAME) return false
  const deps = Object.keys((pkg.dependencies as Record<string, unknown>) ?? {})
  if (deps.some((name) => name !== SDK_PACKAGE)) return false
  return !(["devDependencies", "peerDependencies", "optionalDependencies"] as const).some((key) => {
    const value = pkg[key]
    return isRecord(value) && Object.keys(value).length > 0
  })
}

// 无主:package.json 不存在,或没有任何依赖字段(可安全接管)
function isUnclaimed(pkg: PkgJson) {
  if (pkg === undefined) return true
  if (!isRecord(pkg)) return false
  return !hasDependencyFields(pkg)
}

function hasDependencyFields(pkg: Record<string, unknown>) {
  return (["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const).some((key) => {
    const value = pkg[key]
    return isRecord(value) && Object.keys(value).length > 0
  })
}

const readMarker = (deps: Deps, dir: string) => readJsonSafe(deps, path.join(dir, "node_modules", MARKER_FILE))

// 读 JSON 并吞掉一切失败:文件不存在(error)、JSON 非法(JSON.parse 抛出是 defect,
// orElseSucceed 接不住)统一返回 undefined
const readJsonSafe = (deps: Deps, file: string): Effect.Effect<Record<string, unknown> | undefined> =>
  deps.fs.readJson(file).pipe(
    Effect.map((value) => (isRecord(value) ? value : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.catchDefect(() => Effect.succeed(undefined)),
  )
