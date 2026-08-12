import type { Plugin } from 'vite'

export default function fileProtocolPlugin(): Plugin {
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
      }
      Array.isArray(output) ? output.forEach(apply) : apply(output)
    },
    transformIndexHtml(html) {
      return html
        .replace(/<script\s+type="module"\s+crossorigin/g, '<script defer')
        .replace(/<script\s+type="module"/g, '<script defer')
        .replace(/(<script\b[^>]*?)\s+crossorigin/g, '$1')
        .replace(/(<link\b[^>]*?)\s+crossorigin/g, '$1')
    },
  }
}
