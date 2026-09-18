import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { IconDownloadNew } from '../icons'
import {
  exportFastuiZip,
  isExporting,
  isExportingAny,
  isFastuiSession,
  isLocalPreviewUrl,
  parseFastuiPreview,
  sessionDirOf,
} from '../utils/fastui-export'

/**
 * external URL tab（`{ type: "html", subtype: "url" }`）
 *
 * 这个 subtype 是**所有 http(s) 链接 tab 的通用形态** —— 链接卡片、文件管理里打开外链
 * 都走它，不是 fastui 专属。所以这里只做增量：行为整体沿用 _default（url 的能力开关在
 * subtype-config 里已经把编辑类功能全关掉了），额外挂一个「导出代码包」按钮，
 * 且只在确认是 fastui 会话时出现（SPEC-DES-001 §8.6.2）。
 *
 * 为什么不按 spec 说的实现 `handleDownload`：`SUBTYPE_CONFIG.url.features.download`
 * 是 false，下载按钮根本不渲染，那条路走不到；而把它翻成 true 会让任意外链 tab 都长出
 * 一个必然失败的下载按钮 —— 那是对既有行为的回归。extraButtons 是同一个扩展点的另一条腿。
 */
function targetSessionDir(ctx: SubtypeHandlerContext): string | null {
  // fastui 卡片(fastui://<产物名>,SPEC-DES-004)或旧版 loopback 卡片
  if (parseFastuiPreview(ctx.tab.filePath) === null && !isLocalPreviewUrl(ctx.tab.filePath)) return null
  return sessionDirOf(ctx.sdkDirectory, ctx.sessionId)
}

/** 卡片对应的产物名;旧版卡片没有,导出时退回会话状态文件里的工程 */
function targetProjectName(ctx: SubtypeHandlerContext): string | undefined {
  return parseFastuiPreview(ctx.tab.filePath) || undefined
}

const urlHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'url',
  components: {
    actionBar: {
      extraButtons: [
        {
          id: 'fastui-export-zip',
          position: 'after-download',
          label: (ctx) => (isExporting(targetSessionDir(ctx)) ? '导出中…' : '导出代码包'),
          icon: () => <IconDownloadNew size={16} />,
          tooltip: '导出可直接 yarn install 运行的工程代码包（不含依赖）',
          visible: (ctx) => {
            const dir = targetSessionDir(ctx)
            return !!dir && isFastuiSession(dir)
          },
          // 锁是全局的,按全局禁用 —— 否则在另一个会话的 tab 上点会静默无反应
          disabled: () => isExportingAny(),
          onClick: async (ctx) => {
            const dir = targetSessionDir(ctx)
            if (!dir) return
            ctx.tracker.interaction({ module: 'design', name: 'fastui-export-zip' })
            await exportFastuiZip(dir, targetProjectName(ctx))
          },
        },
      ],
    },
  },
}

export default urlHandler satisfies SubtypeHandler
