import { readFileSync, existsSync, cpSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

// Vditor 资源本地化(见 docs/specs/ui/insight-markdown-editor.md §6.2):
// Vditor 运行时按 `cdn + "/dist/js/..."` 拉 katex/mermaid/echarts/highlight.js 等懒加载资源,
// 默认走公网 unpkg —— 内网/离线必然失败。把 npm 包自带的 dist/ 拷进 public/vendor/vditor/dist,
// publicDir 机制让 dev 自动 serve `/vendor/vditor/*`、build 自动随 dist 落地。
// 编辑器侧设 `cdn: "/vendor/vditor"`,所有资源本地取,零公网 CDN、断网可用。
function copyVditorAssets() {
  const require = createRequire(import.meta.url)
  let distDir
  try {
    // 解析 vditor 包根下的 dist(package.json 必导出,稳过 exports 限制)
    distDir = join(dirname(require.resolve("vditor/package.json")), "dist")
  } catch {
    console.warn("[vditor] 未找到 vditor 包,跳过资源拷贝(编辑器将无法离线加载资源)")
    return
  }
  const destDir = fileURLToPath(new URL("./public/vendor/vditor/dist", import.meta.url))
  // 已拷过(以 index.css 为标记)则跳过,避免每次 dev 启动重拷 23M
  if (existsSync(join(destDir, "index.css"))) return
  mkdirSync(dirname(destDir), { recursive: true })
  cpSync(distDir, destDir, { recursive: true })
  console.log("[vditor] 已本地化运行时资源 →", destDir)
}

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:vditor-assets",
    // serve(dev) 与 build 都触发:确保 public/vendor/vditor/dist 就位
    config() {
      copyVditorAssets()
    },
  },
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./octoapp", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
