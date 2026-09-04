import type { SubtypeHandler } from './types'
import defaultHandler, { defaultModelEditConfig } from './default'

/**
 * demo 分支
 * 基于 _default 分支，增加新版局部编辑（modelEdit）功能
 * 文件名格式：xxx.demo.html
 */
const demoHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'demo',
  modelEditConfig: defaultModelEditConfig,
}

export default demoHandler satisfies SubtypeHandler
