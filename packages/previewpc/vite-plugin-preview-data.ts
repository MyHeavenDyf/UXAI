import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'

export default function previewDataPlugin(jsonPath: string): Plugin {
  const build = () => `window.__A2UI_DATA__ = ${readFileSync(jsonPath, 'utf8').trim()};\n`
  return {
    name: 'preview-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/data.js') return next()
        res.setHeader('Content-Type', 'application/javascript')
        res.end(build())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'data.js', source: build() })
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('</body>', '  <script src="./data.js"></script>\n  </body>')
      },
    },
  }
}
