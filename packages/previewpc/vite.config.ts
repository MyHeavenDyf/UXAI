import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import testFilesPlugin from './vite-plugin-test-files'
import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath,URL } from 'url'

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
  const uploadsDir = process.env.OCTO_UPLOADS_DIR || join(resolve(__dirname, ".."), ".octo", "design", "uploads")
  mkdirSync(uploadsDir, { recursive: true })
  return {
    name: "serve-uploads",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith("/uploads/")) return next()
        const filename = req.url.slice("/uploads/".length).split("?")[0]
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

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, __dirname + '/..', '')
  return {
    plugins: [
      tailwindcss(),
      vue(),
      testFilesPlugin(),
      uploadsPlugin(),
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