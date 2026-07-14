import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import testFilesPlugin from './vite-plugin-test-files'
import fileProtocolPlugin from './vite-plugin-single-file'
import previewDataPlugin from './vite-plugin-preview-data'
import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath,URL } from 'url'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
}

function uploadsPlugin() {
  const uploadsDir = process.env.OCTO_UPLOADS_DIR || join(resolve(__dirname, ".."), ".octo", "design", "history")
  mkdirSync(uploadsDir, { recursive: true })
  return {
    name: "serve-uploads",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith("/history/")) return next()
        const filename = req.url.slice("/history/".length).split("?")[0]
        if (!filename || filename.includes("..")) {
          res.statusCode = 403
          res.end("Forbidden")
          return
        }
        const filePath = join(uploadsDir, filename)
        const exists = await stat(filePath).then(() => true).catch(() => false)
        if (!exists) {
          res.statusCode = 404
          res.end("Not found")
          return
        }
        res.setHeader("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream")
        createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * 可选依赖 @hui/icon-plus-vue 的 stub 插件
 * - 包已安装 → 正常解析到 node_modules
 * - 包未安装 → 解析到虚拟 stub（空导出），防止 Vite 编译报错
 * 同时注入 virtual:hui-icon-exists 标志供运行时检测
 */
function huiIconStubPlugin() {
  const HUI_PKG = '@hui/icon-plus-vue'
  const STUB_ID = '\0virtual:hui-icon-stub'
  const FLAG_ID = 'virtual:hui-icon-exists'
  let exists = false

  return {
    name: 'hui-icon-stub',
    resolveId(id: string) {
      if (id === HUI_PKG) {
        try {
          _require.resolve(HUI_PKG)
          exists = true
          return null // 包存在，走默认解析到 node_modules
        } catch {
          exists = false
          return STUB_ID // 包不存在，使用 stub
        }
      }
      if (id === FLAG_ID) return FLAG_ID
      return null
    },
    load(id: string) {
      if (id === STUB_ID) {
        return 'export default {}; export {}'
      }
      if (id === FLAG_ID) {
        return `export const hasHuiIcons = ${exists}; export default ${exists}`
      }
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, __dirname + '/..', '')
  return {
    base: './',
    plugins: [
      tailwindcss(),
      vue(),
      testFilesPlugin(),
      uploadsPlugin(),
      huiIconStubPlugin(),
      fileProtocolPlugin(),
      previewDataPlugin(fileURLToPath(new URL('./src/jsonStorage/data.json', import.meta.url))),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@dom-picker/vue': fileURLToPath(new URL('./dom-picker/dom-picker-vue', import.meta.url)),
        '@dom-picker/core': fileURLToPath(new URL('./dom-picker/dom-picker-core', import.meta.url)),
      },
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.vue'],
    },
    server: {
      port: parseInt(rootEnv.VUE_FRONTEND_PORT || '51856'),
    },
    build: {
      outDir: '../previewdist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        onLog(level, log, handler) {
          if (log.code === 'INVALID_ANNOTATION') return
          handler(level, log)
        },
      },
    },
  }
})