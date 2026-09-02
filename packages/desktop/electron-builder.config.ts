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
      from: "../previewdist",
      to: "previewdist",
      filter: ["**/*"],
    },
    {
      from: "src/excode/templates",
      to: "hui-templates",
      filter: ["**/*"],
    },
    // 3D 打包资源（asar 外）：模板母版快照（含剪过的 node_modules，workspace materialize 拷贝源 +
    // junction 目标）、3d-components src/dist（workspace vite alias + 导出工程 vendor）、bun.exe
    // （workspace vite 运行时，resolveDevRuntime 从 resources/bin 解析）。
    // 注意 1：staging 在 .3d-dist/（包外目录）而非 resources/ 下 —— files 含 resources/** 会把资源
    // 双份收进 asar（250MB 级），故走独立 staging + extraResources。
    // 注意 2：node_modules 必须走独立 entry（from 根下直接叫 node_modules 的目录会被 electron-builder
    // createFilter 硬编码丢弃，filter.js: relative === "node_modules" → false，写什么 filter 都没用）——
    // staging 改名 template-node-modules/ 再映射回 3d/template/node_modules。
    {
      from: ".3d-dist/template",
      to: "3d/template",
      filter: ["**/*"],
    },
    {
      from: ".3d-dist/template-node-modules",
      to: "3d/template/node_modules",
      filter: ["**/*"],
    },
    {
      from: ".3d-dist/3d-components",
      to: "3d/3d-components",
      filter: ["**/*"],
    },
    {
      from: ".3d-dist/bin",
      to: "bin",
      filter: ["**/*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    // CI（有 Apple 开发者证书 + APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 公证凭据）走真签名+公证。
    // 本地任何 Mac 全关：notarize:true 在无公证凭据时 electron-builder 硬错误出不了 dmg；
    // identity 不设且本机无证书时 dmg 签名也会失败。本地 dmg 未签名——首次打开需右键→打开
    // 绕 Gatekeeper，或 xattr -dr com.apple.quarantine '<App>'（与 win 本地 signAndEditExecutable
    // 同款 CI/本地分叉模式）。
    ...(process.env.GITHUB_ACTIONS === "true"
      ? {
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: "resources/entitlements.plist",
          entitlementsInherit: "resources/entitlements.plist",
          notarize: true,
        }
      : { identity: null, hardenedRuntime: false, notarize: false }),
    target: ["dmg", "zip"],
  },
  dmg: {
    ...(process.env.GITHUB_ACTIONS === "true" ? { sign: true } : { sign: false }),
  },
  protocols: {
    name: "Octo Agent",
    schemes: ["octo agent"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    // 本地 signAndEditExecutable:false 关掉 rcedit+签名全链：win32 上改主 exe 图标/版本信息靠
    // rcedit，经 app-builder Go 二进制执行，它会下载 winCodeSign 包取 rcedit.exe，该 7z 含 darwin
    // 符号链接，在无开发者模式/管理员权限的 Windows 上 7z 解压必失败 → 本地出不了安装包（2026-09-01
    // 实证 4 轮全败 EB_EXIT=1，与签名/证书无关，是 rcedit 工具链下载炸的）。toolsets.winCodeSign 在
    // win32 无效（JS getRceditBundle 只在 Linux/wine 路径读，win32 走 Go 二进制不读）。关掉后主 exe
    // 保留 Electron 默认图标，但 NSIS 安装包图标仍由 nsis.installerIcon 独立应用、不受影响，功能无损。
    // CI 在 GH Actions runner（开发者模式已启用）上跑不踩此坑，照常默认 + signWindows 真签名。
    // 想恢复主 exe 自定义图标：Windows 设置开「开发者模式」后即可去掉此 false。
    ...(process.env.GITHUB_ACTIONS === "true"
      ? { signtoolOptions: { sign: signWindows } }
      : { signAndEditExecutable: false }),
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
        protocols: { name: "Octo Agent Beta", schemes: ["oc"] },
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
