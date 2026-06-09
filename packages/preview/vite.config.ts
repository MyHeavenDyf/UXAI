import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import testFilesPlugin from './vite-plugin-test-files'
import fs from 'node:fs'
import path from 'node:path'

function apiPlugin() {
  const dataJsonPath = path.resolve(__dirname, 'src/jsonStorage/data.json')
  return {
    name: 'api-data-write',
    configureServer(server: any) {
      server.middlewares.use('/api/data', (req: any, res: any) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            try {
              fs.writeFileSync(dataJsonPath, JSON.stringify(JSON.parse(body), null, 2))
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch {
              res.writeHead(500)
              res.end('write failed')
            }
          })
          return
        }
        res.writeHead(405)
        res.end()
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
      apiPlugin(),
    ],
    server: {
      port: parseInt(rootEnv.VUE_FRONTEND_PORT || '8989'),
    },
  }
})