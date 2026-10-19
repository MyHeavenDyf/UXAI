#!/usr/bin/env bun
// 构建 @opencode-ai/plugin SDK seed：随应用预打包，运行时拷贝到配置目录，替代 npm install 联网。
// 背景：内网环境 registry.npmjs.org 不可达时，config.ts 的后台依赖安装会因 npm 重试退避卡住
// instance bootstrap ~5 分钟（详见 opencode_modify/plugin-sdk-seed.md）。
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const desktopDir = fileURLToPath(new URL("..", import.meta.url))
const pluginDir = path.resolve(desktopDir, "../plugin")
const opencodeDir = path.resolve(desktopDir, "../opencode")

const pluginPkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8")) as {
  name: string
  version: string
  license: string
}
const opencodePkg = JSON.parse(fs.readFileSync(path.join(opencodeDir, "package.json"), "utf8")) as {
  version: string
}

const outDir = path.join(desktopDir, "resources", "plugin-sdk")
// staging 必须与 outDir 同卷（Windows 跨卷 rename 失败）
const stagingDir = path.join(desktopDir, "resources", ".plugin-sdk-staging")

const buildDir = path.join(stagingDir, "plugin", "dist")
fs.rmSync(stagingDir, { recursive: true, force: true })
fs.mkdirSync(buildDir, { recursive: true })

// tui.ts 对 @opentui/* 有值导入（keymap/extras、keymap re-export），桌面端不使用 TUI 插件入口，
// 标记 external 保留 import 语句；index/tool 入口的 effect/zod 全部内联，零外部依赖
const result = await Bun.build({
  target: "node",
  format: "esm",
  sourcemap: "linked",
  entrypoints: [
    path.join(pluginDir, "src", "index.ts"),
    path.join(pluginDir, "src", "tool.ts"),
    path.join(pluginDir, "src", "tui.ts"),
  ],
  outdir: buildDir,
  external: ["@opentui/core", "@opentui/keymap", "@opentui/keymap/extras", "@opentui/solid"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error("plugin SDK seed build failed")
}

// plugin/package.json：exports 指向 dist 产物；type: module 必须保留，
// 否则 Node 按 CJS 解析 ESM .js 触发 MODULE_TYPELESS 重解析警告（即用户日志里那条）
const pluginOut = {
  name: pluginPkg.name,
  version: pluginPkg.version,
  type: "module",
  license: pluginPkg.license,
  exports: {
    ".": "./dist/index.js",
    "./tool": "./dist/tool.js",
    "./tui": "./dist/tui.js",
  },
}
fs.writeFileSync(path.join(stagingDir, "plugin", "package.json"), JSON.stringify(pluginOut, null, 2) + "\n")

// 根 package.json / package-lock.json：满足 Npm.install 的 checkDirty 短路
// （packages[""].dependencies 键比对，packages/core/src/npm.ts:157-185），
// seed 过的目录后续真实 install 也不会触发 reify 联网
const dependencies = { "@opencode-ai/plugin": pluginPkg.version }
const rootPkg = {
  name: "octo-plugin-sdk-seed",
  version: "0.0.0",
  private: true,
  dependencies,
}
fs.writeFileSync(path.join(stagingDir, "package.json"), JSON.stringify(rootPkg, null, 2) + "\n")

const lock = {
  name: "octo-plugin-sdk-seed",
  version: "0.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "octo-plugin-sdk-seed",
      version: "0.0.0",
      dependencies,
    },
    "node_modules/@opencode-ai/plugin": {
      version: pluginPkg.version,
      resolved: "file:plugin",
    },
  },
}
fs.writeFileSync(path.join(stagingDir, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n")

// 运行时幂等/版本覆盖判定的唯一依据（plugin-sdk-seed.ts 读取）
const manifest = {
  pluginVersion: pluginPkg.version,
  opencodeVersion: opencodePkg.version,
  createdAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(stagingDir, "seed-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")

fs.rmSync(outDir, { recursive: true, force: true })
fs.renameSync(stagingDir, outDir)

console.log(`plugin SDK seed built at ${outDir} (plugin@${pluginPkg.version}, opencode@${opencodePkg.version})`)
