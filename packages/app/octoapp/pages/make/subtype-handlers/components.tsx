import type { SubtypeHandler, CanvasEditResult } from './types'
import type { JSX } from 'solid-js'
import type { DesktopApi } from '../lib/electron-api'
import { createSignal } from 'solid-js'
import JSZip from 'jszip'
import { showPromiseToast } from '../components/octo-toast'
import { registerCustomBridge } from '../utils/custom-bridge-registry'
import { relativePathToId, resolveRelativePath, getExt, type VersionFile } from '../utils/history-store'

registerCustomBridge('components-theme', {
  script: `
(function() {
  console.log('[ComponentsTheme] Loaded')
  window.parent.postMessage({ type: 'od:components-theme-loaded' }, '*')
  window.addEventListener('message', function(e) {
    var d = e && e.data
    if (!d || d.type !== 'od:toggle-theme') return
    document.documentElement.classList.toggle('dark')
  })
})()
  `,
  position: 'body',
})

const [busy, setBusy] = createSignal(false)
const [isDarkTheme, setDarkTheme] = createSignal(false)

window.addEventListener('message', (e) => {
  if ((e as MessageEvent).data?.type === 'od:components-theme-loaded') setDarkTheme(false)
})

function IconSun(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function IconMoon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

async function packDirFiles(api: DesktopApi, dir: string): Promise<{ path: string; content: Uint8Array }[]> {
  const entries = (await api.listDirectory!(dir)) ?? []
  const base = dir.replace(/[\\/]+$/, '')
  const files: { path: string; content: Uint8Array }[] = []
  for (const e of entries) {
    if (e.type !== 'file') continue
    const buf = await api.readFileBuffer!(`${base}/${e.path}`)
    if (buf) files.push({ path: e.path.replace(/\\/g, '/'), content: new Uint8Array(buf) })
  }
  return files
}

async function packDirZip(api: DesktopApi, dir: string): Promise<Blob> {
  const files = await packDirFiles(api, dir)
  const zip = new JSZip()
  for (const f of files) {
    zip.file(f.path, f.content)
  }
  return await zip.generateAsync({ type: 'blob' })
}

export default {
  name: 'components',

  async handleDownload(ctx) {
    const { tab, showOctoToast, getDesktopApi } = ctx
    if (busy()) return true
    setBusy(true)
    try {
      const api = getDesktopApi()
      if (!api?.listDirectory || !api?.readFileBuffer) {
        showOctoToast({ title: '当前环境不支持目录读取' })
        return true
      }
      const filePath = tab.filePath || tab.absoluteFilePath
      if (!filePath) {
        showOctoToast({ title: '无法获取文件路径' })
        return true
      }
      const dir = filePath.replace(/[/\\][^/\\]+$/, '')
      const parts = filePath.split(/[/\\]/).filter(Boolean)
      const layerName = parts.length >= 4 ? parts[parts.length - 4] : (parts[parts.length - 2] || 'export')
      const zipName = `${layerName}.zip`

      const p = (async () => {
        const blob = await packDirZip(api, dir)
        if (api.saveFilePicker && api.writeFileBuffer) {
          const chosen = await api.saveFilePicker({ defaultPath: zipName })
          if (!chosen) return '已取消'
          await api.writeFileBuffer(chosen, await blob.arrayBuffer())
          return '已保存'
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = zipName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return '已下载'
      })()

      showPromiseToast(p, {
        loading: '正在打包…',
        success: (msg: string) => msg,
        error: (e: unknown) => `打包失败: ${e instanceof Error ? e.message : String(e)}`,
      })
      try { await p } catch { /* toast 已处理 */ }
      return true
    } finally {
      setBusy(false)
    }
  },

  async handleCanvasEdit(ctx): Promise<CanvasEditResult> {
    const { tab, showOctoToast, sessionId, observedUrlsGetter } = ctx
    const isLoggedIn = !!localStorage.getItem('uiplusToken')
    if (!isLoggedIn) {
      showOctoToast({ title: '请先登录' })
      return { handled: true }
    }
    const htmlContent = ctx.extractCodeBlock(tab.content, 'html')
    const { createC2DZip } = await import('../utils/canvas-to-design')
    return {
      handled: true,
      options: {
        getZip: async () => createC2DZip({
          htmlContent,
          htmlFilePath: tab.filePath || '',
          tabTitle: tab.title,
          observedUrls: observedUrlsGetter?.() ?? [],
        }),
        downloadHtml: async (data) => {
          const api = ctx.getDesktopApi()
          const dir = ctx.sdkDirectory && ctx.sessionId ? `${ctx.sdkDirectory}/.octo/${ctx.sessionId}/uploads` : null
          if (!dir || !api?.writeFileBuffer) {
            showOctoToast({ title: '无法保存', variant: 'error' })
            return
          }
          const buf = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
          await api.writeFileBuffer(`${dir}/${data.filename}`, buf.buffer)
          showOctoToast({ title: '已保存', description: data.filename })
        },
        config: { designName: tab.title, sessionId: sessionId ?? '' },
      },
    }
  },

  async handleComment() {
    return false
  },

  async buildArchiveSrc(ctx) {
    try {
      const { tab, getDesktopApi } = ctx
      const api = getDesktopApi()
      if (!api?.listDirectory || !api?.readFileBuffer) return null
      const filePath = tab.filePath || tab.absoluteFilePath
      if (!filePath) return null
      const dir = filePath.replace(/[/\\][^/\\]+$/, '')
      const files = await packDirFiles(api, dir)
      return { files }
    } catch (err) {
      console.warn('[Archive] buildArchiveSrc failed:', err)
      return null
    }
  },

  async onHistoryTrigger() {
    return ['.']
  },

  async applyVersionFiles(ctx, files: VersionFile[]) {
    const { tab, getDesktopApi, updateTabContent } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !api?.readFileBuffer || !tab.filePath) return
    for (const rel of ['.']) {
      const id = relativePathToId(rel)
      const ext = getExt(resolveRelativePath(rel, tab.filePath))
      const vf = files.find(f => f.fileName === id + ext)
      if (!vf) continue
      try { await api.copyFileTo(vf.filePath, resolveRelativePath(rel, tab.filePath)) } catch {}
    }
    const buf = await api.readFileBuffer(tab.filePath)
    if (buf && updateTabContent) updateTabContent(tab.id, new TextDecoder().decode(buf))
  },

  components: {
    actionBar: {
      extraButtons: [
        // {
        //   id: 'components-action',
        //   label: '操作',
        //   position: 'after-download',
        //   order: 1,
        //   tooltip: '自定义操作',
        //   onClick: async (ctx) => {
        //     ctx.showOctoToast({ title: '已触发' })
        //   },
        // },
        {
          id: 'theme-toggle',
          label: () => isDarkTheme() ? '浅色' : '深色',
          icon: () => isDarkTheme() ? IconSun() : IconMoon(),
          position: 'before-comment',
          tooltip: () => isDarkTheme() ? '切换为浅色模式' : '切换为深色模式',
          onClick: (ctx) => {
            const next = !isDarkTheme()
            setDarkTheme(next)
            ctx.postMessageToIframe?.({ type: 'od:toggle-theme' })
          },
        },
      ],
    },
  },
} satisfies SubtypeHandler
