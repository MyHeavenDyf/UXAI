import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OCTO_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (): Configuration => ({
  // jk-j60099994-replace-with-electron-builder-config-2-start
  artifactName: "octo-desktop-${os}-${arch}.${ext}",
  // jk-j60099994-replace-with-electron-builder-config-2-end
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
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
    name: "Octo AI",
    schemes: ["opencode"],
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
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.octo.desktop.dev",
        productName: "Octo AI Dev",
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.octo.desktop.beta",
        productName: "Octo AI Beta",
        protocols: { name: "Octo AI Beta", schemes: ["opencode"] },
        // jk-j60099994-replace-with-electron-builder-config-1-start
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        // jk-j60099994-replace-with-electron-builder-config-1-end
        rpm: { packageName: "opencode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.octo.desktop",
        productName: "Octo AI",
        protocols: { name: "Octo AI", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
        rpm: { packageName: "opencode" },
      }
    }
  }
}

export default getConfig()
