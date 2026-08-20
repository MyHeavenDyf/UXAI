import type { SubtypeHandler, CanvasEditResult } from './types'
import { registerCustomBridge } from '../utils/custom-bridge-registry'

registerCustomBridge('shadcn-component-editor', {
  script: `
(function() {
  console.log('[ShadcnBridge] Loaded')
  
  window.addEventListener('message', function(e) {
    if (e.data.type === 'od:shadcn-edit') {
      console.log('[ShadcnBridge] Edit mode:', e.data.enabled)
    }
  })
  
  document.addEventListener('click', function(e) {
    const target = e.target
    if (target && target.matches('[data-shadcn-component]')) {
      e.preventDefault()
      e.stopPropagation()
      window.parent.postMessage({
        type: 'od:shadcn-component-selected',
        component: target.getAttribute('data-shadcn-component')
      }, '*')
    }
  }, true)
})()
  `,
  style: `
[data-shadcn-component]:hover {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  cursor: pointer;
}
  `,
  position: 'body'
})

export default {
  name: 'shadcn',
  
  async handleCanvasEdit(ctx): Promise<CanvasEditResult> {
    const { tab, showToast, getDesktopApi, sessionId, sdkDirectory } = ctx
    const filePath = tab.filePath || tab.absoluteFilePath
    
    if (!filePath) {
      showToast({ title: "无法获取文件路径" })
      return { handled: true }
    }

    const dir = filePath.replace(/[/\\][^/\\]+$/, '')
    let zipName = tab.title
    if (zipName.toLowerCase().endsWith('.html')) {
      zipName = zipName.slice(0, -5)
    }
    zipName += '.zip'
    const zipPath = dir + '/' + zipName

    const api = getDesktopApi()
    if (!api?.readFileBuffer) {
      showToast({ title: "不支持本地文件读取" })
      return { handled: true }
    }

    const buffer = await api.readFileBuffer(zipPath)
    if (!buffer) {
      showToast({ title: "ZIP文件不存在", description: zipPath })
      return { handled: true }
    }

    const isLoggedIn = !!localStorage.getItem('uiplusToken')
    const zipBlob = new Blob([buffer], { type: "application/zip" })

    if (!isLoggedIn) {
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = zipName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成" })
      return { handled: true }
    }

    return {
      handled: true,
      options: {
        getZip: async () => zipBlob,
        downloadHtml: async (data) => {
          const baseDir = sdkDirectory
          const sid = sessionId
          
          if (!baseDir || !sid || !api?.writeFileBuffer) {
            showToast({ title: "无法保存文件", variant: "error" })
            return
          }
          
          const uploadsDir = `${baseDir}/.octo/${sid}/uploads`
          let finalFilename = data.filename
          
          if (api.fileExists) {
            let counter = 0
            const baseName = data.filename.replace(/\.html$/i, '')
            while (await api.fileExists(`${uploadsDir}/${finalFilename}`)) {
              counter++
              finalFilename = `${baseName}(${counter}).html`
            }
          }
          
          const buf = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
          await api.writeFileBuffer(`${uploadsDir}/${finalFilename}`, buf.buffer)
          showToast({ title: "已保存", description: finalFilename })
        },
        config: {
          designName: tab.title,
          sessionId: sessionId || "",
        },
      },
    }
  },
} satisfies SubtypeHandler