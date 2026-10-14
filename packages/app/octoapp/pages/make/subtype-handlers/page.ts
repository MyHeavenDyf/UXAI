import type { SubtypeHandler } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import { defaultModelEditConfig } from './default'

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

export default {
  name: 'page',
  modelEditConfig: pageModelEditConfig,
} satisfies SubtypeHandler
