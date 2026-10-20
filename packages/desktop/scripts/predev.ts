import { $ } from "bun"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

// macOS 打开自定义协议时的系统确认框显示的是注册协议的 app bundle 名称。
// 开发态跑的是 Electron.app(CFBundleDisplayName = "Electron"),导致分享页点
// 「在 Octo Agent 内继续」时系统弹框显示「打开 Electron」。这里把开发态 bundle
// 名改成「Octo Agent」,使弹框显示「打开 Octo Agent」。node_modules 重装后 predev 会重跑。
if (process.platform === "darwin") {
  const electronPath = (await import("electron")).default
  const plist = join(dirname(electronPath), "../Info.plist")
  if (existsSync(plist)) {
    await $`plutil -replace CFBundleDisplayName -string "Octo Agent" ${plist}`
    await $`plutil -replace CFBundleName -string "Octo Agent" ${plist}`
  }
}

await $`bun ./scripts/copy-icons.ts ${process.env.OCTO_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`

await $`bun ./scripts/prepare-plugin-sdk.ts`
