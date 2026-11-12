import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { Plugin } from "vite"

const __dirname = dirname(fileURLToPath(import.meta.url))

// 分享对话查看页:dev 时拦截 /design/agent/share/{uniqueId}.html,统一返回 share/index.html。
// 生产由 vite build 直接 copy public/ → dist/,nginx try_files 把该路径映射到 index.html。
// apply: "serve" 保证 build 阶段整插件被跳过,不影响打包。
export function sharePagePlugin(): Plugin {
  return {
    name: "octo:share-page",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.match(/^\/design\/agent\/share\/[^/]+\.html/)) return next()
        console.log("[sharePagePlugin] intercept:", req.url)
        try {
          const html = readFileSync(
            join(__dirname, "public/design/agent/share/index.html"),
            "utf8",
          )
          res.setHeader("Content-Type", "text/html")
          res.end(html)
        } catch (err) {
          console.error("[sharePagePlugin] failed to read share/index.html:", err)
          next()
        }
      })
    },
  }
}
