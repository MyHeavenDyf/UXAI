import type { Plugin } from 'vite'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export default function fileProtocolPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'file-protocol-friendly',
    apply: 'build',
    enforce: 'post',
    config(config) {
      config.build ??= {}
      config.build.modulePreload = false
      config.define = {
        ...config.define,
        'import.meta.url': '(document.currentScript&&document.currentScript.src||document.baseURI)',
      }
      config.build.rollupOptions ??= {}
      const output = (config.build.rollupOptions.output ??= {})
      const apply = (o: any) => {
        o.format = 'iife'
        o.inlineDynamicImports = true
        o.entryFileNames = 'assets/[name].js'
        o.chunkFileNames = 'assets/[name].js'
      }
      Array.isArray(output) ? output.forEach(apply) : apply(output)
    },
    configResolved(resolved) {
      outDir = resolved.build.outDir
    },
    transformIndexHtml(html) {
      return html
        .replace(/<script\s+type="module"\s+crossorigin/g, '<script defer')
        .replace(/<script\s+type="module"/g, '<script defer')
        .replace(/(<script\b[^>]*?)\s+crossorigin/g, '$1')
        .replace(/(<link\b[^>]*?)\s+crossorigin/g, '$1')
    },
    closeBundle() {
      const src = join(outDir, 'index.html')
      if (existsSync(src)) renameSync(src, join(outDir, 'index.prototype.html'))
    },
  }
}
