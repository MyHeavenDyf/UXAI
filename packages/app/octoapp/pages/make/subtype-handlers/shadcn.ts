import type { SubtypeHandler } from './types'
import { uploadZip } from '@/utils/useZipTransport'

export default {
  name: 'shadcn',
  
  async handleCanvasEdit(ctx) {
    const { tab, showToast, getDesktopApi, projectSelection } = ctx
    const filePath = tab.filePath || tab.absoluteFilePath
    
    if (!filePath) {
      showToast({ title: "无法获取文件路径" })
      return true
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
      return true
    }

    const buffer = await api.readFileBuffer(zipPath)
    if (!buffer) {
      showToast({ title: "ZIP文件不存在", description: zipPath })
      return true
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
      return true
    }

    const result = await uploadZip(async () => zipBlob, projectSelection())
    console.log('pixsourl', result?.pixsoUrl)

    if (!result.webview) {
      showToast({ title: "创建失败" })
      return true
    }

    console.log('pixso loaded')
    return true
  },
} satisfies SubtypeHandler