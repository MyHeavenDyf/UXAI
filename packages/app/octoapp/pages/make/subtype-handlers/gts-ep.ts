import type { SubtypeHandler } from './types'
import type { ModelEditConfig, IconConfig, SaveCallbackArgs, DeleteCallbackArgs } from '../components/model-edit-items/types'
import gtsHandler, { gtsModelEditConfig, createGtsIconConfig } from './gts'
import { defaultModelEditConfig } from './default'

// GTS-EP 源码定位 prompt 包装（参照 components.tsx 的 wrapComponentsPrompt）
// 不依赖 DOM 组件标记 / componentFlag — 点击元素走 native 分支,拿到标签/类名/选择器后,
// 用提示词告诉 agent: 这是 GTS-EP (Vue 3 + Element Plus) 项目,源码在 src/pages 下的 index.vue,
// 按类名/选择器在 .vue 文件里定位对应元素,改完重跑 build.mjs 刷新预览。
// index.gts-ep.html 是 FIXED 容器,不可直接编辑。
function wrapGtsEpPrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[/\\][^/\\]+$/, '')
  return [
    `预览页面源码根目录：${previewRoot}`,
    '该预览由 gts-ep-coder skill 的 build.mjs 编译生成，index.gts-ep.html 是编译产物，不可直接编辑。',
    '真正的源码在 src/pages/{页面名}/index.vue 中（Vue 3 + Element Plus SFC，由 vue3-sfc-loader 在浏览器现场编译渲染）。',
    '请按下方信息定位源码、应用变更，然后重新编译并验证。',
    '',
    body,
    '',
    '操作要求：',
    '1. 按类名/选择器在 src/pages 下各 index.vue 的 <template> 中定位对应元素，修改结构或文本',
    '2. 样式改对应 .vue 的 <style scoped lang="less">，颜色/间距用 design token（var(--color-*) / var(--space-size-*)）',
    '3. 只改 src/ 下的源码文件，不要改 index.gts-ep.html',
    `4. 重新编译：node scripts/build.mjs --dir "${previewRoot}"`,
    '5. build 产物 preview-data.js 更新后预览会自动刷新',
  ].join('\n')
}

// GTS-EP 图标配置 — 复用 gts.ts 的 createGtsIconConfig 工厂(SVG 落 public/icons + postMessage 预览 + 不写回容器),
// 仅 wrapPrompt 换成 GTS-EP 专属的源码定位提示词(src/pages + var(--color-*) + index.gts-ep.html)。
const gtsEpIconConfig: IconConfig = createGtsIconConfig(wrapGtsEpPrompt)

const gtsEpModelEditConfig: ModelEditConfig = {
  ...gtsModelEditConfig,
  iconConfig: gtsEpIconConfig,
  saveCallback: async (args: SaveCallbackArgs) => wrapGtsEpPrompt(args.filePath, await defaultModelEditConfig.saveCallback(args)),
  deleteCallback: async (args: DeleteCallbackArgs) => wrapGtsEpPrompt(args.filePath, await defaultModelEditConfig.deleteCallback(args)),
}

const gtsEpHandler: SubtypeHandler = {
  ...gtsHandler,
  name: 'gts-ep',
  modelEditConfig: gtsEpModelEditConfig,
}

export default gtsEpHandler
