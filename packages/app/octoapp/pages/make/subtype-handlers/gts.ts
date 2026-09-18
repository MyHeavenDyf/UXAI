import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { relativePathToId, resolveRelativePath, getExt } from '../utils/history-store'

/** gts 历史记录的文件集（相对 tab.filePath 所在目录，'.' = 当前文件）。
 *  需要多文件记录时在这里扩展，如 ['.', './config.json'] */
const GTS_HISTORY_FILES = ['.']

const gtsHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'gts',

  /** 历史记录入口 1：决定每次记录哪些文件。
   *  event.type: 'open' | 'edit' | 'agent-update' | 'agent-file-edit'
   *  返回相对路径数组；返回 null 表示本次不记录。
   *  此文件集同时决定 agent 改文件检测（onFileRefresh）的 hash 监控范围。 */
  onHistoryTrigger(_event, _ctx) {
    return GTS_HISTORY_FILES
  },

  /** 历史记录入口 2：版本恢复逻辑。用户点击历史版本行时调用，
   *  把版本文件复制回原始路径，再重读主文件到 tab.content 供渲染。 */
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi, updateTabContent } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !api?.readFileBuffer || !tab.filePath) return

    for (const rel of GTS_HISTORY_FILES) {
      const id = relativePathToId(rel)
      const ext = getExt(resolveRelativePath(rel, tab.filePath))
      const versionFileName = id + ext
      const versionFile = files.find((f) => f.fileName === versionFileName)
      if (!versionFile) continue
      try {
        await api.copyFileTo(versionFile.filePath, resolveRelativePath(rel, tab.filePath))
      } catch {}
    }

    const buf = await api.readFileBuffer(tab.filePath)
    if (buf && updateTabContent) {
      updateTabContent(tab.id, new TextDecoder().decode(buf))
    }
  },
}

export default gtsHandler
