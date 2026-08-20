/**
 * 导出 3d-templete 工程为开发者可独立运行的 zip（Step 10）。
 *
 * 产物 = 母版 3d-templete 副本 + 注入：
 *   1. 当前版本生成的 handler 代码（codeDir → src/3d/managers/component/handlers/... + index.ts，覆盖母版基础 handler）
 *   2. 场景数据 public/live-data.json（sceneConfig，in-memory 当前 merged 为权威）
 *   3. 开发者 README.md
 *   4. 改 package.json：加 `@a3d/a3d-components: file:./vendor/3d-components`（libraryBridge 用此名 import）
 *   5. 删副本 vite.config.ts 的 @a3d/a3d-components alias（让其走 node_modules → vendor）
 *   6. vendor 3d-components/dist → vendor/3d-components/dist + 精简 vendor package.json（name @a3d/a3d-components）
 *
 * 导出后 `npm install && npm run dev` → 开 / 路由 → Scene3D 调 loadLiveDataConfig() 自加载 live-data.json
 * 渲染生成场景，无需 host（3d-templete 独立加载已具备，见 Embed.vue/Scene3D.vue）。
 */
import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"
import type { SceneConfig } from "../scene-config"

/** 开发者 README 内容 */
const DEV_README = `# 3D Scene Project

This project was exported from the 3D scene editor — it contains the generated scene (handlers + live-data), vendored 3d-components, and runs standalone (no host needed).

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://127.0.0.1:5173/ in your browser — the \`/\` route loads \`public/live-data.json\` and renders the scene.

## Project Structure

- Scene data: \`public/live-data.json\` (TreeScene: grouped flat \`{ [type]: [{ id, params, parentId }] }\` + camera/lights)
- Generated handlers: \`src/3d/managers/component/handlers/<type>/<type>.ts\` (LLM-written, registered in \`handlers/index.ts\`)
- 3D engine: 3d-templete (Vue 3 + Vite + Three.js)
- Components: \`vendor/3d-components/\` (vendored as \`file:\` dependency, installs offline)

## Customization

- Edit \`public/live-data.json\` to change scene data (add/remove objects per type, or top-level \`remove: [ids]\`).
- Edit handlers under \`src/3d/managers/component/handlers/\` to change how a type is built/animated.
- Scene data contract: each handler exposes \`dataSchema\` (props contract for its type).

## Real-time Updates (optional)

Poll your own API and call \`window.scene3d.update(patch)\` where \`patch\` is a TreeScene
(add/change objects per type, or \`{ remove: [ids] }\`). See \`?update=...\` in \`src/views/Scene3D.vue\` for the demo poller.
`

