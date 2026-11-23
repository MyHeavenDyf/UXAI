import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import { releaseNotes } from "./scripts/release-notes"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

// resources/icons 是 gitignore 的生成物,依赖 copy-icons 在打包前生成。若构建机没跑过
// (如旧版 bun 不执行 pre 钩子),electron-builder 会静默跳过 extraResources 或打进旧
// 16-bit PNG,产物表现为 dock 图标加载为空。这里把缺文件/非 8-bit 都变成显式构建失败。
for (const name of ["icon.icns", "icon.png", "icon.ico", "dock.png", "dock-dark.png", "dock-light.png"]) {
  const file = path.join("resources", "icons", name)
  if (!existsSync(file)) {
    throw new Error(`resources/icons/${name} 不存在:先运行 bun ./scripts/copy-icons.ts <channel> 再打包`)
  }
  if (name.startsWith("dock-") && name.endsWith(".png") && readFileSync(file)[24] !== 8) {
    throw new Error(`resources/icons/${name} 非 8-bit PNG:Dock 深浅图标必须 8-bit RGBA,请重新运行 copy-icons`)
  }
}

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const getBase = (): Configuration => ({
  // jk-j60099994-replace-with-electron-builder-config-2-start
  artifactName: "octo-desktop-${os}-${arch}.${ext}",
  // jk-j60099994-replace-with-electron-builder-config-2-end
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  releaseInfo: { releaseNotes },
  // jk-j60099994-replace-with-dyf-bridge-builder-files-start
  // resources/plugin-sdk 排除出 asar：它经 extraResources 单独放入安装目录 resources/plugin-sdk，
  // 若不排除会双份打包（rg 二进制的老问题）
  files: ["out/**/*", "resources/**/*", "!resources/plugin-sdk/**"],
  // jk-j60099994-replace-with-dyf-bridge-builder-files-end
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      from: "../opencode/dist/node/skills.json",
      to: "skills.json",
    },
    {
      from: "../opencode/dist/node/skill",
      to: "skills",
    },
    {
      from: "../opencode/dist/node/prototype",
      to: "prototype",
    },
    {
      from: "resources/bin",
      to: "bin",
      filter: ["**/*"],
    },
    {
      from: "resources/plugin-sdk",
      to: "plugin-sdk",
      filter: ["**/*"],
    },
    {
      from: "../previewdist",
      to: "previewdist",
      filter: ["**/*"],
    },
    {
      from: "src/excode/templates",
      to: "hui-templates",
      filter: ["**/*"],
    },
    // icons 必须落在 asar 外的 Contents/Resources/icons：运行时 iconsDir() 在打包态
    // 读 process.resourcesPath/icons（dock 深浅图标、窗口图标都在这里），files 只会把它打进 asar 内，
    // 打包态永远找不到。dev 态读 packages/desktop/resources/icons，与本条目同源（copy-icons 生成）。
    {
      from: "resources/icons",
      to: "icons",
      filter: ["**/*"],
    },
    // jk-j60099994-replace-with-dyf-bridge-builder-extra-start
    // jk-j60099994-replace-with-dyf-bridge-builder-extra-end
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Octo Agent",
    schemes: ["octo-agent"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    shortcutName: "Octo Agent",
    uninstallDisplayName: "Octo Agent",
    guid: "cf72eba9-3682-4bca-bf7b-6c8053afd856",
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

// jk-j60099994-replace-with-electron-builder-config-1-start
const channel = (() => {
  const raw = process.env.OCTO_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()
function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.octo.desktop.dev",
        productName: "Octo Agent Dev",
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "com.huawei.octoagent.beta",
        productName: "Octo Agent Beta",
        protocols: { name: "Octo Agent Beta", schemes: ["oc", "octo-agent-beta"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        rpm: { packageName: "octo-agent-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.octo.desktop",
        productName: "Octo Agent",
        protocols: { name: "Octo Agent", schemes: ["octo-agent"] },
        publish: { provider: "github", owner: "anomalyco", repo: "octo-agent", channel: "latest" },
        rpm: { packageName: "opencode" },
      }
    }
  }
}
// jk-j60099994-replace-with-electron-builder-config-1-end

export default getConfig()
