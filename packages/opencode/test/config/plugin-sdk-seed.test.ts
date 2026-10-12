import { describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as PluginSdkSeed from "@/config/plugin-sdk-seed"
import { Config } from "@/config/config"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { Env } from "../../src/env"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"

const SDK = "@opencode-ai/plugin"
const SEED_ROOT = "octo-plugin-sdk-seed"
const MARKER = ".plugin-sdk-seed.json"

const infra = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

function makeNpm() {
  const calls: { dir: string; input: unknown }[] = []
  const layer = Layer.mock(Npm.Service)({
    install: (dir: string, input: unknown) => Effect.sync(() => void calls.push({ dir, input })),
    add: () => Effect.die("not implemented"),
    which: () => Effect.succeed(Option.none()),
  })
  return { calls, layer }
}

const makeDeps = (npmLayer: Layer.Layer<Npm.Service>) =>
  Effect.gen(function* () {
    return {
      npm: yield* Npm.Service,
      fs: yield* AppFileSystem.Service,
      flock: yield* EffectFlock.Service,
    }
  }).pipe(
    Effect.provide(Layer.mergeAll(EffectFlock.defaultLayer, AppFileSystem.defaultLayer, npmLayer)),
    Effect.provide(infra),
  )

const sdkInput = (version = "1.2.3-test") => ({ add: [{ name: SDK, version }] })

async function withSeed<T>(seedDir: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OPENCODE_PLUGIN_SDK_DIR
  if (seedDir) process.env.OPENCODE_PLUGIN_SDK_DIR = seedDir
  else delete process.env.OPENCODE_PLUGIN_SDK_DIR
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_PLUGIN_SDK_DIR
    else process.env.OPENCODE_PLUGIN_SDK_DIR = prev
  }
}

async function makeSeed(baseDir: string, version: string) {
  const seedDir = path.join(baseDir, "seed")
  await writeSeed(seedDir, version)
  return seedDir
}