export async function exportProject(opts: {
  templateSrc: string          // 3d-templete 源码绝对路径（母版）
  componentsSrc: string        // 3d-components 源码绝对路径（取 dist + package.json）
  sceneConfig: SceneConfig     // 当前场景数据（注入为 public/live-data.json）
  defaultName: string          // zip 默认文件名
  codeDir?: string             // 当前版本生成代码归档目录（version-history，无则仅导母版+live-data）
}): Promise<void> {
  const desktopApi = getDesktopApi()

  if (!desktopApi?.exportProjectZip || !desktopApi?.writeFileBuffer || !desktopApi?.readFileBuffer) {
    showToast({ title: "当前环境不支持导出工程" })
    return
  }

  // injectFiles: codeDir 生成代码先入、sceneConfig live-data 后入为权威
  const injectFiles: { path: string; content: string }[] = []

  // 1. 注入当前版本生成的 handler 代码（codeDir → workspace 相对路径）
  //    读法复用 workspace.ts overlayVersionCode：listDirectory + readFileBuffer + TextDecoder。
  //    过滤 live-data.json：以第 2 步 sceneConfig 注入为权威，避免双注歧义。
  if (opts.codeDir && desktopApi.listDirectory) {
    try {
      const entries = await desktopApi.listDirectory(opts.codeDir)
      for (const e of entries) {
        if (e.type !== "file") continue
        if (e.path === "public/live-data.json" || e.path.endsWith("/live-data.json")) continue
        const buf = await desktopApi.readFileBuffer(`${opts.codeDir}/${e.path}`)
        if (!buf) continue
        injectFiles.push({ path: e.path, content: new TextDecoder().decode(buf) })
      }
    } catch {
      // codeDir 读失败：best-effort 跳过，仍导母版+live-data
    }
  }

  // 2. 注入场景 JSON → public/live-data.json（in-memory 当前 merged scene 为权威）
  injectFiles.push({
    path: "public/live-data.json",
    content: JSON.stringify(opts.sceneConfig, null, 2),
  })

  // 3. 注入开发者 README
  injectFiles.push({
    path: "README.md",
    content: DEV_README,
  })

  // 4. 改 package.json：加 @a3d/a3d-components file: 依赖（libraryBridge 用此名 import）
  try {
    const pkgJsonBuf = await desktopApi.readFileBuffer(`${opts.templateSrc}/package.json`)
    if (pkgJsonBuf) {
      const pkgJson = JSON.parse(new TextDecoder().decode(pkgJsonBuf))
      if (!pkgJson.dependencies) pkgJson.dependencies = {}
      pkgJson.dependencies["@a3d/a3d-components"] = "file:./vendor/3d-components"
      injectFiles.push({
        path: "package.json",
        content: JSON.stringify(pkgJson, null, 2),
      })
    }
  } catch {
    console.warn("[export-project] 读取 package.json 失败，跳过改写")
  }

  // 5. 改 vite.config.ts：删除 @a3d/a3d-components alias 行（让其走 node_modules → vendor）
  try {
    const viteConfigBuf = await desktopApi.readFileBuffer(`${opts.templateSrc}/vite.config.ts`)
    if (viteConfigBuf) {
      const original = new TextDecoder().decode(viteConfigBuf)
      const lines = original.split("\n")
      // 删除含 @a3d/a3d-components 的 alias 条目行；注释行（含 //）保留
      const filtered = lines.filter(
        (line) => !line.includes("@a3d/a3d-components") || line.includes("//"),
      )
      injectFiles.push({
        path: "vite.config.ts",
        content: filtered.join("\n"),
      })
    }
  } catch {
    console.warn("[export-project] 读取 vite.config.ts 失败，跳过改写")
  }

  // 6. 注入 vendor package.json（精简：仅 runtime 字段，剥 prepare/husky/scripts 避免 npm install 跑它）
  try {
    const libPkgBuf = await desktopApi.readFileBuffer(`${opts.componentsSrc}/package.json`)
    if (libPkgBuf) {
      const lib = JSON.parse(new TextDecoder().decode(libPkgBuf))
      const vendorPkg = {
        name: lib.name, // @a3d/a3d-components（与 project package.json file: 依赖名一致）
        version: lib.version,
        type: lib.type,
        main: lib.main,
        module: lib.module,
        types: lib.types,
        exports: lib.exports,
        sideEffects: lib.sideEffects,
        peerDependencies: lib.peerDependencies,
      }
      injectFiles.push({
        path: "vendor/3d-components/package.json",
        content: JSON.stringify(vendorPkg, null, 2),
      })
    }
  } catch {
    console.warn("[export-project] 读取 3d-components package.json 失败，vendor 依赖可能不完整")
  }

  // 7. exportProjectZip：copyDirs 把 3d-components/dist 复制到 vendor/3d-components/dist
  const result = await desktopApi.exportProjectZip({
    sourceDir: opts.templateSrc,
    defaultName: opts.defaultName,
    ignore: ["node_modules", "dist", ".git", ".claude", ".octo"],
    injectFiles,
    copyDirs: [{ from: `${opts.componentsSrc}/dist`, to: "vendor/3d-components/dist" }],
    comment: "scene-3d",
  })

  if (result) {
    showToast({ title: "工程已导出", description: "解压后 npm install && npm run dev 即可运行" })
  } else {
    showToast({ title: "导出取消或失败" })
  }
}
