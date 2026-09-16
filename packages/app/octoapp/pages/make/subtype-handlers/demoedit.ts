import type { SubtypeHandler } from './types'
import defaultHandler, { directModelEditConfig } from './default'

/**
 * demoedit 分支
 * 基于 _default 分支，modelEdit 使用 direct 模式（实时预览 + 写回 HTML）
 * 文件名格式：xxx.demoedit.html
 */
const demoeditHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'demoedit',
  modelEditConfig: directModelEditConfig,
}

export default demoeditHandler satisfies SubtypeHandler
