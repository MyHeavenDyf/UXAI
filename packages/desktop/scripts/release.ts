#!/usr/bin/env bun
// 一条命令完成「构建 + 打包」，并保证两步的 channel 一致。
//
// 用法（默认 prod）：
//   bun scripts/release.ts --win
//   bun scripts/release.ts --mac --arm64
//   bun scripts/release.ts --mac --x64
// 切换渠道：追加 --channel beta（或 dev）
//   bun scripts/release.ts --win --channel beta
//
// 实现：channel 全程靠 build:<c> / package:<c> 里的 cross-env 强制注入
// OCTO_CHANNEL（跨平台），本脚本只负责按顺序编排这两个已有命令。
import { $ } from "bun"

const argv = Bun.argv.slice(2)

let channel = "prod"
const ci = argv.indexOf("--channel")
if (ci !== -1) {
  channel = argv[ci + 1] ?? ""
  argv.splice(ci, 2)
}
if (channel !== "dev" && channel !== "beta" && channel !== "prod") {
  console.error(`[release] 非法 --channel "${channel}"（应为 dev | beta | prod）`)
  process.exit(1)
}

const platform = argv // 剩余即平台/架构 flag：--win | --mac --arm64 | --mac --x64
if (platform.length === 0) {
  console.error("[release] 缺少平台 flag，例如 --win / --mac --arm64 / --mac --x64")
  process.exit(1)
}

const buildScript = channel === "dev" ? "build" : `build:${channel}`
const packageScript = `package:${channel}`

console.log(`[release] channel=${channel}  platform=${platform.join(" ")}`)
await $`bun run ${buildScript}`
await $`bun run ${packageScript} ${platform}`
console.log(`[release] 完成：${channel} ${platform.join(" ")}（产物在 dist/）`)
