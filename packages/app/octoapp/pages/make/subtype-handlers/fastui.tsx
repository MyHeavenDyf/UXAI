import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { IconDownloadNew } from '../icons'
import {
  exportFastuiZip,
  fastuiTargetOf,
  isExporting,
  isExportingAny,
  isFastuiProject,
  parseFastuiPreview,
} from '../utils/fastui-export'

/**
 * fastui 预览卡片 tab（`{ type: "html", subtype: "fastui" }`，SPEC-DES-005）
 *
 * tab 的 filePath 是 `fastui://<产物名>`（SPEC-DES-004）：iframe 实际加载的 127.0.0.1 地址
 * 由 html-renderer 打开时向主进程当场取，不写回 tab，所以这里的身份判断只认 filePath。
 * 能力开关见 subtype-config 的 `fastui` 条目（在 url 的基础上只多开了分辨率切换）。
 *
 * 行为整体沿用 _default，额外挂一个「导出代码包」按钮（SPEC-DES-001 §8.6.2）。
 * 为什么不走 `handleDownload`：`features.download` 是关的 —— fastui 没有单文件可下，
 * 导出的是整个工程，走 extraButtons 这条腿。
 */
/**
 * 卡片对应的目标(工作区, 会话, 产物名)。旧版卡片转来的产物名是空串,导出时由主进程在
 * 对话只有一个工程时确定;工程在哪也由主进程查(SPEC-DES-008 §3.7)。
 */
function exportTarget(ctx: SubtypeHandlerContext) {
  const name = parseFastuiPreview(ctx.tab.filePath)
  if (name === null) return null
  return fastuiTargetOf(ctx.sdkDirectory, ctx.sessionId, name)
}

const fastuiHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'fastui',
  components: {
    actionBar: {
      extraButtons: [
        {
          id: 'fastui-export-zip',
          position: 'after-download',
          label: (ctx) => (isExporting(exportTarget(ctx)) ? '导出中…' : '导出代码包'),
          icon: () => <IconDownloadNew size={16} />,
          tooltip: '导出可直接 yarn install 运行的工程代码包（不含依赖）',
          visible: (ctx) => {
            const target = exportTarget(ctx)
            return !!target && isFastuiProject(target)
          },
          // 锁是全局的,按全局禁用 —— 否则在另一个会话的 tab 上点会静默无反应
          disabled: () => isExportingAny(),
          onClick: async (ctx) => {
            const target = exportTarget(ctx)
            if (!target) return
            ctx.tracker.interaction({ module: 'design', name: 'fastui-export-zip' })
            await exportFastuiZip(target)
          },
        },
      ],
    },
  },
}

export default fastuiHandler satisfies SubtypeHandler