async function writeSeed(seedDir: string, version: string) {
  await fs.mkdir(path.join(seedDir, "plugin", "dist"), { recursive: true })
  await Bun.write(
    path.join(seedDir, "seed-manifest.json"),
    JSON.stringify({ pluginVersion: version, opencodeVersion: "test", createdAt: new Date().toISOString() }),
  )
  await Bun.write(
    path.join(seedDir, "plugin", "package.json"),
    JSON.stringify({ name: SDK, version, type: "module", exports: { ".": "./dist/index.js", "./tool": "./dist/tool.js" } }),
  )
  await Bun.write(path.join(seedDir, "plugin", "dist", "index.js"), `export const version = "${version}"\n`)
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"))

describe("PluginSdkSeed.install", () => {
  test("falls back to npm when OPENCODE_PLUGIN_SDK_DIR is unset", async () => {
    await using target = await tmpdir()
    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(undefined, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(1)
    expect(npm.calls[0].dir).toBe(target.path)
    await expect(fs.stat(path.join(target.path, "node_modules"))).rejects.toThrow()
  })

  test("falls back to npm when seed manifest is invalid", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")
    await Bun.write(path.join(seedDir, "seed-manifest.json"), "{ not json")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(1)
    await expect(fs.stat(path.join(target.path, "node_modules"))).rejects.toThrow()
  })

  test("passes non-SDK installs straight to npm", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))
    const input = { add: [{ name: "lodash", version: "1.0.0" }] }

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, input)))

    expect(npm.calls.length).toBe(1)
    expect(npm.calls[0].input).toEqual(input)
    await expect(fs.stat(path.join(target.path, "node_modules"))).rejects.toThrow()
  })

  test("seeds the full SDK tree into an empty config dir", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(0)

    const pluginPkg = await readJson(path.join(target.path, "node_modules", SDK, "package.json"))
    expect(pluginPkg.name).toBe(SDK)
    expect(pluginPkg.exports["."]).toBe("./dist/index.js")
    await expect(fs.readFile(path.join(target.path, "node_modules", SDK, "dist", "index.js"), "utf8")).resolves.toContain(
      "1.2.3-test",
    )

    const rootPkg = await readJson(path.join(target.path, "package.json"))
    expect(rootPkg.name).toBe(SEED_ROOT)
    expect(rootPkg.private).toBe(true)
    expect(rootPkg.dependencies[SDK]).toBe("1.2.3-test")

    const lock = await readJson(path.join(target.path, "package-lock.json"))
    expect(lock.lockfileVersion).toBe(3)
    expect(Object.keys(lock.packages[""].dependencies)).toEqual([SDK])
    expect(lock.packages[`node_modules/${SDK}`].version).toBe("1.2.3-test")

    const marker = await readJson(path.join(target.path, "node_modules", MARKER))
    expect(marker.pluginVersion).toBe("1.2.3-test")
  })

  test("takes over an unclaimed package.json and preserves extra fields", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")
    await Bun.write(path.join(target.path, "package.json"), JSON.stringify({ name: "legacy", type: "module" }))

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(0)
    const rootPkg = await readJson(path.join(target.path, "package.json"))
    expect(rootPkg.name).toBe(SEED_ROOT)
    expect(rootPkg.type).toBe("module")
    expect(rootPkg.dependencies[SDK]).toBe("1.2.3-test")
  })

  test("skips copy when marker version matches", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    // 标记已应用;改动产物文件后再次运行,验证没有重新拷贝
    const touched = path.join(target.path, "node_modules", SDK, "dist", "index.js")
    await Bun.write(touched, "// touched by user")

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(0)
    expect(await fs.readFile(touched, "utf8")).toBe("// touched by user")
  })

  test("overwrites a seed-managed dir when seed version changes", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    // 应用升级:seed 版本变化,目标 package.json 仍是 seed 产物
    await writeSeed(seedDir, "2.0.0-test")
    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput("2.0.0-test"))))

    expect(npm.calls.length).toBe(0)
    const marker = await readJson(path.join(target.path, "node_modules", MARKER))
    expect(marker.pluginVersion).toBe("2.0.0-test")
    const pluginPkg = await readJson(path.join(target.path, "node_modules", SDK, "package.json"))
    expect(pluginPkg.version).toBe("2.0.0-test")
    const rootPkg = await readJson(path.join(target.path, "package.json"))
    expect(rootPkg.dependencies[SDK]).toBe("2.0.0-test")
  })

  test("falls back to npm when the user modified package.json after seeding", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    // 用户接管了配置目录(改 name / 加依赖),seed 不得覆盖
    await Bun.write(
      path.join(target.path, "package.json"),
      JSON.stringify({ name: "my-project", dependencies: { [SDK]: "0.9.0", lodash: "*" } }),
    )
    await writeSeed(seedDir, "2.0.0-test")

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput("2.0.0-test"))))

    expect(npm.calls.length).toBe(1)
    const marker = await readJson(path.join(target.path, "node_modules", MARKER))
    expect(marker.pluginVersion).toBe("1.2.3-test")
    const pluginPkg = await readJson(path.join(target.path, "node_modules", SDK, "package.json"))
    expect(pluginPkg.version).toBe("1.2.3-test")
  })

  test("does not take over a user-managed config dir without node_modules", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")
    await Bun.write(
      path.join(target.path, "package.json"),
      JSON.stringify({ name: "user-project", dependencies: { lodash: "*" } }),
    )

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))

    expect(npm.calls.length).toBe(1)
    await expect(fs.stat(path.join(target.path, "node_modules"))).rejects.toThrow()
  })

  test("silently returns for an unwritable dir", async () => {
    if (process.platform === "win32") return

    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))

    await fs.chmod(target.path, 0o555)
    try {
      await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))
    } finally {
      await fs.chmod(target.path, 0o755).catch(() => {})
    }

    expect(npm.calls.length).toBe(0)
    await expect(fs.stat(path.join(target.path, "node_modules"))).rejects.toThrow()
  })
})

