import type { SubtypeHandler, Scene3dEditConfig, SubtypeHandlerContext, HistoryTriggerEvent } from './types'
import type { VersionFile } from '../utils/history-store'
import defaultHandler from './default'
import { getDesktopApi } from '../lib/electron-api'

// Older artifacts predate the embedded metadata.
const legacySource = 'source/public/scene3d/scene-data.json'
const legacyHistory = ['./preview/scene-data.js', './preview/.scene3d-preview-baseline.json', legacySource]

async function readArtifact(filePath: string, api = getDesktopApi(), strict = false) {
  const buffer = await api?.readFileBuffer?.(filePath, strict)
  if (!buffer) return
  const json = new TextDecoder().decode(buffer)
    .match(/<script type="application\/json" id="octo-design-artifact">([^<]+)<\/script>/)?.[1]
  if (!json) return

  const artifact = JSON.parse(json)
  const relativePath = (value: unknown): value is string =>
    typeof value === 'string' && value.split('/').every((part) =>
      /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')
  if (artifact.version !== 1 || artifact.skill !== 'generate-3d-scene' ||
      !relativePath(artifact.source) || !artifact.source.startsWith('source/') ||
      !Array.isArray(artifact.history) || !artifact.history.every(relativePath)) {
    throw new Error('Invalid Design artifact metadata')
  }
  return { source: artifact.source as string, history: artifact.history as string[] }
}

export const scene3dEditConfig: Scene3dEditConfig = {
  async buildPrompt({ filePath, payload }) {
    const artifact = await readArtifact(filePath)
    const projectRoot = filePath.replace(/[\\/][^\\/]+$/, '')
    return [
      '请使用当前会话可用的 generate-3d-scene skill 回写并重建场景。',
      '交付根目录：' + projectRoot,
      '场景数据文件（相对交付根目录）：' + (artifact?.source ?? legacySource),
      '按 skill 的编辑结果回写流程核对 sourceId 和 before，再从当前实际安装的 skill 目录运行统一离线构建入口。',
      '保留冲突中的现有修改。不要直接修改生成的 HTML 或 JS。',
      '',
      payload,
    ].join('\n')
  },
}

const scene3dHandler: SubtypeHandler = {
  ...defaultHandler,
  // subtype 名 '3d':来自 extractSubtypeFromFilename("index.3d.html") → "3d"
  // （与 index.gts.html → "gts" 约定一致）
  name: '3d',
  // 3D 元素非 DOM 组件,不启用属性面板编辑;改走 scene3dEditConfig(postMessage 回写)
  modelEditConfig: undefined,
  scene3dEditConfig,

  /** 历史记录入口 1：决定每次记录哪些文件。
   *  index.3d.html 是 FIXED 离线预览容器（shell，仅 ?v= 与 styles 随构建变化），真正承载场景状态的是
   *  preview/scene-data.js（离线构建内嵌的 scene-data，iframe 实际加载它）与
   *  source/public/scene3d/scene-data.json（AI 回写的源码 source of truth）。
   *  agent-update 时跳过：tab 内容先于磁盘文件变化，此时 recordVersion 会复制到尚未重建完成的中间态文件。 */
  async onHistoryTrigger(event: HistoryTriggerEvent, ctx: SubtypeHandlerContext): Promise<string[] | null> {
    if (event.type === 'agent-update') return null
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!tab.filePath) return null
    const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
    const artifact = await readArtifact(tab.filePath, api)
    const relsToCapture = artifact
      ? [...new Set(['.', artifact.source, ...artifact.history])]
      : ['.', ...legacyHistory]
    if (!api?.statFile) return relsToCapture
    const exists = await Promise.all(
      relsToCapture.map((rel) => {
        const abs = rel === '.' ? tab.filePath! : `${dir}/${rel.replace(/^\.\//, '')}`
        return api.statFile!(abs).then(() => true).catch(() => false)
      }),
    )
    const rels = relsToCapture.filter((_, i) => exists[i])
    // 至少保留 '.'（index.3d.html 必然存在），保证 recordVersion copied>0 能落版本
    return rels.length > 0 ? rels : ['.']
  },

  async resolveVersionFiles(ctx, load) {
    const [entry] = await load(['.'])
    if (!entry) throw new Error('缺少历史场景入口')
    const artifact = await readArtifact(entry.filePath, ctx.getDesktopApi(), true)
    if (!artifact) return
    const paths = [...new Set(['.', artifact.source, ...artifact.history])]
    const files = await load(paths)
    if (files.length !== paths.length) throw new Error('历史场景快照不完整')
    return files
  },

  async applyVersionFiles(ctx: SubtypeHandlerContext, files: VersionFile[]): Promise<void> {
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !tab.filePath) return

    const baseline = files.find((file) => file.relativePath === '.scene3d-preview-baseline.json')
    if (!baseline) {
      for (const file of files) await api.copyFileTo(file.filePath, file.originalPath).catch(() => {})
      return
    }
    if (!api.readFileBuffer || !api.writeFileBuffer || !api.deleteFile) {
      throw new Error('当前环境不支持恢复场景构建产物')
    }

    const readBaseline = async (path: string) => {
      const buffer = await api.readFileBuffer!(path, true)
      if (!buffer) throw new Error('缺少场景发布基线：' + path)
      const manifest = JSON.parse(new TextDecoder().decode(buffer))
      if (manifest.version !== 2 || !manifest.files || !Object.hasOwn(manifest.files, 'index.3d.html')) {
        throw new Error('无效的场景发布基线：' + path)
      }
      const entries = Object.entries(manifest.files)
      for (const [name, hash] of entries) {
        if (!/^(?:index\.3d\.html|scene(?:-data)?\.js|[\w.-]+\.css)$/.test(name) ||
            typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
          throw new Error('无效的场景发布文件：' + name)
        }
      }
      return new Map(entries)
    }

    const digest = async (buffer: ArrayBuffer) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
        (byte) => byte.toString(16).padStart(2, '0')).join('')

    const [current, target] = await Promise.all([
      readBaseline(baseline.originalPath),
      readBaseline(baseline.filePath),
    ])
    const snapshotFiles = new Map(files.map((file) => [
      file.relativePath === '.' ? 'index.3d.html' : file.relativePath, file,
    ]))
    for (const [name, hash] of target) {
      const snapshot = snapshotFiles.get(name)
      const buffer = snapshot && await api.readFileBuffer(snapshot.filePath, true)
      if (!buffer || await digest(buffer) !== hash) throw new Error('历史场景产物缺失或不完整：' + name)
    }

    const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
    const obsolete = new Map<string, ArrayBuffer>()
    for (const [name, hash] of current) {
      if (target.has(name)) continue
      const path = dir + '/' + name
      const buffer = await api.readFileBuffer(path, true)
      if (!buffer || await digest(buffer) !== hash) throw new Error('场景发布文件已修改或删除：' + path)
      obsolete.set(path, buffer)
    }

    const originals = new Map(await Promise.all(files.map(async (file) => [
      file.originalPath, await api.readFileBuffer!(file.originalPath, true),
    ] as const)))
    const modified: string[] = []
    try {
      for (const file of [...files.filter((file) => file !== baseline), baseline]) {
        modified.push(file.originalPath)
        await api.copyFileTo(file.filePath, file.originalPath)
      }
      for (const path of obsolete.keys()) {
        modified.push(path)
        await api.deleteFile(path, true)
      }
    } catch (error) {
      const rollback = await Promise.allSettled(modified.map(async (path) => {
        const original = obsolete.get(path) ?? originals.get(path)
        if (original) await api.writeFileBuffer!(path, original)
        else await api.deleteFile!(path, true)
      }))
      const failures = rollback.flatMap((result, index) =>
        result.status === 'rejected' ? [modified[index] + ' — ' + String(result.reason)] : [])
      if (failures.length) {
        throw new Error(String(error) + '\n部分文件回滚失败：\n' + failures.join('\n'), { cause: error })
      }
      throw error
    }
  },

}

export default scene3dHandler
