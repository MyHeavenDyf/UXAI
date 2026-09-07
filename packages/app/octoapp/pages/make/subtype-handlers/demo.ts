import type { SubtypeHandler } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import defaultHandler, { defaultModelEditConfig } from './default'

/**
 * demo 分支
 * 基于 _default 分支，增加新版局部编辑（modelEdit）功能
 * 文件名格式：xxx.demo.html
 */
const demoModelEditConfig: ModelEditConfig = {
  ...defaultModelEditConfig,
  promptCallback: (filePath, selector) => {
    return [
      `[文件: ${filePath}]`,
      `[选择器: ${selector}]`,
    ].join('\n')
  },
}

const demoHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'demo',
  modelEditConfig: demoModelEditConfig,
}

export default demoHandler satisfies SubtypeHandler
