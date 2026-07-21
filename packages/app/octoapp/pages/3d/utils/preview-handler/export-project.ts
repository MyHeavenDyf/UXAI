/**
 * 导出 3d-templete 工程为开发者可独立运行的 zip。
 *
 * 流程（file: 协议内嵌 3d-components，绕过 npm 发布）：
 * 1. 复制 3d-templete/ → 临时目录（排除 node_modules/dist/.git）
 * 2. 复制 3d-components/dist/ → 临时目录/vendor/3d-components/（预 build 产物）
 * 3. 改副本 package.json：加 `"@cyc/3d-components": "file:./vendor/3d-components"`
 * 4. 删副本 vite.config.ts 的 @cyc/3d-components alias（即 package.json:20 注释里既定的"生产形态切换"）
 * 5. 注入：当前场景 JSON 覆盖 public/live-data.json
 * 6. 替换 README.md 为开发者说明
 * 7. exportProjectZip IPC 打包，comment "scene-3d"
 */
import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../desktop-api"
import type { SceneConfig } from "../scene-config"

/** 开发者 README 内容 */
const DEV_README = `# 3D Scene Project

This project was exported from the 3D scene editor.

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://127.0.0.1:5173 in your browser to view the scene.

## Project Structure

- Scene data: \`public/live-data.json\`
- Engine: 3d-templete (Vue 3 + Vite + Three.js)
- Components: @cyc/3d-components (bundled as file: dependency)

## Customization

Edit \`public/live-data.json\` to change the scene configuration.
See the LiveDataConfig schema for available options.
`

export async function exportProject(opts: {
  templateSrc: string          // 3d-templete 源码绝对路径
  componentsSrc: string        // 3d-components 源码绝对路径
  sceneConfig: SceneConfig     // 当前场景数据（注入为 live-data.json）
  defaultName: string          // zip 默认文件名
}): Promise<void> {
  const desktopApi = getDesktopApi()

  if (!desktopApi?.exportProjectZip || !desktopApi?.writeFileBuffer || !desktopApi?.readFileBuffer) {
    showToast({ title: "当前环境不支持导出工程" })
    return
  }

  // injectFiles: 需要注入/覆盖的文件
  const injectFiles: { path: string; content: string }[] = []

  // 1. 注入场景 JSON → public/live-data.json
  injectFiles.push({
    path: "public/live-data.json",
    content: JSON.stringify(opts.sceneConfig, null, 2),
  })

  // 2. 注入开发者 README
  injectFiles.push({
    path: "README.md",
    content: DEV_README,
  })

  // 3. 改 package.json：加 @cyc/3d-components file: 依赖
  //    读取原始 package.json，解析后改写，再加回 injectFiles
  try {
    const pkgJsonBuf = await desktopApi.readFileBuffer(`${opts.templateSrc}/package.json`)
    if (pkgJsonBuf) {
      const pkgJson = JSON.parse(new TextDecoder().decode(pkgJsonBuf))
      // 加 file: 依赖（指向 vendor 目录，3d-components dist 会被手动复制进去）
      if (!pkgJson.dependencies) pkgJson.dependencies = {}
      pkgJson.dependencies["@cyc/3d-components"] = "file:./vendor/3d-components"
      injectFiles.push({
        path: "package.json",
        content: JSON.stringify(pkgJson, null, 2),
      })
    }
  } catch {
    console.warn("[export-project] 读取 package.json 失败，跳过改写")
  }

  // 4. 改 vite.config.ts：删除 @cyc/3d-components alias 行
  //    读原文件，删除含 '@cyc/3d-components' 的 alias 行，注入修改版
  try {
    const viteConfigBuf = await desktopApi.readFileBuffer(`${opts.templateSrc}/vite.config.ts`)
    if (viteConfigBuf) {
      const original = new TextDecoder().decode(viteConfigBuf)
      // 删除含 @cyc/3d-components 的 resolve.alias 条目行
      const lines = original.split("\n")
      const filtered = lines.filter(
        (line) => !line.includes("@cyc/3d-components") || line.includes("//"),
      )
      injectFiles.push({
        path: "vite.config.ts",
        content: filtered.join("\n"),
      })
    }
  } catch {
    console.warn("[export-project] 读取 vite.config.ts 失败，跳过改写")
  }

  // 5. 调用 exportProjectZip IPC
  const result = await desktopApi.exportProjectZip({
    sourceDir: opts.templateSrc,
    defaultName: opts.defaultName,
    ignore: ["node_modules", "dist", ".git", ".claude", ".octo"],
    injectFiles,
    comment: "scene-3d",
  })

  if (result) {
    showToast({ title: "工程已导出", description: "解压后 npm install && npm run dev 即可运行" })
  } else {
    showToast({ title: "导出取消或失败" })
  }
}
