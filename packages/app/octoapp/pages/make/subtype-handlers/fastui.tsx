import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { exportFastuiZip, fastuiTargetOf, isExportingAny, parseFastuiPreview } from '../utils/fastui-export'

/**
 * fastui 预览卡片 tab（`{ type: "html", subtype: "fastui" }`，SPEC-DES-005）
 *
 * tab 的 filePath 是 `fastui://<产物名>`（SPEC-DES-004）：iframe 实际加载的 127.0.0.1 地址
 * 由 html-renderer 打开时向主进程当场取，不写回 tab，所以这里的身份判断只认 filePath。
 * 能力开关见 subtype-config 的 `fastui` 条目。
 *
 * 行为整体沿用 _default；下载走标准入口（SPEC-DES-007 §8），下的是整个工程的代码包：
 * 打包由主进程调 skill 的 `export-zip.mjs` 完成（SPEC-DES-001 §8.6.2），不是单个文件。
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

  // 锁是全局的(一次只跑一个打包脚本),按全局判 —— 否则在另一个会话的 tab 上点会排进任务中心却什么都不做
  isDownloadBusy: () => isExportingAny(),

  // 失败抛错由 action bar 统一提示「下载失败」;取消保存抛 DownloadCancelledError,action bar 删掉任务项
  async handleDownload(ctx) {
    const target = exportTarget(ctx)
    if (!target) throw new Error('未找到预览工程')
    ctx.tracker.interaction({ module: 'design', name: 'fastui-export-zip' })
    await exportFastuiZip(target)
    return true
  },
}

export default fastuiHandler satisfies SubtypeHandler
