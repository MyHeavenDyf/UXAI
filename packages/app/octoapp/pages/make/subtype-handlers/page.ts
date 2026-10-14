import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig, DownloadCancelledError } from './default'
import { showOctoToast, dismissOctoToast } from '../components/octo-toast'
import { setAgentExecution } from '../utils/page-utils/agent-execution-state'
import antdToEviewOrchestrator from '../../pattern/agents/antd-to-eview-orchestrator'
import JSZip from 'jszip'

function wrapPagePrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[/\\][^/\\]+$/, '')
  return [
    `预览页面源码根目录：${previewRoot}`,
    '请按下方信息在源代码中定位对应元素并修改。',
    '',
    body,
    '',
    '操作要求：',
    '1. 在源代码中定位对应元素',
    '2. 直接修改源代码中的样式和内容',
    '3. 修改完后执行编译操作',
  ].join('\n')
}

const pageModelEditConfig: ModelEditConfig = {
  saveCallback: async (args) => wrapPagePrompt(args.filePath, await defaultModelEditConfig.saveCallback(args)),
  deleteCallback: async (args) => wrapPagePrompt(args.filePath, await defaultModelEditConfig.deleteCallback(args)),
}

async function packOutputDir(ctx: SubtypeHandlerContext, outputDir: string): Promise<Blob> {
  const api = ctx.getDesktopApi()
  if (!api?.listDirectory || !api?.readFileBuffer) throw new Error('当前环境不支持目录读取')

  const entries = (await api.listDirectory(outputDir)) ?? []
  const files = entries.filter(e => e.type === 'file')
  if (files.length === 0) throw new Error(`输出目录为空：${outputDir}`)

  const base = outputDir.replace(/[\\/]+$/, '')
  const zip = new JSZip()
  for (const entry of files) {
    const buf = await api.readFileBuffer!(`${base}/${entry.path}`)
    if (!buf) continue
    const relPath = entry.path.replace(/\\/g, '/')
    zip.file(relPath, new Uint8Array(buf))
  }
  return zip.generateAsync({ type: 'blob' })
}

function downloadZipBlob(blob: Blob, filename: string, ctx: SubtypeHandlerContext): Promise<void> {
  const api = ctx.getDesktopApi()
  if (api?.saveFilePicker && api?.writeFileBuffer) {
    return api.saveFilePicker({ defaultPath: filename }).then((chosen: string | null) => {
      if (!chosen) throw new DownloadCancelledError()
      return blob.arrayBuffer().then((buf: ArrayBuffer) => api.writeFileBuffer!(chosen, buf))
    })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return Promise.resolve()
}

let downloading = false

const pageHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'page',
  modelEditConfig: pageModelEditConfig,

  async handleDownload(ctx) {
    if (downloading) {
      ctx.showOctoToast({ title: '正在执行中，请等待完成' })
      return true
    }

    const { tab, sdk, modelKey, sync, sessionId } = ctx

    if (!sdk || !modelKey || !sessionId) {
      ctx.showOctoToast({ title: '缺少必要参数，无法生成代码' })
      return true
    }

    const filePath = tab.filePath || tab.absoluteFilePath
    if (!filePath) {
      ctx.showOctoToast({ title: '无法获取文件路径' })
      return true
    }

    const srcDirectory = filePath.replace(/[/\\][^/\\]+$/, '')
    const outputDir = `${srcDirectory}-vite`
    let childSessionId: string | undefined

    const loadingId = showOctoToast({ title: '正在运行编排 agent...', persistent: true })
    downloading = true
    try {
      const result = await antdToEviewOrchestrator({
        sdk: sdk!,
        sync,
        modelKey: modelKey!,
        rootSession: sessionId!,
        srcDirectory,
        onSessionCreated: (id: string) => {
          childSessionId = id
          setAgentExecution({ childSessionId: id, title: 'antd→eview 编排 Agent', visible: true })
        },
      })

      if (result.error) throw new Error(result.error)
      if (!childSessionId) throw new Error('Agent session not created')

      try {
        const zipBlob = await packOutputDir(ctx, outputDir)
        const zipName = `${tab.title.replace(/\.html?$/i, '')}-eview-react.zip`
        await downloadZipBlob(zipBlob, zipName, ctx)
      } finally {
        await sdk!.client.session.update({
          sessionID: childSessionId,
          body: { time: { archived: Date.now() } },
        }).catch(() => {})
      }

      setAgentExecution(null)
      dismissOctoToast(loadingId)
      showOctoToast({ title: '已下载' })
      return true
    } catch (e) {
      setAgentExecution(null)
      dismissOctoToast(loadingId)
      if (e instanceof DownloadCancelledError) throw e
      throw e
    } finally {
      downloading = false
    }
  },
}

export default pageHandler satisfies SubtypeHandler