describe("PluginSdkSeed + Npm.install integration", () => {
  test("seeded dir short-circuits real Npm.install without reify", async () => {
    await using target = await tmpdir()
    await using seedBase = await tmpdir()
    const seedDir = await makeSeed(seedBase.path, "1.2.3-test")

    const npm = makeNpm()
    const deps = await Effect.runPromise(makeDeps(npm.layer))
    await withSeed(seedDir, () => Effect.runPromise(PluginSdkSeed.install(deps, target.path, sdkInput())))
    expect(npm.calls.length).toBe(0)

    // 任何 reify 都会实例化 Arborist —— mock 成抛错,验证 install 走 checkDirty 短路(不联网)。
    // bun 的 mock.module 不返回 restore,对该 mock 的作用域为整个测试文件(其余用例均不触 arborist)
    mock.module("@npmcli/arborist", () => ({
      Arborist: class {
        constructor() {
          throw new Error("arborist must not be constructed: seeded dir should short-circuit Npm.install")
        }
      },
    }))

    const realNpmLayer = Npm.layer.pipe(
      Layer.provide(EffectFlock.layer),
      Layer.provide(AppFileSystem.layer),
      Layer.provide(
        Global.layerWith({
          cache: path.join(seedBase.path, "npm-cache"),
          state: path.join(seedBase.path, "npm-state"),
        }),
      ),
      Layer.provide(NodeFileSystem.layer),
    )
    const exit = await Effect.gen(function* () {
      const npmSvc = yield* Npm.Service
      return yield* npmSvc.install(target.path, { add: [{ name: SDK, version: "1.2.3-test" }] })
    })
      .pipe(Effect.exit, Effect.provide(realNpmLayer), Effect.runPromise)

    expect(Exit.isSuccess(exit)).toBe(true)

    const lock = await readJson(path.join(target.path, "package-lock.json"))
    expect(lock.packages[`node_modules/${SDK}`].resolved).toBe("file:plugin")
  })
})

describe("Config.waitForDependencies timeout", () => {
  const emptyAuth = Layer.mock(Auth.Service)({
    all: () => Effect.succeed({}),
  })
  const emptyAccount = Layer.mock(Account.Service)({
    active: () => Effect.succeed(Option.none()),
    activeOrg: () => Effect.succeed(Option.none()),
  })

  test("proceeds when dependency install hangs", async () => {
    await using tmp = await tmpdir<string>({
      init: async (dir) => {
        const cfg = path.join(dir, "configdir")
        await fs.mkdir(cfg, { recursive: true })
        return cfg
      },
    })

    // 永不完成的 install(无定时器、无 IO):只能靠 waitForDependencies 的超时放行
    const hanging: string[] = []
    const hangingNpm = Layer.mock(Npm.Service)({
      install: (dir: string) => Effect.callback<void, never>(() => void hanging.push(dir)),
      add: () => Effect.die("not implemented"),
      which: () => Effect.succeed(Option.none()),
    })

    const layer = Config.layer.pipe(
      Layer.provide(EffectFlock.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Env.defaultLayer),
      Layer.provide(emptyAuth),
      Layer.provide(emptyAccount),
      Layer.provideMerge(CrossSpawnSpawner.defaultLayer.pipe(Layer.provideMerge(infra))),
      Layer.provide(hangingNpm),
    )

    const prevConfigDir = process.env.OPENCODE_CONFIG_DIR
    const prevWait = process.env.OPENCODE_DEPENDENCY_WAIT_TIMEOUT
    const prevSeed = process.env.OPENCODE_PLUGIN_SDK_DIR
    process.env.OPENCODE_CONFIG_DIR = tmp.extra
    process.env.OPENCODE_DEPENDENCY_WAIT_TIMEOUT = "50 millis"
    delete process.env.OPENCODE_PLUGIN_SDK_DIR

    try {
      await WithInstance.provide({
        directory: tmp.path,
        fn: async () => {
          await Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))
          const started = Date.now()
          await Effect.runPromise(
            Config.Service.use((svc) => svc.waitForDependencies()).pipe(Effect.scoped, Effect.provide(layer)),
          )
          expect(Date.now() - started).toBeLessThan(10_000)
        },
      })
      expect(hanging.length).toBeGreaterThanOrEqual(1)
    } finally {
      if (prevConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = prevConfigDir
      if (prevWait === undefined) delete process.env.OPENCODE_DEPENDENCY_WAIT_TIMEOUT
      else process.env.OPENCODE_DEPENDENCY_WAIT_TIMEOUT = prevWait
      if (prevSeed === undefined) delete process.env.OPENCODE_PLUGIN_SDK_DIR
      else process.env.OPENCODE_PLUGIN_SDK_DIR = prevSeed
    }
  })
})
